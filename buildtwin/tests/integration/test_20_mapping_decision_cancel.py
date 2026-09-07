"""ADR 0013 — 매핑 결정(확정·반려)의 취소. 계획 0006 §검증 시나리오 V1~V9,
계획 0008 §과제 1 S2(취소가 지목하는 결정의 **정렬 계약**).

## 이 파일이 붙들고 있는 것

ADR 0013 §"이 불변식을 지금 무엇이 붙들어 주는가"가 스스로 적었다: 취소 경로는 **넣자마자 무보호**다.
아래는 서버 쪽 변이를 하나씩 **개별로** 적용해 재현한 무보호 목록과, 이 파일의 어느 단언이 그것을
잡는지다(각 변이는 원복 전 저장소 루트에서 `git status --porcelain` 전문으로 확인했다).

**표와 docstring 의 `NNN passed` 는 그 값을 잰 트리에 매인 값이지 오늘의 기준선이 아니다.** 그래서
형제 파일 `tests/integration/test_19_rejection_reason.py` 머리와 같이 **커밋(또는 그때의 기준선)과
함께** 적는다(CLAUDE.md §3-13). 커밋을 못 박지 않은 절대값은 이 파일에 테스트가 하나 늘 때마다
조용히 거짓이 되고, 실제로 세 값이 그렇게 낡아 있었다(계획 0008 §1-e 2행 — 이 사이클이 갱신했다).

| 변이 | 잡는 자리 |
|---|---|
| `reviewed_by` 를 남긴 **반쪽 취소**(모델을 우회해 행에 직접 쓴다) | `test_v1_...` 의 DB 행 단언 + `drawing_approval != 1.0` + `confirmed_required_documents` 부재. 그리고 그 반쪽 상태가 **모델로는 표현조차 되지 않는다**는 구조적 성질은 `tests/unit/progress/test_document_mapper_invariants.py::test_model_cannot_express_half_cancelled_mapping` |
| 반려 표시 4키를 안 지운다 | `test_v2_...` 의 `_REJECTION_MARKER_KEYS` 부재 단언(readiness 네 칸은 이 변이에서 **완전히 같다** — ADR 0013 §Context 3 표 3행 vs 4행. 값으로 세운 단언은 이 변이를 못 잡는다) |
| 취소가능 검사(`reviewed_by is None` → 409) 삭제 | `test_v7_...`(무동작 200 이 되면 죽는다) |
| 사유 검사 삭제 | `test_v5_...` |
| 옛 요청 행을 되열어 재사용(`_reopen_reviews_for_invalidated_confirmations` 모양) | `test_v1_...`·`test_v2_...` 의 **옛 행 감사** 단언(`resolved_by`·`resolved_at`·`resolution_note` 가 살아 있다). "open 요청 1건"만 보면 통과하므로 둘을 함께 단언한다(CLAUDE.md §6-2 4) |
| 새 요청을 안 연다 | 같은 두 테스트의 open 요청 단언 + 같은 자리에서 readiness blocker `document_mapping_pending` 를 함께 본다(큐가 비었는데 readiness 는 "대기"라고 말하는 것이 이 저장소의 지배적 실패 모드다) |
| `errors.py` 의 전용 핸들러 둘 삭제 | 409 응답의 `code` 단언(예외가 `Exception` 직속이라 핸들러가 없으면 **500 + code 없음**) |
| 취소 이력 append → 덮어쓰기 | `test_v9_...`(2회 취소 후 길이 2) |
| 제목의 방향 낱말을 **반전**(`what` 삼항의 두 갈래 맞바꿈) | `test_v1_...`·`test_v2_...` 의 **부재 단언**(확정 취소 뒤 "반려를"이 없다 / 반려 취소 뒤 "확정을"이 없다). `df37433` 에 추가 — 그 커밋 **직전** 트리에서 **804 passed**, 즉 CM 이 다음 행동을 고르는 문구가 무보호였다(CLAUDE.md §6-4). 문장을 통째로 베끼지 않으므로 제목 전면 재작성(방향은 옳게)에서는 죽지 않는다 — 태워서 확인했다 |
| `cancelled_review_request_id` 를 **첫** 닫힌 행으로(`closed[-1]` → `closed[0]`) | `test_v9_...`(닫힌 행이 둘 쌓인 뒤에야 갈린다 — 하나뿐이면 두 구현이 같은 id 를 낸다). `df37433` 에 추가 |
| **갱신 갈래에서도** `cancelled_review_request_id` 를 닫힌 행으로(계획 0006 §후속 7 이전 구현 — `closed[-1]`) | `test_cancelling_again_while_a_reopened_request_is_open_...`(닫힌 옛 행이 **남은 채** 갱신 갈래로 드는 배역이라야 갈린다 — 형제 테스트의 배역에는 닫힌 행이 없어 두 구현이 같은 `None` 을 낸다). 계획 0006 §후속 7 로 추가 |
| 검사 순서 맞바꿈(사유 검사를 앞으로) | `test_v7_...` 의 **두 요건 동시 위반** 칸(취소할 결정이 없는 CM 에게 "적을 수 없는 사유"를 요구하면 죽는다) |
| `persistence.py::document_mapping_reviews` 의 `sorted(rows, key=lambda r: r.created_at)` → `return rows` | `test_cancel_names_the_decision_by_created_at_...`(계획 0008 §과제 1 로 추가 — 그 전에는 **805 passed** = 기준선 그대로였다, 잰 트리 `136e66f`. 단위 짝은 `tests/unit/progress/test_document_mapping_review_lifecycle.py::test_document_mapping_reviews_orders_by_created_at_...`). **닫힌 행 둘을 만든 뒤 두 행의 스캔 순서를 `created_at` 역순으로 어긋나게 해야** 갈린다 — 어긋나게 하지 않으면 SQLite 의 스캔 순서가 곧 `created_at` 순서라 두 구현이 같은 id 를 낸다(실행값은 그 테스트 docstring 의 2×2 표). **그 어긋냄을 힙 배치로 만들지 않는다** — ADR 0015, `_make_scan_order_disagree_with_created_at` |
| `usecases.py::cancel_document_mapping_review` 의 `record_expert_review(...)` 세 줄 삭제 | `test_cancelling_leaves_a_durable_expert_review_log_row_...`(계획 0006 §후속 5 로 `716d67d` 에 추가 — 그 커밋 **직전** 트리에서 **803 passed**, 즉 감사의 정본이 무보호였다) |

**반려 방향을 값(`drawing_approval`·`score`)으로 단언하지 않는다.** 실측상 반려 전후가 0.5/0.625 로
같아서 결함 코드와 정상 코드가 구별되지 않는다(ADR 0013 §Context 3 (2)). 그 방향에서 갈리는 관측값은
`blockers[]`(kind·reason·존재)와 `evidence.note` 둘뿐이다.

## 배역 (test_15 와 같은 픽스처 조합·같은 상수)

`schedule.csv`(Activity 6개) × `document_register.xlsx`(TFA 8·TFR 2) = 매핑 정확히 6건. 값 축이 움직이는
배역을 일부러 고른다 — `A100` 에 매핑되는 문서는 처리결과 `APPROVED` 인 TFA 라 확정하면
`drawing_approval` 이 1.0 이 되고, 취소하면 다시 내려온다(그렇지 않은 배역이면 결함이 있어도 값이 같다).

| Activity | 무엇에 쓰는가 |
|---|---|
| `A100` | 확정 → 취소(V1·V3·V4) — 값 축이 움직이는 방향. 그리고 파일 맨 뒤에서 **확정2 → 재오픈 → 취소2**(계획 0006 §후속 7) — 닫힌 옛 행이 남은 채 갱신 갈래로 드는 유일한 배역이다 |
| `A400` | 반려 → 취소(V2) — 값 축이 **안** 움직이는 방향 |
| `A300` | 사유 요건(V5) → 무제한 취소(V9) |
| `A200` | 취소할 결정이 없는 대조군(V7) · 인가(V6) · 404. 그 뒤 **확정1 → 취소1 → 확정2 → 스캔 순서 어긋냄 → 취소2**(계획 0008 §과제 1) — 이 쌍에 **처음으로** 결정을 세우므로 앞의 어떤 단언도 낡게 만들지 않는다 |
| `A110` | 재확인으로 **이미 열린 요청**이 있는 상태의 취소(중복 방지) |
| `A120` | 취소의 **내구 감사**(`expert_review_logs` 행) — 재계산을 한 번 더 부르므로 뒤쪽에 둔다(맨 뒤는 공정표를 다시 올리는 §후속 7 테스트다) |

**테스트 순서가 계약의 일부다**(test_15 와 같은 모양): 같은 프로젝트를 순서대로 공유하고, 대장·공정표
재업로드처럼 프로젝트 전체를 재계산하는 시나리오는 **맨 뒤**에 둔다. 재계산은 미확정(=취소된) 매핑의
`evidence` 를 새 후보로 덮어쓰므로 그 앞에서 잰 이력 단언이 무의미해진다(§V8 참고 — 그 사실 자체를
V8 이 관측값으로 적는다).
"""
from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

import pytest
from sqlalchemy import literal_column, select, text

from packages.core.db import session_scope
from packages.core.models.orm import ActivityDocumentMappingRow, ExpertReviewLogRow, ReviewRequestRow
from services.progress.config_loader import load_readiness_config
from services.progress.document_mapper import confirmed_required_documents

from .conftest import FIXTURES, add_member, upload

A_CONFIRM = "A100"     # 확정 → 취소
A_REJECT = "A400"      # 반려 → 취소
A_REASON = "A300"      # 사유 요건 → 무제한 취소
A_PENDING = "A200"     # 취소할 결정이 없는 대조군
A_REOPENED = "A110"    # 재확인 요청이 열린 채인 확정의 취소
A_AUDIT = "A120"       # 취소의 내구 감사(expert_review_logs) — 이 파일에서 이 Activity 만 쓴다
EXPECTED_MAPPING_COUNT = 6

# 취소가 남기는 `expert_review_logs` 행을 확정이 남기는 행과 가르는 키(ADR 0013 개정 1 — `final` 에 이
# 키가 있는 행이 취소다). 확정도 **같은** `entity_type`·`entity_id` 로 한 행을 남기므로
# (`services/api/usecases.py::_confirm_document_mapping_row`) 그냥 세면 확정 축까지 죽는 단언이 된다.
CANCEL_LOG_KEY = "cancelled_review_opened"

# 취소가 지워야 하는 반려 표시(`services/progress/document_mapper._REJECTION_MARKER_KEYS` 와 같은 넷).
# 여기 다시 적는 이유는 **테스트가 구현 상수를 import 하면 그 상수가 비어도 초록**이기 때문이다.
REJECTION_MARKER_KEYS = ("mapping_review_decision", "rejected_by", "rejected_at", "rejection_note")
CANCELLED_REVIEWS_KEY = "cancelled_mapping_reviews"

BLANK = "   "          # 공백만. 화면은 `ConfirmDialog` 의 `!note.trim()` 로 잠그지만 API 직접 호출에는 없다.


@pytest.fixture(scope="module")
def cancel_project(client, auth, user_ids) -> str:
    """정상 순서(공정표 → 대장)로 올려 6건의 매핑 + 6건의 열린 `document_mapping` 요청을 만든다."""
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "매핑 결정 취소 테스트"})
    assert r.status_code == 201, r.text
    project_id = r.json()["project_id"]
    for role in ("contractor", "cm", "client"):
        add_member(client, auth("admin"), project_id, user_ids[role], role)
    up1, job1 = upload(client, auth("contractor"), project_id, FIXTURES / "schedule.csv")
    assert up1["kind"] == "csv" and job1["status"] == "done", job1
    up2, job2 = upload(client, auth("cm"), project_id, FIXTURES / "document_register.xlsx")
    assert up2["kind"] == "xlsx" and job2["status"] == "done", job2
    assert job2["result"]["mapping_count"] == EXPECTED_MAPPING_COUNT, job2
    return project_id


# --------------------------------------------------------------------------- 읽기 헬퍼

def _reviews(client, auth, project_id: str, activity_id: str) -> list[dict]:
    """그 Activity 의 `document_mapping` 요청 전부(상태 무관)."""
    r = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"),
                   params={"kind": "document_mapping"})
    assert r.status_code == 200, r.text
    return [x for x in r.json() if x["activity_id"] == activity_id]


def _open_reviews(client, auth, project_id: str, activity_id: str) -> list[dict]:
    return [r for r in _reviews(client, auth, project_id, activity_id) if r["status"] == "open"]


def _closed_reviews(client, auth, project_id: str, activity_id: str) -> list[dict]:
    return [r for r in _reviews(client, auth, project_id, activity_id) if r["status"] != "open"]


def _doc_id_for(client, auth, project_id: str, activity_id: str) -> str:
    reviews = _reviews(client, auth, project_id, activity_id)
    doc_ids = {r["conflicting_sources"]["doc_id"] for r in reviews}
    assert len(doc_ids) == 1, f"expected one doc_id for {activity_id!r}, got {doc_ids}"
    return doc_ids.pop()


def _mapping(client, auth, project_id: str, doc_id: str, activity_id: str) -> dict:
    r = client.get(f"/api/documents/{doc_id}", headers=auth("cm"), params={"project_id": project_id})
    assert r.status_code == 200, r.text
    matches = [m for m in r.json()["mappings"] if m["activity_id"] == activity_id]
    assert len(matches) == 1, f"expected exactly one mapping ({activity_id}, {doc_id}), got {matches}"
    return matches[0]


def _readiness(client, auth, project_id: str, activity_id: str) -> dict:
    r = client.get(f"/api/activities/{activity_id}/readiness", headers=auth("cm"),
                   params={"project_id": project_id})
    assert r.status_code == 200, r.text
    return r.json()


def _drawing_blockers(score: dict) -> list[tuple[str | None, str | None]]:
    """`drawing_approval` blocker 의 `(kind, reason)` 전부. **잘라 적지 않는다** — 이 배역에는
    `kind: None` 인 blocker 가 섞여 있어(ADR 0013 §Context 3) kind 만 보면 1행(반려)과 2행(반쪽 취소)이
    갈리지 않는다."""
    return [(b.get("kind"), b.get("reason")) for b in score["blockers"] if b["component"] == "drawing_approval"]


def _row_fields(project_id: str, activity_id: str, doc_id: str) -> tuple[bool, str | None]:
    """저장된 행을 **직접** 읽는다(API 응답이 아니라). 반쪽 취소 변이는 모델을 우회해 행에 쓰므로
    응답 모양만 보는 단언으로는 잡히지 않을 수 있다."""
    with session_scope() as session:
        row = session.get(ActivityDocumentMappingRow, (project_id, activity_id, doc_id))
        assert row is not None
        return bool(row.needs_review), row.reviewed_by


def _confirmed_doc_ids(project_id: str, activity_id: str) -> list[str]:
    """readiness 의 `drawing_approval` 순위 1 이 실제로 세는 확정 문서 집합(ADR 0013 V3)."""
    doc_cfg = load_readiness_config().get("document_approval", {})
    with session_scope() as session:
        evidence = confirmed_required_documents(session, project_id, [activity_id], doc_cfg)
        return [d.doc_id for d in evidence.confirmed_required]


def _cancel(client, auth, project_id: str, activity_id: str, doc_id: str, *, role: str = "cm",
            note: str | None = "취소 사유"):
    body = None if note is None else {"note": note}
    return client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/cancel-review",
                       headers=auth(role), params={"project_id": project_id}, json=body)


def _confirm(client, auth, project_id: str, activity_id: str, doc_id: str, note: str):
    r = client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/confirm", headers=auth("cm"),
                    params={"project_id": project_id}, json={"note": note})
    assert r.status_code == 200, r.text
    return r.json()


def _history(mapping: dict) -> list[dict]:
    return list(mapping["evidence"]["extra"].get(CANCELLED_REVIEWS_KEY) or [])


class _Log(NamedTuple):
    log_id: str
    entity_type: str
    reviewer: str
    proposal: dict
    final: dict


def _cancel_logs(activity_id: str, doc_id: str) -> list[_Log]:
    """그 쌍의 `expert_review_logs` 행 중 **취소가 남긴 것만**, 오래된 순서로.

    읽는 라우트가 없어서(`grep -rn "expert" services/api/routers/` → 히트 0) 행을 직접 읽는다.
    `entity_id` 로만 거르고 `entity_type` 은 **거르지 않고 단언한다** — 걸러 버리면 그 값이 바뀐 구현이
    "행이 0" 으로 죽어 무엇이 틀렸는지 실패 메시지에 남지 않는다.
    """
    with session_scope() as session:
        rows = list(session.scalars(
            select(ExpertReviewLogRow)
            .where(ExpertReviewLogRow.entity_id == f"{activity_id}:{doc_id}")
            .order_by(ExpertReviewLogRow.reviewed_at)))
        return [_Log(r.log_id, r.entity_type, r.reviewer, dict(r.proposal), dict(r.final))
                for r in rows if CANCEL_LOG_KEY in r.final]


def _raw_review_scan(project_id: str, activity_id: str, doc_id: str) -> list[tuple]:
    """그 쌍의 요청 행을 **`ORDER BY` 없이** 읽는다 — `document_mapping_reviews` 의 `sorted(...)` 직전
    상태다. `(id, status, resolved_by, created_at)` 를 함께 실어 **순서**와 **값**을 한 번에 비교한다."""
    with session_scope() as session:
        stmt = select(ReviewRequestRow).where(
            ReviewRequestRow.project_id == project_id,
            ReviewRequestRow.kind == "document_mapping",
            ReviewRequestRow.activity_id == activity_id,
        )
        return [(r.review_request_id, r.status, r.resolved_by, r.created_at)
                for r in session.scalars(stmt)
                if (r.conflicting_sources or {}).get("doc_id") == doc_id]


def _heap_probe(session, labelled: dict[str, str]) -> str:
    """힙 배치 진단(ADR 0015 §2-4) — **postgres 축에서만 값을 갖는다.**

    싣는 것은 각 행의 `ctid` 와 그 시점의 `n_dead_tup`·`autovacuum_count`·`vacuum_count` 다. 다음
    발생에서 계획 0009 §M-5 21 의 세 축(ⓐ 컨테이너 사망 ⓑ 재배치 비결정성 ⓒ 그 밖)이 **재현 없이**
    출력 한 줄로 갈리게 하는 것이 이 함수의 전부다 — 어떤 단언의 **기대값**도 아니다(ADR 0015 §2-1
    역방향 확인: 금지되는 것은 관측이 아니라 기댐이다).

    sqlite 축에는 `ctid` 도 `pg_stat_all_tables` 도 없다. **없는 값을 지어내지 않고 빈 문자열을
    돌려준다**(CLAUDE.md §6-4 2 — 모르는 값은 모른다고 적고 폴백을 두지 않는다). 호출부가 그 빈
    문자열을 "진단 없음"이라고 말한다.
    """
    if session.get_bind().dialect.name != "postgresql":
        return ""
    rows = dict(session.execute(
        select(ReviewRequestRow.review_request_id, literal_column("ctid::text"))
        .where(ReviewRequestRow.review_request_id.in_(list(labelled.values())))).all())
    stats = session.execute(text(
        "SELECT n_dead_tup, autovacuum_count, vacuum_count FROM pg_stat_all_tables "
        "WHERE relid = 'review_requests'::regclass")).first()
    place = " ".join(f"{label}={rows.get(rid, '없음')}" for label, rid in labelled.items())
    counters = "pg_stat 행 없음" if stats is None else \
        f"n_dead_tup={stats[0]} autovacuum_count={stats[1]} vacuum_count={stats[2]}"
    return f"{place} {counters}"


def _make_scan_order_disagree_with_created_at(earlier_id: str, later_id: str) -> str:
    """두 요청 행을 **컬럼 값을 하나도 바꾸지 않고**(`created_at` 포함) 지웠다 `created_at` **역순**으로
    다시 넣어, `ORDER BY` 없는 조회가 **늦은 행을 이른 행보다 먼저** 돌려주게 만든다.

    **이름이 착지를 약속하지 않는다**(ADR 0015 §2-1). 옛 이름 `_plant_row_at_end_of_scan` 은 "그 행이
    스캔 맨 뒤에 앉는다"를 약속했는데 그것은 **postgres 에서 계약이 아니다**: 재배치 직전에
    `VACUUM review_requests` 가 한 번 돌면(autovacuum 이 하는 일과 같다) 되돌아온 line pointer 를 다음
    `INSERT` 가 먼저 집어 그 행이 **앞으로** 간다. 실행값(로컬 PostgreSQL 16.13, **잰 트리 `a9b85d3`**
    = 이 커밋의 부모): 강제 `VACUUM` 아래 대상 `ctid` 가 `(0,7)` → **`(0,4)`** 로 가고 아래 단언이
    죽는다(N=1 — 계획 0010 §1-b 가 같은 조건으로 N=5, 5/5 적색을 쟀다). `VACUUM` 이 없으면 `(0,10)`.

    그래서 만드는 것은 **두 행의 상대 순서**뿐이다: 둘을 함께 지우고 **늦은 행 → 이른 행** 순으로 다시
    넣는다. 먼저 넣은 행이 먼저 자리를 잡으므로 늦은 행이 앞선다 — 이 트리의 실행값(같은 강제 `VACUUM`
    조건, **N=10 · 10/10 초록**): 늦은 행 `(0,4)`(되돌아온 line pointer) · 이른 행 `(1,1)`(그 페이지에
    자리가 없어 **다음** 페이지). sqlite 에서는 새 rowid 가 증가하므로 같은 결과다.
    **이것도 보장은 아니다** — 두 번째 `INSERT` 가 FSM 을 통해 **앞 페이지**로 갈 수 있다(계획 0010
    §1-c). 그래서 만들어졌는지를 **호출부가 그 자리에서 단언하고**(ADR 0015 §2-2), 이 함수는 그 단언이
    실을 **진단**을 돌려준다(§2-4).

    `created_at` 을 **고쳐서** 어긋나게 하는 대안은 기각됐다(계획 0008 §1-b-1): 그 배역에서는 옳은
    구현이 **이미 취소된 옛 결정의 행**을 지목하게 되어, 아래 형제 테스트가 "내면 안 된다"고 붙들어
    둔 값을 이 파일이 계약으로 고정한다.

    *무정렬 조회가 실제로 무엇을 따라가는가*(계획 0010 §확인하지 않은 것 3 이 `qa` 에게 이 작업에서
    재라고 배정한 칸). 이 배역의 `EXPLAIN` 실행값은 **`Seq Scan` 이 아니다**:
    `Index Scan using ix_review_requests_kind … Index Cond: kind = 'document_mapping'`.
    그런데도 반환이 `ctid` 오름차순인 것은 btree 가 같은 키의 중복을 **heap TID 순서**로 담기
    때문이다(PostgreSQL 12+). 같은 실행의 값: 재배치 전 `(0,7) (0,9)` → 재배치 뒤 `(0,10) (1,1)`
    (강제 `VACUUM` 없는 조건, N=1). 즉 이 어긋냄이 서 있는 자리는 **그 인덱스**이고, 인덱스가 바뀌면
    다시 재야 한다 — 그때 아래 단언이 그 자리에서 죽는다.
    """
    with session_scope() as session:
        labelled = {"이른행": earlier_id, "늦은행": later_id}
        before = _heap_probe(session, labelled)
        snapshots = []
        for rid in (later_id, earlier_id):            # 다시 넣는 순서 = `created_at` 역순
            row = session.get(ReviewRequestRow, rid)
            assert row is not None, rid
            snapshots.append({c.name: getattr(row, c.name) for c in ReviewRequestRow.__table__.columns})
            session.delete(row)
        assert snapshots[1]["created_at"] < snapshots[0]["created_at"], \
            "인자가 (이른 행, 늦은 행) 순서가 아니다 — 이 헬퍼가 만드는 것은 `created_at` 의 역순이다"
        session.flush()
        session.expunge_all()
        for snapshot in snapshots:
            session.add(ReviewRequestRow(**snapshot))
            session.flush()
        after = _heap_probe(session, labelled)
    if not before and not after:
        return "힙 진단 없음(sqlite 축 — `ctid` 도 `pg_stat_all_tables` 도 없다)"
    return f"재배치 전 [{before}] · 재배치 뒤 [{after}]"


# ═══════════════════════════════════════════════════════════════════════════
# V1 · V3 · V4 — 확정 → 취소 (값 축이 움직이는 방향)
# ═══════════════════════════════════════════════════════════════════════════
def test_v1_cancelling_a_confirmation_returns_the_pair_to_pending_and_reopens_the_queue(
        client, auth, cancel_project, user_ids):
    """확정을 취소하면 ① 매핑이 미확정으로 착지하고 ② 도면 승인 근거에서 빠지고 ③ 큐에 새 요청이
    **그 자리에서** 열리며 ④ 옛 요청 행의 감사가 그대로 남는다.

    §6-2 물음("이 기대값을 결함 있는 코드가 그대로 만족하는가?")에 대한 답:
    - 매핑 행을 건드리지 않고 요청만 여는 구현 → `drawing_approval` 이 1.0 그대로라 죽는다.
    - 표시만 지우고 `reviewed_by` 를 남기는 반쪽 구현 → 같은 이유로 1.0 이라 죽는다(§Context 3 표 2행).
    - 옛 행을 되열어 재사용하는 구현 → 옛 행 감사 단언에서 죽는다. **"open 1건"만 보면 통과하므로**
      둘을 함께 단언한다.
    - 재계산을 기다리는 구현 → 이 테스트는 재계산을 **부르지 않는다**.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_CONFIRM)
    confirm_note = "대장 확인 결과 이 문서가 맞다"
    _confirm(client, auth, pid, A_CONFIRM, doc_id, confirm_note)

    # 확정 상태의 기준값 — 취소가 실제로 무엇을 되돌리는지가 여기서 정해진다.
    before = _readiness(client, auth, pid, A_CONFIRM)
    assert before["components"]["drawing_approval"] == 1.0
    assert _drawing_blockers(before) == []
    assert "approved=1/1; pending_mappings=0" in before["evidence"]["note"]
    assert _confirmed_doc_ids(pid, A_CONFIRM) == [doc_id]
    old_review = _reviews(client, auth, pid, A_CONFIRM)
    assert [r["status"] for r in old_review] == ["approved"], old_review

    note = "다른 문서와 혼동해 확정했다 — 되돌린다"
    r = _cancel(client, auth, pid, A_CONFIRM, doc_id, note=note)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["needs_review"] is True and body["reviewed_by"] is None

    # ① 착지점: 응답만이 아니라 저장된 행도 미확정이다(모델을 우회한 반쪽 착지를 잡는 자리).
    assert _row_fields(pid, A_CONFIRM, doc_id) == (True, None)
    served = _mapping(client, auth, pid, doc_id, A_CONFIRM)
    assert served["needs_review"] is True and served["reviewed_by"] is None

    # ② 확정 증거에서 빠졌다 — 세 가지를 **함께** 단언한다(V3).
    after = _readiness(client, auth, pid, A_CONFIRM)
    assert after["components"]["drawing_approval"] != 1.0
    assert after["components"]["drawing_approval"] == \
        load_readiness_config()["component_defaults"]["drawing_approval_unknown"]
    assert doc_id not in _confirmed_doc_ids(pid, A_CONFIRM)
    assert "approved=0/0; pending_mappings=1" in after["evidence"]["note"]
    assert _drawing_blockers(after) == [("document_mapping_pending",
                                         "문서 매핑 1건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음")]

    # ③ 큐: 재계산을 부르지 않았는데 열린 요청이 정확히 1건이고, ④ 옛 행은 감사가 살아 있다.
    open_rows = _open_reviews(client, auth, pid, A_CONFIRM)
    closed_rows = _closed_reviews(client, auth, pid, A_CONFIRM)
    assert len(open_rows) == 1, open_rows
    assert [c["status"] for c in closed_rows] == ["approved"], closed_rows
    assert closed_rows[0]["review_request_id"] == old_review[0]["review_request_id"]
    assert closed_rows[0]["resolved_by"] == user_ids["cm"]
    assert closed_rows[0]["resolved_at"]
    assert confirm_note in (closed_rows[0]["resolution_note"] or "")

    # 새 요청은 "어느 결정을 왜 취소했는가"를 싣는다(ADR 0013 규칙 2).
    sources = open_rows[0]["conflicting_sources"]
    assert sources["doc_id"] == doc_id
    assert sources["cancelled_review_request_id"] == closed_rows[0]["review_request_id"]
    assert sources["cancel_note"] == note

    # 제목은 CM 이 다음 행동을 고르는 **유일한 입력**이다(CLAUDE.md §6-4). 문장을 통째로 베끼면 거짓
    # 문구가 계약이 되므로(§6-4 3) 베끼지 않고 **그 상황에서 참일 수 없는 말의 부재**만 단언한다 —
    # 확정을 취소한 자리에서 "반려를"은 참일 수 없다. 기계 판독값 `previous_decision` 은 바로 위
    # 이력 단언이 붙들고 있으므로 여기서 닫는 것은 그 값을 **렌더링하는 한 칸**이다.
    assert "반려를" not in open_rows[0]["title"], open_rows[0]["title"]

    # 이력 한 항목. 확정 방향에는 반려 쪽 값이 **없으므로 키 자체가 없다**(모르는 값을 흔한 값으로
    # 떨어뜨리는 폴백을 두지 않는다 — CLAUDE.md §6-4 2).
    history = _history(served)
    assert len(history) == 1, history
    entry = history[0]
    assert entry["previous_decision"] == "confirmed"
    assert entry["previous_reviewed_by"] == user_ids["cm"]
    assert entry["cancelled_by"] == user_ids["cm"] and entry["cancel_note"] == note and entry["cancelled_at"]
    assert "previous_rejected_at" not in entry and "previous_rejection_note" not in entry


# ═══════════════════════════════════════════════════════════════════════════
# V2 — 반려 → 취소 (값 축이 **안** 움직이는 방향)
# ═══════════════════════════════════════════════════════════════════════════
def test_v2_cancelling_a_rejection_clears_the_rejection_marks_and_reopens_the_queue(
        client, auth, cancel_project, user_ids):
    """반려 취소는 `drawing_approval`·`score` 를 움직이지 않는다(실측 0.5→0.5, 0.625→0.625) — 그래서
    값으로 단언하지 않는다. 갈리는 것은 `blockers[]` 와 `evidence.note`, 그리고 매핑의 반려 표시다.

    §6-2 물음: 반려 표시 4키를 안 지우는 구현은 readiness 네 칸이 **완전히 같아** 값·blocker 로는
    구별되지 않는다(ADR 0013 §Context 3 표 3행 vs 4행). 그래서 그 네 키의 **부재**를 직접 단언한다 —
    남으면 한 카드가 "검토 대기" 배지와 옛 반려자·반려 사유를 함께 낸다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REJECT)
    review = _reviews(client, auth, pid, A_REJECT)
    assert [r["status"] for r in review] == ["open"], review
    reject_note = "다른 공종 문서로 확인됨 — 이 Activity 와 무관"
    rr = client.post(f"/api/review-requests/{review[0]['review_request_id']}/resolve", headers=auth("cm"),
                     json={"decision": "rejected", "note": reject_note})
    assert rr.status_code == 200, rr.text

    rejected = _mapping(client, auth, pid, doc_id, A_REJECT)
    assert rejected["evidence"]["extra"]["mapping_review_decision"] == "rejected"
    rejected_at = rejected["evidence"]["extra"]["rejected_at"]
    before = _readiness(client, auth, pid, A_REJECT)
    # 반려 상태의 관측값 — `drawing_approval` blocker 는 있지만 kind 가 없다(`document_mapping_pending`
    # 이 아니다). 취소 뒤 이 칸이 갈린다.
    assert _drawing_blockers(before) == [(None, "drawing approval unknown")]
    assert "drawing_approval: resources.drawing_approved absent" in before["evidence"]["note"]

    note = "잘못 반려했다 — 다시 검토한다"
    r = _cancel(client, auth, pid, A_REJECT, doc_id, note=note)
    assert r.status_code == 200, r.text

    served = _mapping(client, auth, pid, doc_id, A_REJECT)
    assert served["needs_review"] is True and served["reviewed_by"] is None
    assert _row_fields(pid, A_REJECT, doc_id) == (True, None)
    extra = served["evidence"]["extra"]
    for key in REJECTION_MARKER_KEYS:
        assert key not in extra, (key, extra)
    # 취소 뒤 그 매핑은 반려로도 확정으로도 읽히지 않는다 — 화면 판정(`mappingReviewState`)이 보는 값.
    assert doc_id not in _confirmed_doc_ids(pid, A_REJECT)

    after = _readiness(client, auth, pid, A_REJECT)
    assert _drawing_blockers(after) == [("document_mapping_pending",
                                         "문서 매핑 1건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음")]
    assert "approved=0/0; pending_mappings=1" in after["evidence"]["note"]

    open_rows = _open_reviews(client, auth, pid, A_REJECT)
    closed_rows = _closed_reviews(client, auth, pid, A_REJECT)
    assert len(open_rows) == 1, open_rows
    assert [c["status"] for c in closed_rows] == ["rejected"], closed_rows
    assert closed_rows[0]["resolved_by"] == user_ids["cm"]
    assert reject_note in (closed_rows[0]["resolution_note"] or "")
    assert open_rows[0]["conflicting_sources"]["cancelled_review_request_id"] == closed_rows[0]["review_request_id"]
    # V1 의 짝(§6-4 3 — 부재 단언). 반려를 취소한 자리에서 "확정을"은 참일 수 없다.
    assert "확정을" not in open_rows[0]["title"], open_rows[0]["title"]

    # 지운 반려 표시는 사라지지 않고 이력으로 옮겨진다(규칙 3) — 반려 방향에서만 있는 두 값이 실린다.
    history = _history(served)
    assert len(history) == 1, history
    entry = history[0]
    assert entry["previous_decision"] == "rejected"
    assert entry["previous_reviewed_by"] == user_ids["cm"]
    assert entry["previous_rejected_at"] == rejected_at
    assert entry["previous_rejection_note"] == reject_note
    assert entry["cancel_note"] == note


def test_confirming_after_cancelling_a_rejection_works(client, auth, cancel_project, user_ids):
    """반려 취소 뒤에는 확정이 **가능해야 한다** — 그것이 `document_mapping_already_rejected`(409)의 뜻이
    "영원히 불가"에서 **"먼저 취소하라"** 로 좁아졌다는 말의 관측 가능한 얼굴이다(ADR 0013 규칙 8).

    방어를 넣고 기능을 죽이는 것도 이 저장소가 반복한 실패라 대조군을 둔다: 취소가 반려 표시 4키를
    지우지 못하면 `_reject_confirm_of_rejected_mapping` 이 여기서 409 를 내고, 화면 문구("반려를 먼저
    취소해 … 확정하세요")가 그 순간 거짓이 된다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REJECT)      # 앞 테스트가 반려 → 취소해 둔 쌍
    assert _mapping(client, auth, pid, doc_id, A_REJECT)["needs_review"] is True

    _confirm(client, auth, pid, A_REJECT, doc_id, "취소 뒤 재확정")
    served = _mapping(client, auth, pid, doc_id, A_REJECT)
    assert served["needs_review"] is False and served["reviewed_by"] == user_ids["cm"]
    # 확정은 취소 이력을 지우지 않는다(감사 보존) — 확정 경로가 evidence 를 통째로 갈아치우면 죽는다.
    assert [h["previous_decision"] for h in _history(served)] == ["rejected"]
    assert _confirmed_doc_ids(pid, A_REJECT) == [doc_id]
    assert _readiness(client, auth, pid, A_REJECT)["components"]["drawing_approval"] == 1.0

    # 그리고 그 확정은 취소가 연 요청을 닫는다 — 큐에 열린 채로 남지 않는다.
    assert _open_reviews(client, auth, pid, A_REJECT) == []
    # (목록 순서는 계약이 아니므로 정렬해 비교한다.) 옛 반려 행은 그대로 남고 취소가 연 요청만 닫힌다.
    assert sorted(c["status"] for c in _closed_reviews(client, auth, pid, A_REJECT)) == ["approved", "rejected"]


# ═══════════════════════════════════════════════════════════════════════════
# V5 — 사유 요건
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("note", [None, "", BLANK], ids=["missing", "empty", "blank"])
def test_v5_cancelling_without_a_reason_is_refused_and_changes_nothing(client, auth, cancel_project,
                                                                      user_ids, note):
    """사유가 없으면 409 `cancel_reason_required` 이고 **아무것도 바뀌지 않는다**.

    §6-2 물음: 부분 적용 후 예외를 던지는 구현은 상태코드만 보는 단언을 통과한다 — 그래서 매핑 행·
    요청 상태·이력을 전후로 비교한다. `code` 를 보는 이유는 전용 핸들러가 이 불변식의 일부이기
    때문이다(예외가 `Exception` 직속이라 핸들러가 없으면 500 + `code` 없음).
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REASON)
    if _mapping(client, auth, pid, doc_id, A_REASON)["reviewed_by"] is None:
        _confirm(client, auth, pid, A_REASON, doc_id, "확정")   # 첫 파라미터 칸에서만 실제로 확정한다
    before_mapping = _mapping(client, auth, pid, doc_id, A_REASON)
    before_rows = [(x["review_request_id"], x["status"], x["resolved_by"]) for x in _reviews(client, auth, pid, A_REASON)]

    r = _cancel(client, auth, pid, A_REASON, doc_id, note=note)
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["code"] == "cancel_reason_required", body
    # 부가 필드를 싣지 않는다(ADR 0013 규칙 6 부칙). 어느 쌍인지는 `detail` 문장에 있다 — 그것이
    # 부가 필드를 싣지 않아도 되는 근거이므로 함께 단언한다.
    assert set(body) == {"detail", "code"}, body
    assert A_REASON in body["detail"] and doc_id in body["detail"]

    after_mapping = _mapping(client, auth, pid, doc_id, A_REASON)
    assert after_mapping["reviewed_by"] == before_mapping["reviewed_by"] == user_ids["cm"]
    assert after_mapping["needs_review"] is False
    assert _history(after_mapping) == _history(before_mapping)
    assert [(x["review_request_id"], x["status"], x["resolved_by"])
            for x in _reviews(client, auth, pid, A_REASON)] == before_rows


# ═══════════════════════════════════════════════════════════════════════════
# V9 — 취소는 무제한이고, 반복은 조용하지 않다
# ═══════════════════════════════════════════════════════════════════════════
def test_v9_cancelling_twice_appends_to_the_history_and_keeps_both_closed_rows(client, auth, cancel_project,
                                                                              user_ids):
    """확정 → 취소 → 확정 → 취소. 둘째 취소도 200 이고 이력이 **2** 이며 닫힌 요청 행 둘이 각자 그
    시점의 status·처리자를 유지한다.

    §6-2 물음: 1회 제한 구현은 둘째 취소에서 409 로 죽고, 이력을 **덮어쓰는** 구현은 길이 1 에서 죽는다.
    길이만 보면 덮어쓰기 구현이 "마지막 것 하나"로 통과할 수 있으므로 두 항목의 `cancel_note` 를 각각
    확인한다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REASON)
    assert _mapping(client, auth, pid, doc_id, A_REASON)["reviewed_by"] == user_ids["cm"]   # V5 가 확정해 뒀다

    first_closed = _closed_reviews(client, auth, pid, A_REASON)
    assert len(first_closed) == 1, first_closed          # V5 의 확정이 닫은 행
    first_cancelled_id = first_closed[0]["review_request_id"]

    first = _cancel(client, auth, pid, A_REASON, doc_id, note="첫째 취소")
    assert first.status_code == 200, first.text
    assert len(_history(_mapping(client, auth, pid, doc_id, A_REASON))) == 1

    # 첫째 취소가 연 행. **재확정이 닫을 행이 바로 이것**이므로 둘째 취소는 이 id 를 실어야 한다 —
    # 앞에서 붙잡아 두고 뒤에서 비교한다(비교 대상을 사후에 고르면 어느 행이든 맞는다).
    reopened = _open_reviews(client, auth, pid, A_REASON)
    assert len(reopened) == 1, reopened
    reconfirmed_review_id = reopened[0]["review_request_id"]
    assert reconfirmed_review_id != first_cancelled_id

    _confirm(client, auth, pid, A_REASON, doc_id, "재확정")
    second = _cancel(client, auth, pid, A_REASON, doc_id, note="둘째 취소")
    assert second.status_code == 200, second.text

    mapping = _mapping(client, auth, pid, doc_id, A_REASON)
    assert mapping["needs_review"] is True and mapping["reviewed_by"] is None
    history = _history(mapping)
    assert [h["cancel_note"] for h in history] == ["첫째 취소", "둘째 취소"], history
    assert [h["previous_decision"] for h in history] == ["confirmed", "confirmed"]

    open_rows = _open_reviews(client, auth, pid, A_REASON)
    closed_rows = _closed_reviews(client, auth, pid, A_REASON)
    assert len(open_rows) == 1, open_rows           # 열린 것은 언제나 하나뿐이다
    assert len(closed_rows) == 2, closed_rows       # 취소마다 닫힌 행이 하나씩 쌓인다(ADR 0013 §Deferred 1)
    assert {c["status"] for c in closed_rows} == {"approved"}
    assert all(c["resolved_by"] == user_ids["cm"] and c["resolution_note"] for c in closed_rows)

    # 둘째 취소가 가리키는 것은 **직전 확정을 닫은 행**이다(ADR 0013 규칙 2 — "지금 취소하는 결정을
    # 기록한 행"). 닫힌 행이 둘 이상 쌓인 뒤에야 이 칸이 갈린다: 하나뿐일 때는 어느 것을 골라도 같은
    # id 라 결함 있는 구현과 옳은 구현이 구별되지 않는다(CLAUDE.md §6-2 1).
    assert open_rows[0]["conflicting_sources"]["cancelled_review_request_id"] == reconfirmed_review_id


# ═══════════════════════════════════════════════════════════════════════════
# V7 — 취소할 결정이 없다 / 검사 순서
# ═══════════════════════════════════════════════════════════════════════════
def test_v7_cancelling_a_pending_mapping_is_refused_and_the_order_of_checks_is_a_contract(
        client, auth, cancel_project):
    """검토 대기 매핑에 취소를 걸면 409 `mapping_decision_not_cancellable`(무동작 200 이 아니다).

    **두 요건을 동시에 어긴 요청(결정도 없고 사유도 없음)도 같은 code 다** — 검사 순서가 계약이기
    때문이다(ADR 0013 규칙 6). 순서를 맞바꾼 구현은 여기서 `cancel_reason_required` 를 내고,
    그러면 취소할 결정이 없는 CM 이 **적을 수 없는 사유**를 적게 된다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_PENDING)
    before = _mapping(client, auth, pid, doc_id, A_PENDING)
    assert before["needs_review"] is True and before["reviewed_by"] is None
    before_rows = [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_PENDING)]

    for note in ("사유는 적었다", None, BLANK):
        r = _cancel(client, auth, pid, A_PENDING, doc_id, note=note)
        assert r.status_code == 409, (note, r.text)
        body = r.json()
        assert body["code"] == "mapping_decision_not_cancellable", (note, body)
        assert set(body) == {"detail", "code"}, body
        assert A_PENDING in body["detail"] and doc_id in body["detail"]

    after = _mapping(client, auth, pid, doc_id, A_PENDING)
    assert after["needs_review"] is True and after["reviewed_by"] is None
    assert CANCELLED_REVIEWS_KEY not in after["evidence"]["extra"]
    assert [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_PENDING)] == before_rows


# ═══════════════════════════════════════════════════════════════════════════
# V6 — 인가 · 대상 부재
# ═══════════════════════════════════════════════════════════════════════════
def test_v6_only_cm_can_cancel_and_the_target_must_exist(client, auth, cancel_project, user_ids):
    """취소는 그 프로젝트의 `cm` 만(ADR 0013 불변식 5 = 확정 라우트와 같은 한 줄). 부작용 0.

    인가가 **행 조회보다 먼저**인 것도 계약이다 — 뒤에 두면 비멤버에게 매핑의 존재 여부를 흘린다.
    그래서 멤버가 아닌 계정에는 **존재하는 쌍**으로도 403 이 나가야 한다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_CONFIRM)
    # 이 시점 A100 은 취소된(=검토 대기) 상태다. 인가가 먼저 걸리므로 409 가 아니라 403 이어야 한다 —
    # 그 사실이 "인가가 앞이다"를 관측 가능하게 만든다.
    before_rows = [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_CONFIRM)]
    for role in ("contractor", "client", "admin"):
        r = _cancel(client, auth, pid, A_CONFIRM, doc_id, role=role, note="권한 없는 취소 시도")
        assert r.status_code == 403, (role, r.text)
        assert r.json()["code"] == "forbidden_role", (role, r.json())
    assert [(x["review_request_id"], x["status"]) for x in _reviews(client, auth, pid, A_CONFIRM)] == before_rows
    assert _row_fields(pid, A_CONFIRM, doc_id) == (True, None)

    # 없는 쌍: cm 이어도 404. `not_found` 기본값이 아니라 원인별 code 여야 한다.
    r = _cancel(client, auth, pid, A_CONFIRM, "doc-does-not-exist", note="사유")
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "document_mapping_target_not_found", r.json()
    r = _cancel(client, auth, pid, "A999", doc_id, note="사유")
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "document_mapping_target_not_found", r.json()


# ═══════════════════════════════════════════════════════════════════════════
# V8 — 재계산·재업로드가 취소를 되돌리지 않고, 요청을 중복으로 만들지도 않는다
# ═══════════════════════════════════════════════════════════════════════════
def test_v8_recompute_and_register_reupload_neither_revive_the_decision_nor_duplicate_the_request(
        client, auth, cancel_project, user_ids):
    """취소된 쌍 위에서 재계산(수동 호출)과 대장 재업로드를 각각 태운다.

    단언 셋: ① 매핑은 미확정 그대로다(재계산이 확정·반려를 되살리지 않는다) ② 그 쌍의 열린 요청은
    **1건 그대로**(중복 생성 없음 — `open_document_mapping_review` 가 막는다) ③ 취소가 남긴 감사,
    즉 닫힌 요청 행들의 `status`·`resolved_by`·`resolution_note` 가 그대로다.

    **관측하고 단언하지 않는 것(정직하게 적는다).** 재계산은 미확정 매핑의 `evidence` 를 새 후보로
    덮어쓰므로 `extra.cancelled_mapping_reviews` **이력이 사라진다**(실측: 재계산 직후 길이 1 → 0).
    ADR 0013 규칙 3 은 그 이력을 append-only 로 설계했는데 재계산이 그것을 지운다 — 그래도 "결정에
    이유가 남는다"는 축은 유지되지만, **이력의 수명은 그 쌍이 후보로 다시 산출되는 다음 재계산까지**다.
    이 파일은 그 현재 동작을 계약으로 고정하지 않는다(어느 방향이 옳은지는 이 사이클이 정하지 않았다) —
    없어진다는 사실만 보고한다.

    **감사가 남는 자리를 초판은 "닫힌 요청 행"이라고 적었는데 그것은 거짓이다**(ADR 0013 **개정 1**,
    계획 0006 §후속 5). 그 문장은 이 배역(`A100` — 닫힌 행이 있다)에서만 참이고 일반 명제로는 성립하지
    않는다: 재확인이 열린 확정을 취소하는 경로에는 닫힌 행이 **하나도 없다**
    (`test_cancelling_while_a_reopened_request_is_already_open_...` 가 그 경로를 태우고
    `cancelled_review_request_id is None` 을 단언한다). 정본은 ① `expert_review_logs` 행과 ② 취소가
    열거나 갱신한 요청 행의 `conflicting_sources` 이고, 매핑 행의 이력은 그 둘의 **사본**이다.
    ①을 붙드는 것은 `test_cancelling_leaves_a_durable_expert_review_log_row_...` 다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_CONFIRM)
    before_open = _open_reviews(client, auth, pid, A_CONFIRM)
    before_closed = [(c["review_request_id"], c["status"], c["resolved_by"], c["resolution_note"])
                     for c in _closed_reviews(client, auth, pid, A_CONFIRM)]
    assert len(before_open) == 1 and before_closed

    r = client.post(f"/api/projects/{pid}/documents/mappings", headers=auth("cm"))
    assert r.status_code == 200, r.text
    up, job = upload(client, auth("cm"), pid, FIXTURES / "document_register.xlsx")
    assert up["kind"] == "xlsx" and job["status"] == "done", job

    assert _row_fields(pid, A_CONFIRM, doc_id) == (True, None)
    served = _mapping(client, auth, pid, doc_id, A_CONFIRM)
    assert served["needs_review"] is True and served["reviewed_by"] is None
    assert doc_id not in _confirmed_doc_ids(pid, A_CONFIRM)

    after_open = _open_reviews(client, auth, pid, A_CONFIRM)
    assert [x["review_request_id"] for x in after_open] == [x["review_request_id"] for x in before_open]
    assert [(c["review_request_id"], c["status"], c["resolved_by"], c["resolution_note"])
            for c in _closed_reviews(client, auth, pid, A_CONFIRM)] == before_closed

    # 옛 조건이 잡던 것(ADR 0007 §4-2 규칙 6 ⑥ — 재계산은 사람의 판단을 뒤집지 않는다)은 **반려된 채
    # 남아 있는 쌍이 없어** 이 프로젝트에서는 여기서 재확인할 수 없다. 그 회귀는 test_15 가 계속 잡는다.
    # 여기서 확인하는 것은 그 규칙의 취소 쪽 절반이다: 취소된 쌍도 재계산이 확정으로 되돌리지 않는다.


# ═══════════════════════════════════════════════════════════════════════════
# 중복 방지 — 재확인 요청이 이미 열린 확정을 취소하면 그 행을 재사용한다
# ═══════════════════════════════════════════════════════════════════════════
def test_cancelling_while_a_reopened_request_is_already_open_does_not_create_a_second_request(
        client, auth, cancel_project, user_ids, tmp_path: Path):
    """확정된 매핑은 Activity 가 바뀌면 재확인 요청이 **다시 열린다**(ADR 0007 §4-2 규칙 6 ⑤ —
    `_reopen_reviews_for_invalidated_confirmations`). 그 상태에서 확정을 취소하면 같은 쌍에 열린 요청이
    둘이 되면 안 된다 — CM 이 하나를 닫아도 큐에 남는다.

    §6-2 물음: 무조건 새 행을 만드는 구현은 열린 요청 2건이 되어 죽는다. 그리고 이 경로에는 **닫힌 요청
    행이 없으므로**(재오픈이 그 행을 다시 열었다) `cancelled_review_request_id` 가 `None` 이어야 한다 —
    아무 id 나 지어내는 폴백을 두면 죽는다(CLAUDE.md §6-4 2: 모르는 값은 모른다고 적는다).
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_REOPENED)
    _confirm(client, auth, pid, A_REOPENED, doc_id, "확정")
    assert [r["status"] for r in _reviews(client, auth, pid, A_REOPENED)] == ["approved"]

    original = (FIXTURES / "schedule.csv").read_text(encoding="utf-8")
    lines = []
    for line in original.splitlines():
        if line.startswith(f"{A_REOPENED},"):
            cols = line.split(",")
            cols[1] = "완전히 다른 작업 내용 — 재확인 유도"   # 유사도가 임계값 아래로 떨어질 만큼 무관하게
            line = ",".join(cols)
        lines.append(line)
    modified = tmp_path / "schedule.csv"      # 같은 stem 이어야 같은 schedule_id 로 교체된다
    modified.write_text("\n".join(lines) + "\n", encoding="utf-8")
    up, job = upload(client, auth("contractor"), pid, modified)
    assert up["kind"] == "csv" and job["status"] == "done", job

    reopened = _reviews(client, auth, pid, A_REOPENED)
    assert [r["status"] for r in reopened] == ["open"], reopened   # 재확인 요청이 다시 열렸다
    reopened_id = reopened[0]["review_request_id"]
    assert _mapping(client, auth, pid, doc_id, A_REOPENED)["needs_review"] is False   # 매핑은 확정 그대로

    r = _cancel(client, auth, pid, A_REOPENED, doc_id, note="재확인 중 확정을 취소한다")
    assert r.status_code == 200, r.text

    rows = _reviews(client, auth, pid, A_REOPENED)
    assert len(rows) == 1, rows                                  # 새 행을 만들지 않고 그 행을 쓴다
    assert rows[0]["review_request_id"] == reopened_id and rows[0]["status"] == "open"
    sources = rows[0]["conflicting_sources"]
    assert sources["cancel_note"] == "재확인 중 확정을 취소한다"
    assert sources["cancelled_review_request_id"] is None          # 닫힌 결정이 없다 — 지어내지 않는다
    assert _row_fields(pid, A_REOPENED, doc_id) == (True, None)


# ═══════════════════════════════════════════════════════════════════════════
# 계획 0006 §후속 5 — 취소의 **내구 감사**: `expert_review_logs` 행
# ═══════════════════════════════════════════════════════════════════════════
def test_cancelling_leaves_a_durable_expert_review_log_row_that_survives_recompute(
        client, auth, cancel_project, user_ids):
    """취소는 `expert_review_logs` 에 행을 남기고, 그 행은 매핑 행의 이력보다 오래 산다.

    ADR 0013 **개정 1** 이 감사의 정본을 다시 지목했다: 취소 한 건의 내구 기록은 ① 이 로그 행과
    ② 취소가 열거나 갱신한 요청 행의 `conflicting_sources` 이고, 매핑 행의
    `extra.cancelled_mapping_reviews` 는 그 **사본**이다(수명은 그 쌍이 후보로 다시 산출되는 다음
    재계산까지). 그런데 ①을 **아무 테스트도 붙들지 않았다** — 실측(계획 0006 §M-3):
    `usecases.py::cancel_document_mapping_review` 의 `record_expert_review(...)` 세 줄을 지워도
    `.venv/bin/pytest -q` 가 **803 passed**(그 값을 잰 것은 이 테스트가 들어온 `716d67d` **직전** 트리다
    — 오늘의 기준선이 아니다), `grep -rn "activity_document_mapping" tests/` 히트 **0**.
    이 테스트가 그 자리다.

    **넷을 함께 단언한다**(CLAUDE.md §6-2 4 — 하나만 보면 통과하는 결함 코드가 각각 있다):

    | 단언 | 하나만 보면 통과하는 구현 |
    |---|---|
    | 행이 **생긴다**(`entity_type`·`entity_id`·`reviewer`) | 로그를 아예 안 남기는 구현만 잡는다 |
    | 그 행의 `proposal` 이 취소가 **지운 반려 표시**를 담는다 | 취소 **뒤** 상태만 싣는 구현(`proposal`=`final`)이 통과한다 — 그러면 "매핑 행 이력이 사라져도 감사는 남는다"의 근거가 사라진다 |
    | **재계산 뒤에도 그 행이 그대로** | 감사를 매핑 행에만 두는 구현이 통과한다(그 이력은 재계산이 지운다) |
    | 반복 취소가 행을 **append** 한다 | 같은 행을 덮어쓰는 구현이 통과한다 — 규칙 7("무제한")의 관측 가능성이 사라진다 |

    **음성 대조군(이 단언이 취소 축만 잡는가).** 확정도 **같은** `entity_type`·`entity_id` 로 한 행을
    남긴다(`_confirm_document_mapping_row`). 그래서 행을 그냥 세면 확정 축이 죽어도 이 테스트가
    죽는다 — "취소가 감사를 남긴다"를 잡는 것이 아니게 된다. `final` 의 `cancelled_review_opened` 로
    취소 행만 고른다(`_cancel_logs`).

    그 대조군을 **실행으로 태웠다**(적어 두는 것은 커버리지가 아니다 — CLAUDE.md §6-1):
    `_confirm_document_mapping_row` 의 `record_expert_review(...)` 를 지우고 `.venv/bin/pytest -q` →
    **하나도 죽지 않는다**. 세 트리에서 같은 값이다 — `716d67d` 직전 **804 passed**, 계획 0008 §2-a 가
    `136e66f` 에서 **805 passed**, 이 사이클(기준선 807)에서 **807 passed**. 즉 이 단언들은 취소 축만
    잡는다(계획 0008 §과제 1 이 더한 정렬 회귀 둘도 이 축을 넓히지 않는다). 같은 실측이
    확정 축의 로그도 무보호임을 말하는데, 이 파일은 그 축을 고정하지 않는다 — §후속 5 가 넘긴 것은
    취소의 감사이고, 축을 넓히면 "취소만" 잡는 것이 아니게 된다.

    **관측하고 단언하지 않는 것.** 재계산 뒤 사라지는 사본의 정체는 `extra.cancelled_mapping_reviews`
    키 자신이다(실측: 재계산 직후 그 키가 **키째** 없다 — ADR 0013 개정 1 `[P1-*]`). 그 수명을 계약으로
    고정할지는 이 사이클이 정하지 않았으므로(V8 과 같은 판단) 키를 직접 단언하지 않고, **재계산이 그
    매핑 행을 실제로 덮었다**는 것만 `evidence` 전체의 변화로 확인한다 — 이 확인이 없으면 "재계산 뒤에도
    그대로"가 재계산이 그 행을 건드리지 않은 덕분일 수 있다(무동작 단언).
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_AUDIT)
    assert _cancel_logs(A_AUDIT, doc_id) == []          # 이 쌍에는 아직 취소가 없다

    # ── 반려한다: 취소가 지울 표시를 만든다(확정 방향이 아니라 반려 방향을 쓰는 이유는 `proposal` 이
    #    "지워진 것"을 담는지가 이 테스트의 둘째 단언이기 때문이다).
    review = _reviews(client, auth, pid, A_AUDIT)
    assert [r["status"] for r in review] == ["open"], review
    reject_note = "이 문서는 이 작업과 무관하다"
    rr = client.post(f"/api/review-requests/{review[0]['review_request_id']}/resolve", headers=auth("cm"),
                     json={"decision": "rejected", "note": reject_note})
    assert rr.status_code == 200, rr.text
    assert _mapping(client, auth, pid, doc_id, A_AUDIT)["evidence"]["extra"]["mapping_review_decision"] == "rejected"

    # ── 취소한다.
    first_note = "반려가 오조작이었다 — 되돌린다"
    r = _cancel(client, auth, pid, A_AUDIT, doc_id, note=first_note)
    assert r.status_code == 200, r.text
    opened = _open_reviews(client, auth, pid, A_AUDIT)
    assert len(opened) == 1, opened

    # ① 행이 생긴다.
    logs = _cancel_logs(A_AUDIT, doc_id)
    assert len(logs) == 1, logs
    first = logs[0]
    assert first.entity_type == "activity_document_mapping"
    assert first.reviewer == user_ids["cm"]
    assert first.final[CANCEL_LOG_KEY] == opened[0]["review_request_id"]

    # ② 그 행의 `proposal` 은 취소 **직전**의 매핑이다 — 취소가 매핑 행에서 지운 반려 표시 넷이 여기
    #    그대로 있다. 같은 시점 매핑 행에 그 넷이 **없다**는 것과 함께 단언한다(§6-2 4): 둘 중 하나만
    #    보면 "지우지 않는 구현"과 "감사를 남기지 않는 구현"이 각각 살아남는다.
    proposal_extra = first.proposal["evidence"]["extra"]
    for key in REJECTION_MARKER_KEYS:
        assert key in proposal_extra, (key, proposal_extra)
    assert proposal_extra["rejected_by"] == user_ids["cm"]
    assert proposal_extra["rejection_note"] == reject_note
    assert first.proposal["reviewed_by"] == user_ids["cm"]
    served_extra = _mapping(client, auth, pid, doc_id, A_AUDIT)["evidence"]["extra"]
    for key in REJECTION_MARKER_KEYS:
        assert key not in served_extra, (key, served_extra)

    # ③ 재계산 뒤에도 그대로. 먼저 재계산이 이 매핑 행을 실제로 덮었는지 확인한다(무동작 단언 방지).
    before_evidence = _mapping(client, auth, pid, doc_id, A_AUDIT)["evidence"]
    rc = client.post(f"/api/projects/{pid}/documents/mappings", headers=auth("cm"))
    assert rc.status_code == 200, rc.text
    after_evidence = _mapping(client, auth, pid, doc_id, A_AUDIT)["evidence"]
    assert after_evidence != before_evidence, after_evidence
    assert _cancel_logs(A_AUDIT, doc_id) == [first]

    # ④ 반복 취소는 행을 append 한다(덮어쓰지 않는다). 첫 행의 `proposal` 이 그대로인 것까지 본다 —
    #    길이만 보면 "덮어쓰고 하나 더 만드는" 구현이 통과한다.
    _confirm(client, auth, pid, A_AUDIT, doc_id, "재확정")
    second_note = "둘째 취소"
    r2 = _cancel(client, auth, pid, A_AUDIT, doc_id, note=second_note)
    assert r2.status_code == 200, r2.text

    logs2 = _cancel_logs(A_AUDIT, doc_id)
    assert len(logs2) == 2, logs2
    assert logs2[0] == first
    assert logs2[1].log_id != first.log_id
    assert logs2[1].entity_type == "activity_document_mapping" and logs2[1].reviewer == user_ids["cm"]
    assert [x.final["evidence"]["note"] for x in logs2] == [first_note, second_note]
    assert [x.proposal["reviewed_by"] for x in logs2] == [user_ids["cm"], user_ids["cm"]]


# ═══════════════════════════════════════════════════════════════════════════
# 계획 0008 §과제 1(S2) — 취소가 지목하는 결정은 **`created_at` 이 가장 늦은 닫힌 행**이고
# DB 스캔 순서로 고른 행이 아니다. 새 요청을 여는 갈래(열린 행 0)만 `closed[-1]` 을 읽는다.
# 이 배역은 프로젝트를 재계산하지 않으므로 재업로드 시나리오(아래)보다 앞에 둔다(파일 머리 규칙).
# ═══════════════════════════════════════════════════════════════════════════
def test_cancel_names_the_decision_by_created_at_even_when_the_db_scan_order_is_reversed(
        client, auth, cancel_project, user_ids):
    """확정1 → 취소1 → 확정2 로 **닫힌 행 둘 · 열린 행 0** 을 만든 뒤 두 행의 **스캔 순서를
    `created_at` 역순으로 어긋나게** 하고 취소2 를 친다. 실린 `cancelled_review_request_id` 는
    **확정2 의 행**이어야 한다.

    §6-2 물음 — **결함 있는 코드가 이 기대값을 그대로 만족하는가.** 어긋나게 하지 않으면 **그렇다**:
    SQLite 의 스캔 순서가 곧 삽입 순서이고 삽입 순서가 곧 `created_at` 순서라
    `services/progress/persistence.py::document_mapping_reviews` 의 `sorted(...)` 를 지우고
    `return rows` 로 바꿔도 같은 값이 나온다. 그것이 계획 0008 이전의 상태였다 —
    그 변이에 **기준선이 그대로**(`136e66f` 실측 805 passed, 계획 0007 §후속 9).

    | | 정렬 있음 | `return rows`(변이) |
    |---|---|---|
    | **어긋나게 하지 않음** | 확정2 의 행(옳다) | 확정2 의 행(옳다) ← 두 구현이 구별되지 않는다 = 장식 |
    | **어긋나게 함**(이 테스트) | 확정2 의 행(옳다) | **확정1 의 행(틀렸다)** ← 갈린다 |

    **틀린 값이 무엇인가가 이 테스트의 무게다.** 확정1 의 행은 **취소1 이 이미 되돌린 결정**의 행이다.
    CM 은 "확정2 를 취소했다"는 화면에서 확정1 의 요청 id 를 받는다 — 이름("어느 결정을 취소한
    것인가", ADR 0013 규칙 2)과 값이 다르므로 `None`("모른다")보다 나쁘다(CLAUDE.md §6-4 2). 갱신
    갈래에서 정확히 같은 결함을 계획 0006 §후속 7 이 닫았고(아래 테스트), 새 요청 갈래에는 그 정렬
    하나만 서 있었다.

    **어긋나게 하는 축은 `created_at` 값이 아니다**(계획 0008 §1-b-1). 값을 고쳐
    (`확정1.created_at = 확정2.created_at + 10분`) 만들면 **옳은 구현이 확정1 의 행을 지목**하게 되어,
    아래 형제 테스트가 "내면 안 된다"고 붙들어 둔 값을 이 파일이 계약으로 고정한다. 그렇다고 축이
    **힙 배치**인 것도 아니다(ADR 0015 §2-1) — 만드는 것은 두 행의 **상대 순서**뿐이고,
    `_make_scan_order_disagree_with_created_at` 의 docstring 이 그 방법과 그 방법의 한계를 적는다.

    **어긋났다는 것을 이 테스트가 스스로 단언한다**(§1-b-3): 재배치 뒤 스캔이 `[확정2, 확정1]` 이고,
    두 스캔의 `(status, resolved_by, created_at)` 집합이 **같다**. 어긋나지 않으면(FSM 이 앞 페이지를
    주면 · 플래너·인덱스·DB 가 바뀌면) 위 표의 왼쪽 열로 떨어져 두 구현이 다시 구별되지 않는데, 그때
    이 테스트는 조용히 장식이 되는 대신 **그 자리에서 죽고**(ADR 0015 §2-2) 실패 메시지가 `ctid` 와
    `autovacuum_count` 를 실어 다음 사람이 **재현 없이** 귀속하게 한다(§2-4).
    *재배치 **전** 순서는 단언하지 않는다* — 그것은 SQLite 사실이고 PostgreSQL 축에서는 갱신이 튜플을
    옮겨 그 전에 이미 뒤집혀 있을 수 있다(아래 주석의 10회 실측).

    **셋을 함께 단언한다**(§6-2 4): ⓐ 실린 id 가 확정2 의 행이다 ⓑ 확정1 의 행이 **아니다**
    ⓒ 취소2 가 **새 요청을 열었다**(= 갱신 갈래가 아니라 `closed[-1]` 을 읽는 갈래로 들었다).
    ⓒ 가 없으면 이 배역이 갱신 갈래로 새어도 초록이다 — 그 갈래는 `closed[-1]` 을 아예 읽지 않아
    (`document_mapper.py` 의 `if open_review is None:` / `else: cancelled_review_id = None`) 정렬 유무로
    값이 갈리지 않는다. 갈래 자체를 함께 고정해야 ⓐⓑ 가 정렬을 붙드는 단언으로 남는다.
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_PENDING)

    # ── 시작 상태: 이 쌍에는 아직 결정이 없다(V7·V6 은 전부 거절당한 요청이라 아무것도 안 남겼다).
    assert _closed_reviews(client, auth, pid, A_PENDING) == []
    open0 = _open_reviews(client, auth, pid, A_PENDING)
    assert len(open0) == 1, open0
    first_decision_row = open0[0]["review_request_id"]

    # ── 확정1 → 취소1 → 확정2. 닫힌 행 둘, 열린 행 0.
    _confirm(client, auth, pid, A_PENDING, doc_id, "확정1")
    c1 = _cancel(client, auth, pid, A_PENDING, doc_id, note="확정1 을 취소한다")
    assert c1.status_code == 200, c1.text
    opened_by_cancel1 = _open_reviews(client, auth, pid, A_PENDING)
    assert len(opened_by_cancel1) == 1, opened_by_cancel1
    second_decision_row = opened_by_cancel1[0]["review_request_id"]
    assert second_decision_row != first_decision_row
    # 취소1 이 지목한 것은 확정1 의 행이다(닫힌 행이 하나뿐이라 이 칸은 아직 정렬을 구별하지 못한다).
    assert opened_by_cancel1[0]["conflicting_sources"]["cancelled_review_request_id"] == first_decision_row

    _confirm(client, auth, pid, A_PENDING, doc_id, "확정2")
    assert _open_reviews(client, auth, pid, A_PENDING) == []
    closed = _closed_reviews(client, auth, pid, A_PENDING)
    assert {c["review_request_id"] for c in closed} == {first_decision_row, second_decision_row}, closed

    # ── 재배치 전 스캔. **SQLite 에서는** 스캔 순서 = 삽입 순서 = created_at 순서이고, 그것이 "어긋나게
    #    하지 않으면 두 구현이 구별되지 않는다"의 관측값이다(위 표 왼쪽 열). **PostgreSQL 에서는 그
    #    순서가 보장되지 않는다** — 확정·취소가 이 행들을 갱신하고, 갱신이 튜플을 다른 페이지로 옮기면
    #    재배치 전에 이미 뒤집혀 있다. 계획 0009 작업 5 실측(로컬 PostgreSQL 16.13 / **잰 트리는 이
    #    좁힘을 넣기 직전의 작업 트리 = 통합 203건**, `ac9417d` 가 커밋한 205건 트리에 계약 테스트 둘이
    #    들어오기 전이다): `tests/integration` 을 postgres 축으로 **10회 돌려 2회**가
    #    이 테스트에서 죽었고, 출력을 잡아 둔 1회의 실패 지점이 **이 칸**이었다 — `before` 가 이미
    #    `[확정2, 확정1]`). 그래서 이 칸은 **순서가 아니라 집합**만 단언한다 —
    #    이 테스트가 붙드는 것은 재배치 **뒤**의 순서이고 그 단언은 바로 아래에 그대로 있다.
    before = _raw_review_scan(pid, A_PENDING, doc_id)
    assert {x[0] for x in before} == {first_decision_row, second_decision_row}, before

    heap = _make_scan_order_disagree_with_created_at(first_decision_row, second_decision_row)

    after = _raw_review_scan(pid, A_PENDING, doc_id)
    assert [x[0] for x in after] == [second_decision_row, first_decision_row], \
        ("스캔 순서를 어긋나게 하지 못했다 — 순서가 `created_at` 그대로면 이 테스트는 정렬 유무를 "
         f"구별하지 못한다. 힙 진단(ADR 0015 §2-4): {heap}")
    assert sorted(after) == sorted(before), (before, after)   # 값은 하나도 바뀌지 않았다

    # ── 취소2.
    c2 = _cancel(client, auth, pid, A_PENDING, doc_id, note="확정2 를 취소한다")
    assert c2.status_code == 200, c2.text

    open_rows = _open_reviews(client, auth, pid, A_PENDING)
    assert len(open_rows) == 1, open_rows
    third_row = open_rows[0]["review_request_id"]
    # ⓒ 새 요청을 열었다 = `closed[-1]` 을 읽는 갈래로 들었다(갱신 갈래였다면 이 값이 기존 행이다).
    assert third_row not in (first_decision_row, second_decision_row), open_rows
    assert len(_reviews(client, auth, pid, A_PENDING)) == 3

    sources = open_rows[0]["conflicting_sources"]
    assert sources["cancel_note"] == "확정2 를 취소한다"
    # ⓐ 지목한 것은 확정2 를 기록한 행이고 ⓑ 취소1 이 이미 되돌린 확정1 의 행이 아니다.
    assert sources["cancelled_review_request_id"] == second_decision_row, sources
    assert sources["cancelled_review_request_id"] != first_decision_row, sources

    assert _row_fields(pid, A_PENDING, doc_id) == (True, None)


# ═══════════════════════════════════════════════════════════════════════════
# 계획 0006 §후속 7 — 갱신 갈래의 `cancelled_review_request_id`
# (ADR 0013 §Deferred 8 `[P-corner-*]`). 이 파일에서 **유일하게 닫힌 행이 남은 채** 갱신 갈래로 드는
# 배역이라 공정표를 다시 올린다 — 그래서 자리는 맨 뒤다.
# ═══════════════════════════════════════════════════════════════════════════
def test_cancelling_again_while_a_reopened_request_is_open_does_not_name_an_already_cancelled_decision(
        client, auth, cancel_project, user_ids, tmp_path: Path):
    """재확인으로 **다시 열린** 요청이 있는 상태의 취소는, 그 쌍에 닫힌 옛 행이 남아 있어도 그 행을
    "취소한 결정"으로 지목하지 않는다.

    형제 테스트(`test_cancelling_while_a_reopened_request_is_already_open_...`)는 같은 갈래를 **닫힌 행이
    하나도 없는** 배역으로 태운다 — 거기서는 `None` 이 유일한 답이라 "지어내지 않는다"만 붙든다. 이
    배역은 닫힌 행이 **남아 있다**: `test_v1_...` 의 확정1 을 닫은 행이 그대로 있고, 그 결정은 같은
    테스트의 취소가 **이미 되돌렸다**. 그 상태에서 확정2 → 재오픈 → 취소를 하면 `closed[-1]` 구현은
    **확정1 의 행**을 싣는다 — 이름("어느 결정을 취소한 것인가")과 값이 다르므로 `None`("모른다")보다
    나쁘다(CLAUDE.md §6-4 2). 취소2 가 되돌린 것은 확정2 이고, 그 결정을 기록한 행은 **열려 있는 그 행
    자신**이다(재오픈이 그 행의 `resolved_by`·`resolution_note` 를 이미 지웠다).

    §6-2 물음 — **결함 있는 코드가 이 기대값을 그대로 만족하는가.**

    | 단언 | 무엇이 죽는가 / 왜 그 조합이어야 하는가 |
    |---|---|
    | 닫힌 행이 **남아 있고** 그 감사(`resolved_by`·`resolution_note`)가 그대로다 | 이 칸이 없으면 `is None` 이 **닫힌 행이 없어서** 참일 수 있다(형제 테스트와 같은 배역이 되어 코너를 못 잡는다). 그리고 취소가 옛 행을 되열어 쓰는 구현이 여기서 죽는다 |
    | 실린 id 가 그 닫힌 행이 **아니다** | `closed[-1]`(이 사이클 이전 구현)과 `closed[0]` 이 둘 다 죽는다 — 이 배역에서 두 값이 같기 때문에 하나만 골라 비교하면 갈리지 않는다. **특정 id 를 고정하지 않고 "확정1 의 행을 가리키지 않는다"만 붙든다** |
    | 실린 id 가 `None` 이다 | 갱신 갈래의 계약(형제 테스트와 같은 답). *이 단언이 죽는 정당한 개정이 하나 있다* — 열린 그 행 자신의 id 를 싣기로 바꾸는 개정. 그때는 위 두 단언이 그대로 살아 코너를 계속 붙든다 |
    | 새 행을 만들지 않는다(행 2개, 열린 것 하나) | 갱신 갈래를 벗어나는 구현(새 요청을 여는)이 죽는다 — 그 구현에서는 `closed[-1]` 이 옳은 답이 되므로 위 단언들이 의미를 잃는다. 갈래 자체를 함께 고정한다(§6-2 4) |
    """
    pid = cancel_project
    doc_id = _doc_id_for(client, auth, pid, A_CONFIRM)

    # ── 시작 상태(V1 이 남긴 것): 확정1 을 닫은 행 하나 + 그 취소가 연 행 하나.
    closed_before = _closed_reviews(client, auth, pid, A_CONFIRM)
    assert len(closed_before) == 1, closed_before
    first_decision_row = closed_before[0]["review_request_id"]      # V1 의 취소가 **이미 되돌린** 결정의 행
    open_before = _open_reviews(client, auth, pid, A_CONFIRM)
    assert len(open_before) == 1, open_before
    second_decision_row = open_before[0]["review_request_id"]
    assert second_decision_row != first_decision_row

    # ── 확정2: 열려 있던 그 행이 닫히며 **지금 서 있는 결정**을 기록한다.
    _confirm(client, auth, pid, A_CONFIRM, doc_id, "확정2")
    rows = _reviews(client, auth, pid, A_CONFIRM)
    assert {r["review_request_id"]: r["status"] for r in rows} == {
        first_decision_row: "approved", second_decision_row: "approved"}, rows

    # ── Activity 내용을 바꿔 재확인을 유도한다(형제 테스트와 같은 방법). 재오픈은 **가장 최근 행**을
    #    열어야 한다 — 확정2 를 기록한 그 행이다.
    original = (FIXTURES / "schedule.csv").read_text(encoding="utf-8")
    lines = []
    for line in original.splitlines():
        if line.startswith(f"{A_CONFIRM},"):
            cols = line.split(",")
            cols[1] = "완전히 다른 작업 내용 — 재확인 유도"
            line = ",".join(cols)
        lines.append(line)
    modified = tmp_path / "schedule.csv"          # 같은 stem 이어야 같은 schedule_id 로 교체된다
    modified.write_text("\n".join(lines) + "\n", encoding="utf-8")
    up, job = upload(client, auth("contractor"), pid, modified)
    assert up["kind"] == "csv" and job["status"] == "done", job

    reopened = _open_reviews(client, auth, pid, A_CONFIRM)
    assert [r["review_request_id"] for r in reopened] == [second_decision_row], reopened
    assert _mapping(client, auth, pid, doc_id, A_CONFIRM)["needs_review"] is False   # 매핑은 확정 그대로

    # ── 취소2.
    r = _cancel(client, auth, pid, A_CONFIRM, doc_id, note="확정2 를 취소한다")
    assert r.status_code == 200, r.text

    rows = _reviews(client, auth, pid, A_CONFIRM)
    assert len(rows) == 2, rows                                     # 갱신 갈래 — 새 행을 만들지 않는다
    open_rows = _open_reviews(client, auth, pid, A_CONFIRM)
    assert [x["review_request_id"] for x in open_rows] == [second_decision_row], open_rows

    # 확정1 의 행은 **여전히 닫혀 있고 감사가 그대로다** — 그러므로 아래 `is None` 은 "닫힌 행이 없어서"가
    # 아니다(그 배역은 형제 테스트가 이미 태운다).
    still_closed = _closed_reviews(client, auth, pid, A_CONFIRM)
    assert [x["review_request_id"] for x in still_closed] == [first_decision_row], still_closed
    assert still_closed[0]["resolved_by"] == user_ids["cm"] and still_closed[0]["resolution_note"]

    sources = open_rows[0]["conflicting_sources"]
    assert sources["cancel_note"] == "확정2 를 취소한다"
    assert sources["cancelled_review_request_id"] != first_decision_row, sources
    assert sources["cancelled_review_request_id"] is None, sources
    assert _row_fields(pid, A_CONFIRM, doc_id) == (True, None)
