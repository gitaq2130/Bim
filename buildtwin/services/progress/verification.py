"""3중 검증: 신고(DailyReport) / 물리 증거(ScanVerdict) / 시스템 논리(BIM 수량·선후행·자재) 불일치 → ReviewRequest.

패턴은 rules/verification.yaml(knowledge 소유, 읽기 전용)에서 읽고 `when` 은 services.common.safe_expr 로 평가한다.
불일치 시 상태는 바꾸지 않고 ReviewRequest(kind=verification) 만 만든다(ADR 0001 §6).
"""
from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.progress import DailyReportItem
from packages.core.models.review import ReviewRequest
from packages.core.models.scan import ScanState, ScanVerdict
from packages.core.models.state import ObjectState
from packages.core.settings import ROOT, settings
from services.common.safe_expr import SafeExprError, compile_expr

from . import persistence as db
from .config_loader import load_readiness_config
from .document_mapper import confirmed_required_documents
from .readiness import predecessor_completion

log = logging.getLogger(__name__)

QUANTITY_UNIT_KEYS = {"m3": "volume", "m³": "volume", "m2": "area", "m²": "area", "m": "length", "ea": "count", "개": "count"}
DEFAULT_QUANTITY_KEYS = ("volume", "area", "length", "count")


def _rules_path() -> Path:
    primary = Path(settings.rules_dir) / "verification.yaml"
    return primary if primary.exists() else ROOT / "rules" / "verification.yaml"


@lru_cache(maxsize=4)
def _load_patterns(path: str) -> tuple[dict[str, Any], ...]:
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    patterns = []
    for p in data.get("patterns") or []:
        try:
            patterns.append({**p, "_eval": compile_expr(p["when"])})
        except (KeyError, SafeExprError) as exc:
            log.warning("verification pattern %s skipped: %s", p.get("id"), exc)
    return tuple(patterns)


def load_patterns() -> list[dict[str, Any]]:
    return list(_load_patterns(str(_rules_path())))


def clear_pattern_cache() -> None:
    _load_patterns.cache_clear()


def _report_context(item: DailyReportItem | None) -> dict[str, Any]:
    if item is None:
        return {"claimed_state": None, "quantity": None, "quantity_unit": None, "global_id": None, "activity_id": None}
    return item.model_dump(mode="json")


def _scan_context(verdict: ScanVerdict | None) -> dict[str, Any]:
    if verdict is None:
        return {"state": None, "confidence": None, "scan_id": None}
    return {"state": verdict.state.value, "confidence": verdict.confidence, "scan_id": verdict.scan_id}


def build_logic_context(session: Session, project_id: str, global_id: str, quantity_unit: str | None = None,
                        today: date | None = None) -> dict[str, Any]:
    """시스템 논리 축. rules/verification.yaml 과 rules/risk/*.yaml 이 쓰는 키를 모두 채운다.

    predecessor_confirmed_ratio, bim_quantity, material_delivered_ratio, consecutive_unverifiable(최근 스캔부터 연속
    UNVERIFIABLE 횟수), clash_count(미결 verification 검토요청 수), inspection_passed(CONFIRMED→True, 검측 대기→False,
    그 외 None), matched_case_ids(knowledge 가 채움; 여기서는 빈 리스트), days_until_planned_start(귀속 Activity 중 가장 이른 착수일까지 일수).

    ADR 0007 §6-1: document_evidence_available/drawing_approval_status/unapproved_document_count/
    unapproved_document_numbers/pending_document_mappings/rejected_document_count. 안전 규칙: 문서 데이터가
    없으면 drawing_approval_status 는 언제나 "unknown" 이고 VER-008/009/010 은 이를 조건으로 쓰지 않으므로
    문서 미업로드 프로젝트에서는 항상 미발동이다.
    """
    activity_ids = db.activity_ids_for_object(session, project_id, global_id)
    ratios = [predecessor_completion(session, project_id, a)[0].value for a in activity_ids]
    predecessor_ratio = min(ratios) if ratios else 1.0

    obj = db.load_objects_by_ids(session, project_id, [global_id])
    quantity = dict((obj[0].quantity or {}) if obj else {})
    key = QUANTITY_UNIT_KEYS.get((quantity_unit or "").lower()) if quantity_unit else None
    bim_quantity = None
    for k in ([key] if key else []) + list(DEFAULT_QUANTITY_KEYS):
        if k in quantity and quantity[k] is not None:
            bim_quantity = float(quantity[k])
            break

    total_in, total_out, count = db.material_totals(session, project_id, activity_ids, [global_id])
    required = None
    for a in activity_ids:
        row = db.load_activity(session, project_id, a)   # ADR 0008 규칙 2
        if row is not None and (row.resources or {}).get("material_required"):
            required = float(row.resources["material_required"])
            break
    if count == 0:
        material_ratio = None    # 데이터 없음 → 규칙에서 None 비교는 False 로 처리됨
    elif required:
        material_ratio = min(1.0, total_in / required)
    else:
        material_ratio = 1.0 if total_in > 0 else 0.0
    consecutive_unverifiable = 0
    for verdict_row in db.load_scan_verdicts(session, project_id, global_id):
        if verdict_row.state != ScanState.UNVERIFIABLE.value:
            break
        consecutive_unverifiable += 1
    open_verification = db.open_reviews(session, project_id, [global_id], kind="verification")
    state = ObjectState(obj[0].state) if obj else None
    if state == ObjectState.CONFIRMED:
        inspection_passed: bool | None = True
    elif state == ObjectState.INSPECTION_REQUESTED or db.open_reviews(session, project_id, [global_id], kind="inspection"):
        inspection_passed = False
    else:
        inspection_passed = None
    today = today or datetime.now(UTC).date()
    starts = [date.fromisoformat(r.planned_start) for a in activity_ids
              if (r := db.load_activity(session, project_id, a)) is not None and r.planned_start]   # ADR 0008 규칙 2
    days_until_start = (min(starts) - today).days if starts else None

    doc_cfg = load_readiness_config().get("document_approval", {})
    doc_evidence = confirmed_required_documents(session, project_id, activity_ids, doc_cfg) if doc_cfg.get("enabled", True) \
        else None
    if doc_evidence is None or not doc_evidence.confirmed_required:
        # document_evidence_available=False -> drawing_approval_status 는 언제나 "unknown"(ADR §6-1).
        # 문서 데이터가 없는 프로젝트는 여기서 끝나고, VER-008/009/010 은 "unknown" 을 조건으로 쓰지 않으므로 미발동한다.
        document_evidence_available = False
        drawing_approval_status = "unknown"
        unapproved_document_count = 0
        unapproved_document_numbers: list[str] = []
        rejected_document_count = 0
        pending_document_mappings = doc_evidence.pending_count if doc_evidence is not None else 0
    else:
        approved_statuses = set(doc_cfg.get("approved_statuses", ["APPROVED"]))
        unapproved = [d for d in doc_evidence.confirmed_required if d.approval_status not in approved_statuses]
        document_evidence_available = True
        drawing_approval_status = "not_approved" if unapproved else "approved"
        unapproved_document_count = len(unapproved)
        unapproved_document_numbers = [d.doc_number or d.doc_id for d in unapproved]
        rejected_document_count = sum(1 for d in unapproved if d.approval_status == "REJECTED")
        pending_document_mappings = doc_evidence.pending_count

    return {"predecessor_confirmed_ratio": predecessor_ratio, "bim_quantity": bim_quantity,
            "material_delivered_ratio": material_ratio, "consecutive_unverifiable": consecutive_unverifiable,
            "clash_count": len(open_verification), "inspection_passed": inspection_passed, "matched_case_ids": [],
            "days_until_planned_start": days_until_start, "object_state": state.value if state else None,
            "activity_ids": activity_ids, "material_in": total_in, "material_out": total_out,
            "document_evidence_available": document_evidence_available,
            "drawing_approval_status": drawing_approval_status,
            "unapproved_document_count": unapproved_document_count,
            "unapproved_document_numbers": unapproved_document_numbers,
            "pending_document_mappings": pending_document_mappings,
            "rejected_document_count": rejected_document_count}


def run_verification(session: Session, project_id: str, global_id: str, report_item: DailyReportItem | None,
                     scan_verdict: ScanVerdict | None, logic: dict[str, Any]) -> list[ReviewRequest]:
    context = {"report": _report_context(report_item), "scan": _scan_context(scan_verdict), "logic": dict(logic)}
    created: list[ReviewRequest] = []
    existing_open = {r.rule_id for r in db.open_reviews(session, project_id, [global_id], kind="verification")}
    for pattern in load_patterns():
        try:
            hit = bool(pattern["_eval"](context))
        except SafeExprError as exc:
            log.warning("verification pattern %s failed on %s: %s", pattern.get("id"), global_id, exc)
            continue
        if not hit or pattern["id"] in existing_open:
            continue
        review = ReviewRequest(
            project_id=project_id, kind="verification", global_id=global_id,
            activity_id=(report_item.activity_id if report_item else None) or (logic.get("activity_ids") or [None])[0],
            rule_id=pattern["id"], title=pattern.get("title") or pattern["id"],
            conflicting_sources={"daily_report": context["report"], "scan": context["scan"], "system_logic": context["logic"]},
            confidence=float(pattern.get("confidence", 1.0)),
            evidence=Evidence(source_type="rule", source_id=pattern["id"], rule_id=pattern["id"], method="triple_verification",
                              note=pattern.get("when"), extra={"severity": pattern.get("severity")}),
            assignee_role="cm",
        )
        db.save_review_request(session, review)
        existing_open.add(pattern["id"])
        created.append(review)
    return created
