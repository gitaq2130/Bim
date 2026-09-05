"""3중 검증 VER-008/009/010 안전 불변식 — 담당: qa (ADR 0007 §6).

핵심 규칙: 문서 데이터가 없는 프로젝트는 `logic.drawing_approval_status` 가 언제나 "unknown"이고,
"unknown"을 조건으로 삼는 패턴은 없어야 한다. 이게 깨지면 대장을 올리지 않은 모든 기존 프로젝트가
검토요청으로 뒤덮인다(ADR §6-2).
"""
from __future__ import annotations

import pytest
import yaml

from packages.core.models.progress import DailyReportItem
from services.progress.verification import build_logic_context, clear_pattern_cache, run_verification
from tests.helpers.document_fixtures import make_document, make_mapping

PROJECT_ID = "P-TEST"
RULES_PATH = "rules/verification.yaml"


@pytest.fixture(autouse=True)
def _clear_cache():
    clear_pattern_cache()
    yield
    clear_pattern_cache()


def _rules_text() -> str:
    from packages.core.settings import ROOT

    return (ROOT / "rules" / "verification.yaml").read_text(encoding="utf-8")


# ── 불변식 1: 문서 데이터가 없는 프로젝트에서 VER-008/009/010 은 하나도 발동하지 않는다 ──────
def test_no_document_data_never_fires_document_patterns(session, seeded):
    gid = seeded["expected"]["A100"][0]
    logic = build_logic_context(session, PROJECT_ID, gid)
    assert logic["drawing_approval_status"] == "unknown"
    assert logic["document_evidence_available"] is False
    assert logic["rejected_document_count"] == 0

    # 완료 신고 + (스캔 완료추정을 흉내 낸 컨텍스트로) 두 트리거 조건을 모두 만족시켜도 문서 패턴은 안 뜬다
    item = DailyReportItem(global_id=gid, activity_id="A100", claimed_state="completed")
    reviews = run_verification(session, PROJECT_ID, gid, item, None, logic)
    fired = {r.rule_id for r in reviews}
    assert not (fired & {"VER-008", "VER-009", "VER-010"})


def test_patterns_never_use_unknown_as_a_trigger_condition():
    """rules/verification.yaml 자체를 정적으로 스캔한다 — knowledge 가 나중에 패턴을 늘려도 이 제약이
    깨지면 CI 가 잡아야 한다(ADR §6-2 "unknown 을 조건으로 삼는 패턴은 만들지 않는다")."""
    data = yaml.safe_load(_rules_text())
    for pattern in data.get("patterns", []):
        when = pattern.get("when", "")
        if "drawing_approval_status" in when:
            assert "'unknown'" not in when and '"unknown"' not in when, pattern["id"]


def test_document_patterns_do_fire_when_document_evidence_exists(session, seeded):
    """양성 대조: 문서 근거가 실제로 있으면 VER-009 가 뜬다 — 위 음성 테스트가 "애초에 패턴이 죽어
    있어서" 통과한 게 아님을 증명한다."""
    gid = seeded["expected"]["A100"][0]
    make_document(session, PROJECT_ID, "doc-ver-1", approval_status="RESUBMIT_REQUIRED", doc_number="DOC-VER-1")
    make_mapping(session, PROJECT_ID, "A100", "doc-ver-1", needs_review=False)
    session.commit()

    logic = build_logic_context(session, PROJECT_ID, gid)
    assert logic["drawing_approval_status"] == "not_approved"
    assert logic["document_evidence_available"] is True
    assert logic["rejected_document_count"] == 0   # RESUBMIT_REQUIRED 는 반려가 아니다 — VER-008 대신 VER-009

    item = DailyReportItem(global_id=gid, activity_id="A100", claimed_state="completed")
    reviews = run_verification(session, PROJECT_ID, gid, item, None, logic)
    fired = {r.rule_id for r in reviews}
    assert "VER-009" in fired
    assert "VER-008" not in fired   # 반려가 아니므로 VER-008(반려 전용)은 뜨지 않는다


def test_rejected_document_fires_ver008_not_ver009(session, seeded):
    gid = seeded["expected"]["A110"][0]
    make_document(session, PROJECT_ID, "doc-ver-2", approval_status="REJECTED", doc_number="DOC-VER-2")
    make_mapping(session, PROJECT_ID, "A110", "doc-ver-2", needs_review=False)
    session.commit()
    logic = build_logic_context(session, PROJECT_ID, gid)
    assert logic["rejected_document_count"] == 1
    item = DailyReportItem(global_id=gid, activity_id="A110", claimed_state="completed")
    reviews = run_verification(session, PROJECT_ID, gid, item, None, logic)
    fired = {r.rule_id for r in reviews}
    assert "VER-008" in fired and "VER-009" not in fired


def test_pending_only_mapping_keeps_status_unknown_not_not_approved(session, seeded):
    """미확정(needs_review=True) 매핑만 있으면 document_evidence_available 는 여전히 False다(순위 1
    후보가 아니므로) — "아직 모른다"가 "미승인"으로 둔갑하면 안 된다."""
    gid = seeded["expected"]["A120"][0]
    make_document(session, PROJECT_ID, "doc-ver-3", approval_status="APPROVED", doc_number="DOC-VER-3")
    make_mapping(session, PROJECT_ID, "A120", "doc-ver-3", needs_review=True)
    session.commit()
    logic = build_logic_context(session, PROJECT_ID, gid)
    assert logic["document_evidence_available"] is False
    assert logic["drawing_approval_status"] == "unknown"
    assert logic["pending_document_mappings"] >= 1
    item = DailyReportItem(global_id=gid, activity_id="A120", claimed_state="completed")
    reviews = run_verification(session, PROJECT_ID, gid, item, None, logic)
    fired = {r.rule_id for r in reviews}
    assert not (fired & {"VER-008", "VER-009", "VER-010"})
