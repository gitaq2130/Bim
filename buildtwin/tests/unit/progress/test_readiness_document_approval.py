"""drawing_approval 안전 불변식 — 담당: qa (ADR 0007 §5). 과제 2의 3·4·5·6·7번을 고정한다.

`seeded`(tests/unit/progress/conftest.py)는 프로젝트 P-TEST에 Activity A100..A400 과 매핑된 객체를
이미 만들어 둔다(문서는 없음). 이 파일은 그 위에 `DocumentRow`/`ActivityDocumentMappingRow`를 직접
얹어 각 경우를 짧게 구성한다(`tests/helpers/document_fixtures.py`).
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from packages.core.settings import settings
from services.progress import persistence as db
from services.progress.config_loader import load_readiness_config
from services.progress.readiness import compute_readiness
from tests.helpers.document_fixtures import make_document, make_mapping

PROJECT_ID = "P-TEST"
ACTIVITY_ID = "A100"


def _swap_document_approval(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, **overrides) -> None:
    cfg = load_readiness_config()
    swapped = dict(cfg)
    swapped["document_approval"] = {**cfg["document_approval"], **overrides}
    (tmp_path / "readiness.yaml").write_text(yaml.safe_dump(swapped), encoding="utf-8")
    monkeypatch.setattr(settings, "config_dir", str(tmp_path))


# ── 규칙 3: 미확정(needs_review=True) 매핑은 순위 1(문서 근거)에 들어가지 않는다 ─────────────
def test_unconfirmed_mapping_does_not_enter_rank1_even_with_high_confidence(session, seeded):
    """confidence 0.99 짜리 시스템 매핑이 있어도, cm 확정 전이면 착수 가능 판단을 바꾸면 안 된다."""
    make_document(session, PROJECT_ID, "doc-pending-1", approval_status="APPROVED", approval_confidence=0.99)
    make_mapping(session, PROJECT_ID, ACTIVITY_ID, "doc-pending-1", confidence=0.99, needs_review=True)
    session.commit()

    score = compute_readiness(session, PROJECT_ID, ACTIVITY_ID)
    cfg = load_readiness_config()
    # 확정 문서가 없으므로 순위 1이 아니라 순위 2/3(기존 동작)으로 떨어져야 한다 — 미확정 매핑이 1.0 을 만들면 안 된다
    assert score.components["drawing_approval"] != 1.0
    assert score.components["drawing_approval"] == cfg["component_defaults"]["drawing_approval_unknown"]
    assert score.confidence < 1.0   # missing 으로 반영된다(§5-2 규칙 5) — 조용히 무시되지 않는다
    blockers = [b for b in score.blockers if b.component == "drawing_approval"]
    assert blockers and "검토 대기" in blockers[0].reason


# ── 규칙 5-1: 논리곱(AND) — 9/10 승인이어도 값은 0.0 이지 0.9 가 아니다 ─────────────────────
def test_nine_of_ten_approved_required_docs_is_all_or_nothing_zero(session, seeded):
    """비율이었다면 9/10=0.9 로 start_threshold(0.75)를 넘겨 미승인 도면 위에서 착수 가능이 뜬다."""
    for i in range(10):
        status = "REJECTED" if i == 9 else "APPROVED"
        make_document(session, PROJECT_ID, f"doc-and-{i}", approval_status=status, doc_number=f"DOC-AND-{i}")
        make_mapping(session, PROJECT_ID, ACTIVITY_ID, f"doc-and-{i}", confidence=0.9, needs_review=False)
    session.commit()

    score = compute_readiness(session, PROJECT_ID, ACTIVITY_ID)
    assert score.components["drawing_approval"] == 0.0   # 비율이었다면 0.9 였을 값
    assert score.components["drawing_approval"] != pytest.approx(0.9)
    blockers = [b for b in score.blockers if b.component == "drawing_approval"]
    assert blockers and blockers[0].severity == "high"
    assert "approved=9/10" in score.evidence.note   # 비율은 점수가 아니라 note 로만 보고한다(§5-1)


# ── 규칙: 처리결과 공란(UNKNOWN)은 "승인 아님"으로 계산되되, blocker 문구가 REJECTED 와 다르다 ──
def test_unknown_status_scores_zero_and_blocker_text_differs_from_rejected(session, seeded):
    make_document(session, PROJECT_ID, "doc-blank-1", result_raw=None, approval_status="UNKNOWN",
                  approval_confidence=1.0, doc_number="DOC-TFA-BLANK-1")
    make_mapping(session, PROJECT_ID, ACTIVITY_ID, "doc-blank-1", needs_review=False)
    session.commit()
    score = compute_readiness(session, PROJECT_ID, ACTIVITY_ID)
    assert score.components["drawing_approval"] == 0.0
    unknown_blocker = next(b for b in score.blockers if b.component == "drawing_approval")
    assert "UNKNOWN" in unknown_blocker.reason
    assert "REJECTED" not in unknown_blocker.reason

    # 같은 Activity 를 반려 문서로 다시 채점해 문구가 실제로 달라지는지 대조한다
    db.load_document(session, PROJECT_ID, "doc-blank-1").approval_status = "REJECTED"
    db.load_document(session, PROJECT_ID, "doc-blank-1").result_raw = "반려"
    session.commit()
    score2 = compute_readiness(session, PROJECT_ID, ACTIVITY_ID)
    rejected_blocker = next(b for b in score2.blockers if b.component == "drawing_approval")
    assert "REJECTED" in rejected_blocker.reason
    assert "UNKNOWN" not in rejected_blocker.reason
    assert rejected_blocker.reason != unknown_blocker.reason


# ── 하위 호환: 문서 없음 + resources.drawing_approved 만 있는 프로젝트는 기존 동작(순위 2) ──
def test_backward_compat_manual_flag_only_project_unaffected(session, seeded):
    row = db.load_activity(session, PROJECT_ID, "A200")
    row.resources = {**row.resources, "drawing_approved": 1}
    session.flush()
    session.commit()
    score = compute_readiness(session, PROJECT_ID, "A200")
    assert score.components["drawing_approval"] == 1.0
    assert not any(b.component == "drawing_approval" for b in score.blockers)
    assert "drawing_approval" not in score.evidence.extra.get("missing_components", [])

    row2 = db.load_activity(session, PROJECT_ID, "A300")
    row2.resources = {**row2.resources, "drawing_approved": 0}
    session.flush()
    session.commit()
    score2 = compute_readiness(session, PROJECT_ID, "A300")
    assert score2.components["drawing_approval"] == 0.0
    assert any(b.component == "drawing_approval" for b in score2.blockers)


def test_backward_compat_neither_flag_nor_documents_is_unknown_default(session, seeded):
    """둘 다 없으면 component_defaults.drawing_approval_unknown(0.5) + missing=True(순위 3) — 기존 동작."""
    score = compute_readiness(session, PROJECT_ID, "A400")   # seeded 는 문서도 안 만들고 A400 에 drawing_approved 플래그도 안 준다
    cfg = load_readiness_config()
    assert score.components["drawing_approval"] == cfg["component_defaults"]["drawing_approval_unknown"]
    assert "drawing_approval" in score.evidence.extra["missing_components"]


# ── 킬 스위치: document_approval.enabled=false 면 완전히 기존 동작으로 돌아간다 ─────────────
def test_kill_switch_disables_document_evidence_entirely(session, seeded, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """확정된 반려 문서가 있어도, enabled=false + 수동 플래그=1 이면 그 문서를 완전히 무시하고 1.0 을 낸다."""
    make_document(session, PROJECT_ID, "doc-killswitch-1", approval_status="REJECTED", doc_number="DOC-KILL-1")
    make_mapping(session, PROJECT_ID, ACTIVITY_ID, "doc-killswitch-1", needs_review=False)
    row = db.load_activity(session, PROJECT_ID, ACTIVITY_ID)
    row.resources = {**row.resources, "drawing_approved": 1}
    session.flush()
    session.commit()

    # 킬 스위치 이전: 문서 근거(반려)가 이겨서 0.0 이어야 한다(순위 1이 수동 플래그보다 우선)
    before = compute_readiness(session, PROJECT_ID, ACTIVITY_ID)
    assert before.components["drawing_approval"] == 0.0

    _swap_document_approval(tmp_path, monkeypatch, enabled=False)
    after = compute_readiness(session, PROJECT_ID, ACTIVITY_ID)
    assert after.components["drawing_approval"] == 1.0   # 문서 근거를 완전히 건너뛰고 수동 플래그만 본다
    assert not any(b.component == "drawing_approval" for b in after.blockers)
