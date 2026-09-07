"""`document_mapping` ReviewRequest 생명주기 회귀 테스트 — 담당: qa (ADR 0007 §4 규칙 6, 8차 리뷰 REJECT 후속).

8차 리뷰 REJECT 사유: `ReviewRequest(kind="document_mapping")` 를 만드는 코드가 저장소 어디에도 없었다.
`ReviewKind` 에 값이 있고 blocker 가 CM 에게 "검토 큐에서 확정하라"고 안내했지만, 그 큐는 영원히 비어
있었고 582개 테스트 중 아무것도 실패하지 않았다. 이 파일은 그 침묵이 재발하지 않도록 실제 대장+공정표
적재 파이프라인으로 `map_project_documents`/`close_document_mapping_review` 를 직접 구동해 다음 여섯
항목을 못 박는다:

1. 생성 — 매핑 6건 = 열린 document_mapping 검토요청 6건(느슨한 `> 0` 아님).
2. 중복 방지 — 같은 대장 재실행 시 새 검토요청 없음, id 동일.
3. 확정 시 해소.
4. 고아화 시 해소(on_hold).
5. **확정이 재실행에 보존된다** — `map_documents_to_activities` 는 순수 함수라 재계산마다 새 후보를
   만드는데, `_drop_already_confirmed` 없이 그대로 upsert 하면 재업로드가 CM 확정을 조용히 되돌린다.
6. `conflicting_sources` 에 `drawing_id`/`entity_handle` 이 없다(있으면 services/sync 의 mapping 해소
   경로로 잘못 흘러 500 `mapping_review_data_corrupt`).

11차 QA 사이클(과제 2 — 큐 반려)에서 항목 7을 더한다: 반려는 `(activity_id, doc_id)` 쌍에만 매달린다 —
문서 제목이 바뀌면(→ ADR §2-1 대로 새 `doc_id`) 반려 이력과 무관한 새 후보가 정상 생성된다. 이 항목은
`reject_document_mapping`/`map_project_documents` 를 직접 구동한다(**resolve_review 를 통한 승인·반려
자체**는 tests/integration/test_15_document_mapping_queue_resolve.py 가 API 레벨로 고정한다 — 이 파일은
document_mapper 모듈 자체의 계약을 고정하는 자리라 기존 관례(직접 호출)를 그대로 따른다).

계획 0008 §과제 1(S1)에서 항목 8을 더한다: `document_mapping_reviews` 의 **반환 순서 축은 `created_at`
이고 DB 스캔 순서가 아니다**. 그 정렬(`services/progress/persistence.py::document_mapping_reviews` 의
`sorted(...)`)이 지키는 값은 취소가 싣는 `cancelled_review_request_id` = CM 이 "어느 결정을 취소했는가"를
읽는 값인데(ADR 0013 규칙 2), 그 줄을 `return rows` 로 바꿔도 기준선이 그대로였다(계획 0007 §후속 9,
`136e66f` 실측 **805 passed**). 이유는 테스트가 없어서가 아니라 **배역이 장식이어서**다 — SQLite 의 스캔
순서가 곧 삽입 순서이고 삽입 순서가 곧 `created_at` 순서라 두 구현이 같은 값을 낸다. 항목 8 은 두 순서를
어긋나게 **심어** 그 전제를 깬다. 소비자 쪽(취소가 실제로 싣는 id)은
`tests/integration/test_20_mapping_decision_cancel.py` 가 같은 사이클에서 붙든다.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import select

from packages.core.models.document import ActivityDocumentMapping
from packages.core.models.orm import ActivityDocumentMappingRow, FileRow, ReviewRequestRow
from packages.core.models.progress import Activity, Schedule
from services.ingest.persistence import persist_document_register_import
from services.progress import persistence as db
from services.progress.document_mapper import (
    cancel_document_mapping_review,
    close_document_mapping_review,
    map_project_documents,
    reject_document_mapping,
)
from services.progress.importers import import_schedule
from services.progress.importers.document_register import import_document_register
from tests.helpers.document_fixtures import make_document

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PROJECT_ID = "P-DOC-REVIEW-LC"
FILE_ID = "FILE-DOC-REVIEW-LC"
CM_USER = "cm-1"
EXPECTED_MAPPING_COUNT = 6   # tests/fixtures/document_register.xlsx(10건) x tests/fixtures/schedule.csv(6 Activity)


def _seed_register_and_schedule(session, project_id: str = PROJECT_ID, file_id: str = FILE_ID) -> None:
    """실제 대장(xlsx) + 공정표(csv) 를 파싱·적재해 map_project_documents 가 동작할 DB 상태를 만든다
    (모델을 직접 조립하는 대신 실제 파서·persist 경로를 태워 파이프라인 전체를 검증한다)."""
    db.ensure_project(session, project_id)
    if session.get(FileRow, file_id) is None:
        session.add(FileRow(file_id=file_id, project_id=project_id, kind="xlsx", filename="document_register.xlsx",
                            uri=f"mem://{file_id}", sha256="0" * 64, size=1))
        session.flush()
    import_result = import_document_register(FIXTURES / "document_register.xlsx", project_id, file_id)
    persist_document_register_import(session, project_id, file_id, import_result)
    schedule = import_schedule(FIXTURES / "schedule.csv", project_id)
    db.save_schedule(session, schedule)
    session.commit()


def _confirm(session, project_id: str, activity_id: str, doc_id: str, mapping: ActivityDocumentMapping,
            reviewed_by: str = CM_USER) -> list[str]:
    """`services/api/usecases.confirm_document_mapping` 의 핵심 두 단계(매핑 저장 + 검토요청 해소)를
    그대로 재현한다 — evidence 보존, reviewed_by 만 얹는다(ADR 0007 §4 규칙 7)."""
    confirmed = ActivityDocumentMapping(activity_id=activity_id, doc_id=doc_id, confidence=mapping.confidence,
                                        evidence=mapping.evidence, reviewed_by=reviewed_by)
    db.save_document_mapping(session, project_id, confirmed)
    closed = close_document_mapping_review(session, project_id, activity_id, doc_id, reviewed_by)
    session.commit()
    return closed


# ── 1. 생성: 매핑 6건 = 열린 document_mapping 검토요청 6건(정확히 일치, > 0 아님) ─────────────
def test_map_project_documents_creates_one_open_review_per_mapping(session):
    _seed_register_and_schedule(session)

    result = map_project_documents(session, PROJECT_ID)

    assert len(result.mappings) == EXPECTED_MAPPING_COUNT
    assert all(m.needs_review for m in result.mappings)
    assert len(result.created_review_ids) == EXPECTED_MAPPING_COUNT   # 매핑 수와 정확히 일치해야 한다

    open_reviews = db.open_reviews(session, PROJECT_ID, kind="document_mapping")
    assert len(open_reviews) == EXPECTED_MAPPING_COUNT
    assert {r.review_request_id for r in open_reviews} == set(result.created_review_ids)
    for r in open_reviews:
        assert r.kind == "document_mapping"
        assert r.assignee_role == "cm"
        assert r.status == "open"


# ── 2. 중복 방지: 같은 대장 재실행 → created_review_ids 비어 있음, 열린 요청 6건 그대로, id 동일 ──
def test_rerunning_same_register_creates_no_duplicate_reviews(session):
    _seed_register_and_schedule(session)
    map_project_documents(session, PROJECT_ID)
    session.commit()
    first_ids = {r.review_request_id for r in db.open_reviews(session, PROJECT_ID, kind="document_mapping")}
    assert len(first_ids) == EXPECTED_MAPPING_COUNT

    # 대장은 매주 재업로드된다 — map_project_documents 를 그대로 다시 돌린다(재파싱은 아니어도 무방,
    # 이 함수 자체가 재실행에 안전해야 하는 대상이다).
    second = map_project_documents(session, PROJECT_ID)
    session.commit()

    assert second.created_review_ids == []
    second_ids = {r.review_request_id for r in db.open_reviews(session, PROJECT_ID, kind="document_mapping")}
    assert second_ids == first_ids   # 새로 만들어지지도, 사라지지도 않는다 — id 까지 동일
    assert len(second_ids) == EXPECTED_MAPPING_COUNT


# ── 3. 확정 시 해소: 매핑을 확정하면 그 검토요청이 닫힌다 ─────────────────────────────────
def test_confirming_a_mapping_closes_its_review_request(session):
    _seed_register_and_schedule(session)
    result = map_project_documents(session, PROJECT_ID)
    session.commit()
    m = result.mappings[0]
    review = db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id)
    assert review is not None

    closed_ids = _confirm(session, PROJECT_ID, m.activity_id, m.doc_id, m)

    assert closed_ids == [review.review_request_id]
    assert db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id) is None
    row = session.get(ReviewRequestRow, review.review_request_id)
    assert row.status == "approved"
    assert row.resolved_by == CM_USER
    # 다른 5건은 그대로 열려 있어야 한다(과잉 해소 금지)
    still_open = db.open_reviews(session, PROJECT_ID, kind="document_mapping")
    assert len(still_open) == EXPECTED_MAPPING_COUNT - 1


# ── 4. 고아화 시 해소: 문서가 is_orphaned=True 가 되면 열린 검토요청이 on_hold 로 닫힌다 ──────
def test_document_becoming_orphaned_closes_its_open_review(session):
    _seed_register_and_schedule(session)
    result = map_project_documents(session, PROJECT_ID)
    session.commit()
    m = result.mappings[0]
    review = db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id)
    assert review is not None

    doc_row = db.load_document(session, PROJECT_ID, m.doc_id)
    doc_row.is_orphaned = True
    session.commit()

    result2 = map_project_documents(session, PROJECT_ID)
    session.commit()

    assert review.review_request_id in result2.closed_review_ids
    assert db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id) is None
    row = session.get(ReviewRequestRow, review.review_request_id)
    assert row.status == "on_hold"
    assert row.resolved_by is None   # 시스템이 닫은 것이지 사람의 판단이 아니다(ADR 0001 §6)
    # 나머지 5건 문서는 살아있으니 그 검토요청은 그대로 열려 있어야 한다
    still_open = db.open_reviews(session, PROJECT_ID, kind="document_mapping")
    assert len(still_open) == EXPECTED_MAPPING_COUNT - 1


# ── 5. [최우선] 확정이 재실행에 보존된다 — 재업로드가 CM 확정을 조용히 되돌리면 안 된다 ────────
def test_confirmed_mapping_survives_rerun_and_its_closed_review_stays_closed(session):
    """`map_documents_to_activities` 는 순수 함수라 재계산마다 needs_review=True 인 새 후보를 만든다.
    `_drop_already_confirmed` 가 없으면 이 재실행이 확정을 되돌리고 방금 닫은 검토요청을 재생성한다 —
    대장은 매주 재업로드되는 경로이므로 이게 깨지면 회귀가 조용히, 매주 반복된다."""
    _seed_register_and_schedule(session)
    result = map_project_documents(session, PROJECT_ID)
    session.commit()
    m = result.mappings[0]
    review = db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id)
    assert review is not None
    review_id = review.review_request_id

    _confirm(session, PROJECT_ID, m.activity_id, m.doc_id, m)
    row_after_confirm = session.get(ActivityDocumentMappingRow, (PROJECT_ID, m.activity_id, m.doc_id))
    assert row_after_confirm.needs_review is False
    assert row_after_confirm.reviewed_by == CM_USER

    # 대장 재업로드를 흉내낸다: map_project_documents 를 다시 돌린다(재계산은 매번 needs_review=True
    # 인 새 후보를 만든다는 사실 자체는 순수 함수 계약이므로 바뀌지 않는다).
    result2 = map_project_documents(session, PROJECT_ID)
    session.commit()

    row_after_rerun = session.get(ActivityDocumentMappingRow, (PROJECT_ID, m.activity_id, m.doc_id))
    assert row_after_rerun.needs_review is False, "재실행이 CM 확정을 조용히 미확정으로 되돌렸다"
    assert row_after_rerun.reviewed_by == CM_USER, "재실행이 reviewed_by 를 지웠다"

    # 방금 닫은 검토요청이 다시 열리지 않는다 — 새로 만들어지지도, 기존 것이 open 으로 되돌아가지도 않는다
    assert review_id not in result2.created_review_ids
    assert db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id) is None
    row = session.get(ReviewRequestRow, review_id)
    assert row.status == "approved"   # 여전히 확정 상태로 닫혀 있다(open 으로 되돌아가지 않음)


# ── 6. conflicting_sources 에 drawing_id/entity_handle 이 없다(ADR §4 규칙 6 경고) ───────────
def test_review_conflicting_sources_never_carries_drawing_or_entity_keys(session):
    """있으면 services/sync/review_queue.resolve_mapping_review 가 다른 구조를 기대해
    mapping_review_data_corrupt(500) 로 깨진다 — 코드를 읽어야만 아는 함정이라 테스트로 고정한다."""
    _seed_register_and_schedule(session)
    map_project_documents(session, PROJECT_ID)
    session.commit()

    reviews = db.open_reviews(session, PROJECT_ID, kind="document_mapping")
    assert reviews   # 회귀 방지: 비어 있으면 이 불변식은 공허하게 참이 된다
    for r in reviews:
        keys = set((r.conflicting_sources or {}).keys())
        assert "drawing_id" not in keys
        assert "entity_handle" not in keys


# ── 7(과제 2-6). 반려는 (activity_id, doc_id) 쌍에만 매달린다 — 제목이 바뀌면(새 doc_id) ──────
#    반려 이력과 무관한 새 후보가 정상 생성된다(ADR §4-2 규칙 7, reject_document_mapping 문서화 그대로) ──
def test_rejection_pinned_to_doc_id_survives_recompute_but_not_a_renamed_title(session):
    """`reject_document_mapping`은 옛 `doc_id`에만 반려 표시를 남긴다. 제목이 수정되면 ADR §2-1대로
    `doc_id`가 바뀌어 **다른 문서**가 되므로, 그 새 doc_id는 반려 이력 없이 정상적인 새 후보로 취급돼야
    한다 — 별도 코드 없이 키 설계에서 이미 그렇게 동작해야 한다는 주장을 실제로 실행해 확인한다."""
    db.ensure_project(session, PROJECT_ID)
    title = "리네임 테스트 대상 시공상세도"
    schedule = Schedule(schedule_id=f"{PROJECT_ID}:rename-test", project_id=PROJECT_ID,
                        activities=[Activity(activity_id="A-RENAME", name=title, discipline="structure")],
                        relations=[], source_format="csv")
    db.save_schedule(session, schedule)
    make_document(session, PROJECT_ID, "doc-title-v1", title=title, approval_status="APPROVED")
    session.commit()

    result = map_project_documents(session, PROJECT_ID)
    session.commit()
    assert ("A-RENAME", "doc-title-v1") in {(m.activity_id, m.doc_id) for m in result.mappings}
    review_v1 = db.open_document_mapping_review(session, PROJECT_ID, "A-RENAME", "doc-title-v1")
    assert review_v1 is not None
    review_v1_id = review_v1.review_request_id

    # reject_document_mapping 은 매핑 행만 다룬다(그 요청을 status="rejected" 로 닫는 것은 api 소유 —
    # resolve_review 가 이미 하고 있고, tests/integration/test_15_...가 그 경로를 API 레벨로 고정한다).
    # 여기서는 document_mapper 자체의 계약(재계산이 반려를 되돌리지 않는다)만 본다.
    reject_document_mapping(session, PROJECT_ID, "A-RENAME", "doc-title-v1", CM_USER, note="관련 없는 문서")
    session.commit()
    row_v1 = session.get(ActivityDocumentMappingRow, (PROJECT_ID, "A-RENAME", "doc-title-v1"))
    assert row_v1.needs_review is False and row_v1.reviewed_by == CM_USER

    # "매주 재업로드"를 두 번 흉내내도 반려된 쌍은 되살아나지 않는다(과제 2-2 와 같은 불변식): 매핑은
    # 재생성되지 않고, 그 쌍의 검토요청도 같은 행 그대로다(새로 만들어지거나 중복되지 않는다).
    for _ in range(2):
        result = map_project_documents(session, PROJECT_ID)
        session.commit()
    assert ("A-RENAME", "doc-title-v1") not in {(m.activity_id, m.doc_id) for m in result.mappings}
    review_v1_after = db.open_document_mapping_review(session, PROJECT_ID, "A-RENAME", "doc-title-v1")
    assert review_v1_after is not None and review_v1_after.review_request_id == review_v1_id

    # 문서 제목이 수정된다 -> 새 doc_id. 반려는 옛 doc_id 에만 매달려 있으므로 새 후보가 정상 생성돼야 한다
    make_document(session, PROJECT_ID, "doc-title-v2", title=title, approval_status="APPROVED")
    session.commit()
    result2 = map_project_documents(session, PROJECT_ID)
    session.commit()

    row_v2 = session.get(ActivityDocumentMappingRow, (PROJECT_ID, "A-RENAME", "doc-title-v2"))
    assert row_v2 is not None
    assert row_v2.needs_review is True and row_v2.reviewed_by is None   # 반려 이력이 새 doc_id 로 전혀 새지 않는다
    assert ("A-RENAME", "doc-title-v2") in {(m.activity_id, m.doc_id) for m in result2.mappings}
    new_review = db.open_document_mapping_review(session, PROJECT_ID, "A-RENAME", "doc-title-v2")
    assert new_review is not None and new_review.status == "open"   # 새 후보의 검토요청이 정상 생성된다

    # 옛 doc_id 쪽 반려 표시는 그대로 남아 있다(감사 이력 보존, 새 doc_id 처리가 옛 행을 건드리지 않는다)
    row_v1_after = session.get(ActivityDocumentMappingRow, (PROJECT_ID, "A-RENAME", "doc-title-v1"))
    assert row_v1_after.evidence["extra"]["mapping_review_decision"] == "rejected"


# ── 8(계획 0008 §과제 1, S1). `document_mapping_reviews` 의 반환 순서 축은 `created_at` 이고 ────────
#    DB 스캔 순서가 아니다 — 두 순서를 **어긋나게 심어** 그 정렬을 관측 가능하게 만든다 ────────────
def _plant_row_at_end_of_scan(session, review_request_id: str) -> None:
    """그 요청 행을 **컬럼 값을 하나도 바꾸지 않고** 지웠다 같은 값으로 다시 넣는다.

    SQLite 에서 그 행은 새 rowid 를 받아 `ORDER BY` 없는 SELECT 의 스캔 **맨 뒤**로 간다.
    `created_at` 을 **고쳐서** 어긋나게 하는 대안은 기각됐다(계획 0008 §1-b-1): 그 배역에서는 옳은
    구현이 **이미 취소된 옛 결정의 행**을 지목하게 되어, 형제 테스트
    (`tests/integration/test_20_mapping_decision_cancel.py::test_cancelling_again_while_a_reopened_
    request_is_open_does_not_name_an_already_cancelled_decision`)가 "내면 안 된다"고 붙들어 둔 값을
    이 파일이 계약으로 고정하게 된다. **어긋나게 하는 축은 값이 아니라 물리 위치다.**
    """
    row = session.get(ReviewRequestRow, review_request_id)
    assert row is not None, review_request_id
    snapshot = {c.name: getattr(row, c.name) for c in ReviewRequestRow.__table__.columns}
    session.delete(row)
    session.flush()
    session.expunge_all()
    session.add(ReviewRequestRow(**snapshot))
    session.flush()
    session.commit()
    session.expire_all()


def _raw_scan_ids(session, project_id: str, activity_id: str, doc_id: str) -> list[str]:
    """`ORDER BY` 없는 SELECT 의 순서 그대로 — `document_mapping_reviews` 의 `sorted(...)` **직전** 상태다."""
    stmt = select(ReviewRequestRow).where(
        ReviewRequestRow.project_id == project_id,
        ReviewRequestRow.kind == "document_mapping",
        ReviewRequestRow.activity_id == activity_id,
    )
    return [r.review_request_id for r in session.scalars(stmt)
            if (r.conflicting_sources or {}).get("doc_id") == doc_id]


def test_document_mapping_reviews_orders_by_created_at_not_by_db_scan_order(session):
    """확정1 → 취소1 → 확정2 로 닫힌 행 둘을 만든 뒤 **확정1 의 행만 스캔 맨 뒤로** 옮기고,
    그래도 반환이 오래된 것부터인지 본다.

    **왜 이 배역이어야 하는가(CLAUDE.md §6-2 1).** 심지 않으면 SQLite 의 스캔 순서가 곧 삽입 순서이고
    삽입 순서가 곧 `created_at` 순서라, `return sorted(rows, key=...)` 와 `return rows` 가 **같은 값**을
    낸다 — 그 배역으로 세운 단언은 결함 있는 코드도 그대로 만족한다(장식). 실측(계획 0008 §1-b 2×2 표,
    이 사이클에서 재측정): 심지 않은 대조군은 두 구현 모두 옳은 답을 내고, 심은 배역에서만 갈린다.

    **심기가 먹혔다는 것을 이 테스트가 스스로 단언한다**(§1-b-3). 인덱스·플래너·DB 가 바뀌어 스캔
    순서가 그대로면 위 대조군으로 떨어져 두 구현이 다시 구별되지 않는데, 그때 테스트는 **조용히
    장식이 된다** — 이 저장소의 지배적 실패 모드다. 그래서 심기 전후의 raw 스캔 순서를 함께 단언한다.
    이 트리의 실행값: 심기 전 `['R1','R2']` · 심기 뒤 `['R2','R1']`, 함수 반환은 **양쪽 다** `['R1','R2']`.

    **이 층만으로는 과잉 고정이다** — 정렬을 지우고 소비자에서 `max(key=created_at)` 로 옮긴 구현은
    여기서만 죽고 계약은 지켜진다. 그것이 의도다(계획 0008 §1-c 역방향 확인): 지금 계약을 지키는 것은
    그 `sorted(...)` 한 줄뿐이고, 그 줄을 지워도 기준선이 그대로라는 것이 §후속 9 였다. 이 순서를
    **누가 왜 읽는가**(취소가 싣는 `cancelled_review_request_id`)는 통합 층이 붙든다.
    """
    _seed_register_and_schedule(session)
    result = map_project_documents(session, PROJECT_ID)
    session.commit()
    m = result.mappings[0]

    # ── 확정1 → 취소1 → 확정2. 닫힌 행 둘(R1 = 확정1 을 기록한 행, R2 = 확정2 를 기록한 행) + 열린 행 0.
    first_review = db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id)
    assert first_review is not None
    r1 = first_review.review_request_id
    _confirm(session, PROJECT_ID, m.activity_id, m.doc_id, m)

    cancelled, _ = cancel_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id,
                                                  CM_USER, note="확정1 을 취소한다")
    session.commit()
    reopened = db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id)
    assert reopened is not None and reopened.review_request_id != r1
    r2 = reopened.review_request_id
    _confirm(session, PROJECT_ID, m.activity_id, m.doc_id, cancelled)

    assert db.open_document_mapping_review(session, PROJECT_ID, m.activity_id, m.doc_id) is None
    assert [r.review_request_id for r in db.document_mapping_reviews(session, PROJECT_ID, m.activity_id,
                                                                     m.doc_id)] == [r1, r2]

    # ⓐ 심기 **전**: 스캔 순서 = 삽입 순서 = created_at 순서. 이 칸이 곧 "심지 않으면 두 구현이
    #    구별되지 않는다"의 관측값이다.
    assert _raw_scan_ids(session, PROJECT_ID, m.activity_id, m.doc_id) == [r1, r2]
    created_before = {r.review_request_id: r.created_at
                      for r in db.document_mapping_reviews(session, PROJECT_ID, m.activity_id, m.doc_id)}
    assert created_before[r1] < created_before[r2]

    _plant_row_at_end_of_scan(session, r1)

    # ⓑ 심기가 **먹혔다**: 스캔 순서만 뒤집혔다. 이 단언이 없으면 심기가 안 먹었을 때 아래 ⓒ 가
    #    조용히 장식이 된다.
    assert _raw_scan_ids(session, PROJECT_ID, m.activity_id, m.doc_id) == [r2, r1], \
        "심기가 먹지 않았다 — 스캔 순서가 그대로면 이 테스트는 정렬 유무를 구별하지 못한다"

    # ⓒ 값은 하나도 바뀌지 않았다(`status`·`resolved_by` 를 건드렸다면 `closed` 필터 자체가 달라져
    #    무엇이 갈렸는지 모른다).
    after_rows = {r.review_request_id: r for r in
                  db.document_mapping_reviews(session, PROJECT_ID, m.activity_id, m.doc_id)}
    assert {k: v.created_at for k, v in after_rows.items()} == created_before
    assert {k: (v.status, v.resolved_by) for k, v in after_rows.items()} == \
        {r1: ("approved", CM_USER), r2: ("approved", CM_USER)}

    # ⓓ 계약: 반환은 **오래된 것부터**다 — 스캔 순서가 아니라 `created_at` 이 축이다.
    assert [r.review_request_id for r in db.document_mapping_reviews(session, PROJECT_ID, m.activity_id,
                                                                     m.doc_id)] == [r1, r2], \
        "반환 순서가 DB 스캔 순서를 따라갔다 — `document_mapping_reviews` 의 정렬이 사라졌다"
