"""문서 ↔ Activity 매핑 (ADR 0007 §4). 문서 ↔ 객체 직접 매핑은 만들지 않는다 — 대장에 객체를 식별할
정보가 없어 근거가 없다(§4-1 규칙 1). 필요하면 `문서 → Activity → activity_object_mappings → 객체`로 파생한다.

세 가지 안전 규칙(반드시 지킬 것 — ADR 0007 §4-2):
1. **제목 근거 없이는 어떤 조합으로도 매핑하지 않는다.** `title_similarity < title_matching.min_similarity`
   면 공종·층·날짜가 모두 맞아도 후보가 아니다.
2. **공종(discipline)은 신뢰할 수 없는 필드다.** 일치는 가점만, 불일치는 감점·배제하지 않는다.
3. **판별 토큰(ZONE·구간·차수·층)이 양쪽에 모두 존재하고 값이 다르면 유사도와 무관하게 후보에서 제외한다.**
   한쪽에만 있으면 배제하지 않고 confidence 만 낮춘다(`one_sided_token_penalty`).

`ActivityDocumentMapping` Pydantic 모델이 confidence 값과 무관하게 항상 `needs_review=True`를 강제한다
(§4 규칙 5) — 이 모듈은 그 모델을 거쳐서만 매핑을 만들고 별도로 자동 확정 로직을 두지 않는다.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy.orm import Session

from packages.core.models.document import ActivityDocumentMapping, Document
from packages.core.models.evidence import Evidence
from packages.core.models.orm import DocumentRow
from packages.core.models.progress import Activity

from . import persistence as db
from .config_loader import load_config

_CONFIG_FILENAME = "document_register.yaml"


def _load_document_register_config() -> dict[str, Any]:
    return load_config(_CONFIG_FILENAME)


# ─────────────────────────────────────────────────────────────────────────────
# 제목 정규화·유사도 (ADR 0007 §4 규칙 1 — 필수 근거)
# ─────────────────────────────────────────────────────────────────────────────
def _normalize_title(text: str, normalize_cfg: dict[str, Any]) -> str:
    for pattern in normalize_cfg.get("strip_patterns", []):
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    strip_chars = normalize_cfg.get("strip_chars", "")
    if strip_chars:
        text = re.sub(f"[{re.escape(strip_chars)}]", " ", text)
    if normalize_cfg.get("lowercase", True):
        text = text.lower()
    if normalize_cfg.get("collapse_whitespace", True):
        text = re.sub(r"\s+", " ", text).strip()
    return text


def _title_similarity(a: str, b: str, seq_weight: float, token_weight: float) -> float:
    seq_ratio = SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    token_jaccard = (len(ta & tb) / len(ta | tb)) if (ta or tb) else 0.0
    return seq_weight * seq_ratio + token_weight * token_jaccard


# ─────────────────────────────────────────────────────────────────────────────
# 판별 토큰(ZONE·구간·차수·층) 하드 배제 (ADR 0007 §4 규칙 3)
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class _DiscriminativeToken:
    name: str
    pattern: re.Pattern[str]


def _compile_discriminative_tokens(cfg: list[dict[str, Any]]) -> list[_DiscriminativeToken]:
    return [_DiscriminativeToken(name=str(t["name"]), pattern=re.compile(str(t["pattern"]), re.IGNORECASE)) for t in cfg]


def _extract_tokens(text: str, tokens: list[_DiscriminativeToken]) -> dict[str, set[str]]:
    """토큰 name -> 정규화된 값 집합. 같은 name 이 여러 패턴(zone 은 "Z1"·"1구역" 두 패턴)에 걸릴 수 있다."""
    found: dict[str, set[str]] = {}
    for tok in tokens:
        for m in tok.pattern.finditer(text):
            value = "".join(g for g in m.groups() if g) or m.group(0)
            found.setdefault(tok.name, set()).add(re.sub(r"\s+", "", value).upper())
    return found


def _activity_text(activity: Activity) -> str:
    """판별 토큰 추출용 Activity 텍스트. 구조화 필드(level·zone)를 텍스트에 포함시켜, Activity 이름에
    층·구역이 문자로 없어도(구조화 컬럼에만 있어도) 판별 토큰 정규식이 인식하게 한다."""
    parts = [activity.name or "", activity.level or "", activity.zone or ""]
    return " ".join(p for p in parts if p)


def _discriminative_check(doc_tokens: dict[str, set[str]], act_tokens: dict[str, set[str]]) -> tuple[list[str], list[str]]:
    """returns (excluded_by, one_sided). 양쪽에 다 있고 값이 다르면 excluded_by, 한쪽에만 있으면 one_sided."""
    excluded_by: list[str] = []
    one_sided: list[str] = []
    for name in sorted(set(doc_tokens) | set(act_tokens)):
        dv, av = doc_tokens.get(name), act_tokens.get(name)
        if dv and av:
            if dv.isdisjoint(av):
                excluded_by.append(name)
        elif dv or av:
            one_sided.append(name)
    return excluded_by, one_sided


# ─────────────────────────────────────────────────────────────────────────────
# 가점 근거 (ADR 0007 §4-2 표)
# ─────────────────────────────────────────────────────────────────────────────
def _discipline_match(doc: Document, activity: Activity) -> bool:
    """공종은 신뢰 불가 필드다 — 가점만 준다(규칙 2). 불일치는 이 함수를 호출하지 않는 쪽(감점 없음)으로 이미 지켜진다."""
    if not doc.discipline_normalized or not activity.discipline:
        return False
    return str(doc.discipline_normalized).strip().lower() == str(activity.discipline).strip().lower()


def _level_match(doc_tokens: dict[str, set[str]], act_tokens: dict[str, set[str]]) -> bool:
    dv, av = doc_tokens.get("level"), act_tokens.get("level")
    return bool(dv and av and not dv.isdisjoint(av))


def _zone_match(doc_tokens: dict[str, set[str]], act_tokens: dict[str, set[str]]) -> bool:
    dv, av = doc_tokens.get("zone"), act_tokens.get("zone")
    return bool(dv and av and not dv.isdisjoint(av))


def _date_window_match(doc: Document, activity: Activity, window_days: int) -> bool:
    if not doc.issued_on or activity.planned_start is None:
        return False
    try:
        issued = date.fromisoformat(doc.issued_on[:10])
    except ValueError:
        return False
    delta = (activity.planned_start - issued).days
    return 0 <= delta <= window_days


# ─────────────────────────────────────────────────────────────────────────────
# 매핑 산출
# ─────────────────────────────────────────────────────────────────────────────
def _build_mapping(doc: Document, activity: Activity, cfg: dict[str, Any],
                   tokens_cfg: list[_DiscriminativeToken]) -> ActivityDocumentMapping | None:
    tm_cfg = cfg["title_matching"]
    weights = cfg["mapping_weights"]
    mapping_cfg = cfg["mapping"]
    normalize_cfg = tm_cfg.get("normalize", {})

    doc_text = _normalize_title(doc.title, normalize_cfg)
    act_text = _normalize_title(activity.name or "", normalize_cfg)
    similarity = _title_similarity(doc_text, act_text, float(tm_cfg["seq_weight"]), float(tm_cfg["token_weight"]))
    if similarity < float(tm_cfg["min_similarity"]):
        return None   # 규칙 1: 제목 근거 없이는 어떤 조합으로도 매핑하지 않는다

    # 판별 토큰은 원문(raw title)에서 추출한다 — normalize 가 "(Z1)" 같은 괄호를 지우지 않지만,
    # 대소문자·공백은 여기서 다시 흡수하므로 원문을 써도 안전하고, 정규화가 향후 strip_patterns 를
    # 넓혀도(예: 괄호 제거) 판별 토큰 추출이 영향받지 않도록 원문을 쓴다.
    doc_tokens = _extract_tokens(doc.title, tokens_cfg)
    act_tokens = _extract_tokens(_activity_text(activity), tokens_cfg)
    excluded_by, one_sided = _discriminative_check(doc_tokens, act_tokens)
    if excluded_by:
        return None   # 규칙 3: 판별 토큰이 양쪽에 있고 값이 다르면 유사도와 무관하게 하드 배제

    confidence = similarity * float(weights.get("title_similarity", 0.0))
    matched_rules = ["title_similarity"]
    if _level_match(doc_tokens, act_tokens):
        confidence += float(weights.get("level_match", 0.0))
        matched_rules.append("level_match")
    if _zone_match(doc_tokens, act_tokens):
        confidence += float(weights.get("zone_match", 0.0))
        matched_rules.append("zone_match")
    if _discipline_match(doc, activity):
        confidence += float(weights.get("discipline_match", 0.0))
        matched_rules.append("discipline_match")
    if _date_window_match(doc, activity, int(mapping_cfg.get("date_window_days", 90))):
        confidence += float(weights.get("date_window", 0.0))
        matched_rules.append("date_window")

    if one_sided:
        confidence *= float(tm_cfg.get("one_sided_token_penalty", 1.0))   # 규칙 3: 한쪽에만 있으면 감쇠만

    confidence = max(0.0, min(1.0, confidence))
    if confidence < float(mapping_cfg["min_confidence_to_propose"]):
        return None   # 규칙 4: 후보 하한 미만이면 행을 만들지 않는다

    evidence = Evidence(
        source_type="document", source_id=doc.doc_id, method="document_title_match", note=doc.title,
        extra={"title_similarity": similarity, "matched_rules": matched_rules, "excluded_by": excluded_by,
               "one_sided_tokens": one_sided, "discipline_trusted": False, "activity_id": activity.activity_id},
    )
    # ActivityDocumentMapping 모델이 needs_review=True 를 항상 강제한다(규칙 5) — 여기서 별도로 설정하지 않는다.
    return ActivityDocumentMapping(activity_id=activity.activity_id, doc_id=doc.doc_id,
                                   confidence=confidence, evidence=evidence)


def map_documents_to_activities(documents: Sequence[Document], activities: Sequence[Activity],
                                cfg: dict[str, Any] | None = None) -> list[ActivityDocumentMapping]:
    """순수 함수. Activity 하나당 confidence 내림차순 상위 `mapping.max_candidates_per_activity` 개만 남긴다.

    고아 문서(`is_orphaned=True`)는 후보로 만들지 않는다 — 최근 대장에 없는 문서를 새로 매핑 제안하는
    것은 CM 검토 큐만 오염시킨다.
    """
    cfg = cfg or _load_document_register_config()
    tokens_cfg = _compile_discriminative_tokens(cfg["title_matching"].get("discriminative_tokens", []))
    max_candidates = int(cfg.get("mapping", {}).get("max_candidates_per_activity", 5))
    live_documents = [d for d in documents if not d.is_orphaned]

    results: list[ActivityDocumentMapping] = []
    for activity in activities:
        candidates = [m for doc in live_documents if (m := _build_mapping(doc, activity, cfg, tokens_cfg)) is not None]
        candidates.sort(key=lambda m: m.confidence, reverse=True)
        results.extend(candidates[:max_candidates])
    return results


def map_project_documents(session: Session, project_id: str) -> list[ActivityDocumentMapping]:
    """DB 에서 문서·Activity 를 읽어 매핑을 산출하고 저장한다(항상 needs_review=True로 upsert)."""
    documents = [db.document_row_to_model(r) for r in db.load_documents(session, project_id, include_orphaned=False)]
    activities = [db.activity_row_to_model(a) for a in db.load_activities(session, project_id)]
    mappings = map_documents_to_activities(documents, activities)
    db.save_document_mappings(session, mappings)
    return mappings


# ─────────────────────────────────────────────────────────────────────────────
# readiness/verification 공용: 확정 필수 문서 + 미확정 매핑 수 집계 (ADR 0007 §5-2)
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class DocumentEvidence:
    """`required_doc_types` 에 속하고 `needs_review=False`·`is_orphaned=False`인 확정 문서(중복 제거)와,
    같은 Activity 집합에 걸린 `needs_review=True` 매핑 수(문서 종류 무관 — ADR §5-2 규칙 5)."""
    confirmed_required: list[DocumentRow] = field(default_factory=list)
    pending_count: int = 0


def confirmed_required_documents(session: Session, project_id: str, activity_ids: Sequence[str],
                                 doc_cfg: dict[str, Any]) -> DocumentEvidence:
    if not activity_ids:
        return DocumentEvidence()
    required_types = set(doc_cfg.get("required_doc_types", ["TFA"]))
    ignore_orphaned = bool(doc_cfg.get("ignore_orphaned_documents", True))

    mappings = db.document_mappings_for_activities(session, project_id, list(activity_ids))
    confirmed = [m for m in mappings if not m.needs_review]
    pending_count = sum(1 for m in mappings if m.needs_review)

    doc_ids = [m.doc_id for m in confirmed]
    docs_by_id = db.documents_by_ids(session, project_id, doc_ids)
    required_confirmed: dict[str, DocumentRow] = {}
    for m in confirmed:
        d = docs_by_id.get(m.doc_id)
        if d is None or d.doc_type not in required_types:
            continue
        if ignore_orphaned and d.is_orphaned:
            continue   # 규칙 6: is_orphaned=True 문서는 분모·분자 어디에도 넣지 않는다
        required_confirmed[d.doc_id] = d
    return DocumentEvidence(list(required_confirmed.values()), pending_count)


__all__ = ["DocumentEvidence", "confirmed_required_documents", "map_documents_to_activities", "map_project_documents"]
