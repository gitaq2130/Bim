"""문서↔Activity 매핑 안전 불변식 — 담당: qa (ADR 0007 §4 규칙 3·5).

과제 2의 불변식 2번("시스템이 만든 문서 매핑은 confidence 와 무관하게 항상 needs_review=True")과,
판별 토큰(ZONE) 하드 배제가 실제 매핑 산출 단계에서도 지켜지는지를 고정한다.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from packages.core.models.document import ActivityDocumentMapping
from packages.core.models.evidence import Evidence
from packages.core.models.progress import Activity
from services.progress.document_mapper import map_documents_to_activities
from services.progress.importers import import_schedule
from services.progress.importers.document_register import import_document_register

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
_EV = Evidence(source_type="document", source_id="doc-1", method="document_title_match")


# ── 불변식: 시스템 매핑은 confidence 와 무관하게 항상 needs_review=True(ADR §4 규칙 5) ──────
@pytest.mark.parametrize("confidence", [0.01, 0.5, 0.7, 0.99, 1.0])
def test_model_forces_needs_review_true_regardless_of_confidence(confidence: float) -> None:
    m = ActivityDocumentMapping(activity_id="A100", doc_id="doc-1", confidence=confidence, evidence=_EV)
    assert m.needs_review is True


def test_needs_review_only_false_when_reviewed_by_is_set() -> None:
    """`reviewed_by`(cm 확정)가 있을 때만 needs_review=False — auto_confirm 은 어떤 값에서도 없다(§4 규칙 5)."""
    unconfirmed = ActivityDocumentMapping(activity_id="A100", doc_id="doc-1", confidence=0.99, evidence=_EV)
    assert unconfirmed.needs_review is True
    confirmed = ActivityDocumentMapping(activity_id="A100", doc_id="doc-1", confidence=0.99, evidence=_EV, reviewed_by="cm-1")
    assert confirmed.needs_review is False
    # reviewed_by 를 지우면 다시 검토 대기로 돌아간다(모델 재검증 시 매번 다시 계산된다 — model_copy 는
    # 검증기를 돌리지 않으므로 model_validate 로 다시 통과시켜 확인한다)
    reverted = ActivityDocumentMapping.model_validate({**confirmed.model_dump(), "reviewed_by": None})
    assert reverted.needs_review is True


@pytest.mark.parametrize("requested_needs_review", [True, False, None], ids=["true", "false", "omitted"])
@pytest.mark.parametrize("reviewed_by", ["cm-1", None], ids=["reviewed", "unreviewed"])
def test_model_cannot_express_half_cancelled_mapping(reviewed_by, requested_needs_review) -> None:
    """**반쪽 취소는 모델을 거치는 한 구조적으로 표현되지 않는다**(ADR 0013 규칙 1 · 계획 0006 §1-c 2행).

    가장 위험한 착지점은 "반려 표시만 지우고 `reviewed_by` 는 남긴" 행이다 — 그 행은
    `confirmed_required_documents` 의 두 필터(`not needs_review` · `not is_rejected_mapping`)를 **둘 다**
    통과해 CM 이 확정 액션을 한 적이 없는데 `drawing_approval` 이 1.0 이 된다(CLAUDE.md §0 위반).
    그것을 막는 것은 취소 구현의 성실함이 아니라 `_always_needs_review` 검증자다: `needs_review` 를
    **무엇으로 보내든** `reviewed_by is None` 으로 다시 계산된다.

    `needs_review` 를 명시적으로 넣는 두 칸이 이 테스트의 핵심이다. 검증자를 지우면
    `(reviewed_by="cm-1", needs_review=True)` 가 그대로 저장돼 반쪽 상태가 **표현 가능해지고**, 그때
    이 두 칸이 죽는다. (행에 직접 쓰는 경로까지 막지는 못한다 — 그쪽은 저장된 행을 읽는
    `tests/integration/test_20_mapping_decision_cancel.py` 가 본다. 여기서 고정하는 것은 "모델을 거치면
    갈라질 수 없다"는 성질 하나다.)
    """
    fields = {"activity_id": "A100", "doc_id": "doc-1", "confidence": 0.99, "evidence": _EV,
              "reviewed_by": reviewed_by}
    if requested_needs_review is not None:
        fields["needs_review"] = requested_needs_review
    m = ActivityDocumentMapping(**fields)
    assert m.needs_review is (reviewed_by is None)
    # 직렬화 → 재검증(저장·응답 왕복)에서도 같다 — 한쪽 방향만 강제하면 왕복에서 갈라진다.
    assert ActivityDocumentMapping.model_validate(m.model_dump()).needs_review is (reviewed_by is None)


def test_pipeline_output_always_has_needs_review_true(document_docs, schedule_activities) -> None:
    """map_documents_to_activities 가 만드는 실제 후보들도 예외 없이 needs_review=True 다."""
    mappings = map_documents_to_activities(document_docs, schedule_activities)
    assert mappings   # 회귀: 매핑이 0건이면 이 불변식은 공허하게 참이 되므로 후보가 있어야 의미가 있다
    assert all(m.needs_review for m in mappings)


# ── 판별 토큰(ZONE) 하드 배제가 실제 매핑에서도 적용된다(ADR §4 규칙 3) ─────────────────────
def test_zone_discriminative_token_excludes_cross_zone_candidate(document_docs) -> None:
    """"1F 기둥 배근도 (Z1)"과 "(Z2)"는 유사도가 높아도 서로의 Activity 후보가 되면 안 된다."""
    by_number = {d.doc_number: d for d in document_docs}
    z1_doc = by_number["동부-HG-TFA-구조-26-049"]   # 1F 기둥 배근도 (Z1)
    z2_doc = by_number["동부-HG-TFA-구조-26-053"]   # 1F 기둥 배근도 (Z2)

    # A100 은 1F/Z1 Activity. 실제 Activity 텍스트를 흉내 내되 zone 만 Z2 로 바꾼 가짜 Activity를 만들어
    # z1 전용 문서가 Z2 Activity 후보에 뜨지 않는지 직접 대조한다.
    a_z1 = Activity(activity_id="A-Z1", name="1F 기둥 철근·거푸집·타설", level="1F", zone="Z1", discipline="structure")
    a_z2 = Activity(activity_id="A-Z2", name="1F 기둥 철근·거푸집·타설", level="1F", zone="Z2", discipline="structure")

    mappings = map_documents_to_activities([z1_doc, z2_doc], [a_z1, a_z2])
    got = {(m.activity_id, m.doc_id) for m in mappings}
    assert (a_z1.activity_id, z1_doc.doc_id) in got
    assert (a_z2.activity_id, z2_doc.doc_id) in got
    # 교차 매핑(Z1 문서 ↔ Z2 Activity, 그 반대)은 판별 토큰이 하드 배제해야 한다
    assert (a_z1.activity_id, z2_doc.doc_id) not in got
    assert (a_z2.activity_id, z1_doc.doc_id) not in got


@pytest.fixture(scope="module")
def document_docs():
    return import_document_register(FIXTURES / "document_register.xlsx", "P-MAPPER-INVARIANTS", "f-doc-inv").documents


@pytest.fixture(scope="module")
def schedule_activities():
    return import_schedule(FIXTURES / "schedule.csv", "P-MAPPER-INVARIANTS").activities
