"""ADR 0008 회귀 그물: Activity 키는 `(project_id, activity_id)` 복합 키다.

`activity_id`(`A100`·`1.1.1`)는 우리가 만드는 값이 아니라 **공정표 파일에 적혀 오는 값**이라 서로 다른
현장끼리 겹치는 것이 예외가 아니라 기본값이다. 그런데 그 값이 전역 기본키였다:

    [고치기 전 실측 — ADR 0008 §Context 1]
    p1 에 schedule.csv 업로드 -> GET /projects/p1/activities = 6 건
    p2 에 같은 파일 업로드    -> GET /projects/p1/activities = **0 건**   (p1 의 공정표가 통째로 사라졌다)
                                 activity_object_mappings 27 행이 전부 p2 로 옮겨갔다
    [ADR 0007 §Deferred — 문서 매핑]
    p1 에서 2쌍 확정·1쌍 반려 -> p2 대장 업로드 mapping_count = **3** (6 이어야 한다)

**어떤 API 도 오류를 내지 않았다.** p1 은 그냥 "공정표를 올린 적 없는 프로젝트"처럼 조용히 보였다.
그래서 이 파일은 함수 하나의 반환값이 아니라 **두 프로젝트에 같은 파일을 올리고 양쪽이 끝까지 독립적인지**를
시나리오로 본다(계획 0002 §7 S1~S5). `test_11_project_scoped_objects.py`(ADR 0005, 객체 키)와 같은 자리·같은 결.

시나리오 대응:
- S1 공정표 독립성        `test_s1_*`
- S2 Activity↔객체 매핑    `test_s2_*`
- S3 문서 매핑 독립성      `test_s3_*`   (ADR 0007 §Deferred 해소 증거)
- S4 선행공정 누수         `test_s4_*`   (§1-b `predecessors_of` — **스키마가 잡아주지 않는 유일한 자리**)
- S5 대리키 라우트 인가    `test_s5_*`   (ADR 0006 규칙 2·6, ADR 0008 §5)

S6(화면)은 vitest 담당 — `apps/web/src/api/hooks.test.tsx`.
"""
from __future__ import annotations

import pytest

from packages.core.db import session_scope
from packages.core.models.orm import ActivityDocumentMappingRow, ActivityObjectMappingRow, ActivityRow

from .conftest import FIXTURES, add_member, upload

EXPECTED_ACTIVITIES = {"A100", "A110", "A120", "A200", "A300", "A400"}   # tests/fixtures/schedule.csv
EXPECTED_ACTIVITY_COUNT = 6
EXPECTED_OBJECT_MAPPING_COUNT = 27      # schedule.csv x sample.ifc — ADR 0008 §Context 1 실측치
EXPECTED_DOC_MAPPING_COUNT = 6          # document_register.xlsx(10건) x schedule.csv(6 Activity)
NO_SUCH_ACTIVITY = "A999-DOES-NOT-EXIST"
NO_SUCH_DOC = "doc-does-not-exist"


def _new_project(client, auth, user_ids, name: str) -> str:
    r = client.post("/api/projects", headers=auth("admin"), json={"name": name})
    assert r.status_code == 201, r.text
    project_id = r.json()["project_id"]
    # S1 1단계: contractor/cm/client 를 **양쪽 모두**의 멤버로 넣는다(그래야 한쪽만 보이는 것이
    # 멤버십 때문인지 데이터 때문인지 헷갈리지 않는다).
    for role in ("contractor", "cm", "client"):
        add_member(client, auth("admin"), project_id, user_ids[role], role)
    return project_id


def _activity_ids(client, auth, project_id: str) -> list[str]:
    r = client.get(f"/api/projects/{project_id}/activities", headers=auth("client"))
    assert r.status_code == 200, r.text
    return sorted(a["activity_id"] for a in r.json())


def _readiness(client, auth, project_id: str, activity_id: str, role: str = "cm"):
    return client.get(f"/api/activities/{activity_id}/readiness", headers=auth(role),
                      params={"project_id": project_id})


def _component(client, auth, project_id: str, activity_id: str, name: str) -> float:
    r = _readiness(client, auth, project_id, activity_id)
    assert r.status_code == 200, r.text
    return r.json()["components"][name]


def _blocker(score: dict, component: str) -> dict | None:
    matches = [b for b in score["blockers"] if b["component"] == component]
    assert len(matches) <= 1, matches
    return matches[0] if matches else None


def _confirm_object(client, auth, project_id: str, global_id: str) -> None:
    """PLANNED -> REPORTED -> INSPECTION_REQUESTED (contractor) -> CONFIRMED (cm).

    CONFIRMED 는 `actor == cm` 전이로만 도달한다(CLAUDE.md §3 규칙 8) — 지름길을 쓰지 않는다.
    `global_id` 는 두 프로젝트에 모두 있으므로 `?project_id=` 로 반드시 지정한다(ADR 0005 §3).
    """
    for role, state in (("contractor", "REPORTED"), ("contractor", "INSPECTION_REQUESTED"), ("cm", "CONFIRMED")):
        r = client.post(f"/api/objects/{global_id}/transitions", headers=auth(role),
                        params={"project_id": project_id}, json={"to_state": state})
        assert r.status_code == 201, (project_id, global_id, state, r.text)


# ═══════════════════════════════════════════════════════════════════════════
# S1·S2·S4·S5 — 같은 IFC + 같은 공정표를 두 프로젝트에
# ═══════════════════════════════════════════════════════════════════════════
@pytest.fixture(scope="module")
def twins(client, auth, user_ids) -> dict:
    """p1 을 **먼저 끝까지** 만든 뒤 p2 에 같은 두 파일을 올린다.

    순서가 이 파일의 증명력 전부다 — 재현된 결함은 "두 번째 업로드가 첫 번째 프로젝트의 Activity 를
    삭제하고 자기 것으로 다시 만든다"였다. p2 를 올리기 전 p1 의 상태를 찍어 두고, 올린 뒤 그대로인지 본다.
    """
    p1 = _new_project(client, auth, user_ids, "ADR 0008 회귀 — 현장 1")
    p2 = _new_project(client, auth, user_ids, "ADR 0008 회귀 — 현장 2")
    assert p1 != p2

    _, ifc1 = upload(client, auth("contractor"), p1, FIXTURES / "sample.ifc")
    assert ifc1["status"] == "done", ifc1
    up1, sch1 = upload(client, auth("cm"), p1, FIXTURES / "schedule.csv")
    assert up1["kind"] == "csv" and sch1["status"] == "done", sch1
    p1_before = _activity_ids(client, auth, p1)
    assert set(p1_before) == EXPECTED_ACTIVITIES, p1_before   # 2단계 전제가 실제로 성립했는지 먼저 확인

    _, ifc2 = upload(client, auth("contractor"), p2, FIXTURES / "sample.ifc")
    assert ifc2["status"] == "done", ifc2
    up2, sch2 = upload(client, auth("cm"), p2, FIXTURES / "schedule.csv")
    assert up2["kind"] == "csv" and sch2["status"] == "done", sch2

    return {"p1": p1, "p2": p2, "p1_before": p1_before, "sch1": sch1, "sch2": sch2}


def test_s1_second_upload_does_not_steal_the_first_projects_schedule(client, auth, twins):
    """S1(핵심): 고치기 전에는 여기서 `GET /projects/p1/activities` 가 `[]` 였다."""
    assert twins["sch2"]["result"]["activity_count"] == EXPECTED_ACTIVITY_COUNT, twins["sch2"]
    assert twins["sch2"]["result"]["relation_count"] == 5, twins["sch2"]

    p1_after = _activity_ids(client, auth, twins["p1"])
    assert p1_after == twins["p1_before"], "p2 업로드가 p1 의 Activity 를 가져갔다(ADR 0008 §Context 1 재발)"
    assert set(p1_after) == EXPECTED_ACTIVITIES
    assert set(_activity_ids(client, auth, twins["p2"])) == EXPECTED_ACTIVITIES


def test_s1_activities_table_holds_both_projects_rows(twins):
    """S1-6: 행이 옮겨간 게 아니라 **양쪽에 따로** 있는지 DB 로 직접 본다(API 응답만으로는 구별되지 않는다)."""
    with session_scope() as session:
        rows = [(r.project_id, r.activity_id) for r in session.query(ActivityRow)
                .filter(ActivityRow.project_id.in_([twins["p1"], twins["p2"]])).all()]
    per_project: dict[str, set[str]] = {}
    for pid, aid in rows:
        per_project.setdefault(pid, set()).add(aid)
    assert per_project == {twins["p1"]: EXPECTED_ACTIVITIES, twins["p2"]: EXPECTED_ACTIVITIES}
    assert len(rows) == 2 * EXPECTED_ACTIVITY_COUNT   # 12 행 — 중복 없이 정확히 6+6


def test_s1_startable_never_names_another_projects_activity(client, auth, twins):
    """S1-7: 착수 가능 집합과 그 근거(`related_ids`)에 남의 프로젝트 Activity 가 섞이지 않는다."""
    for pid in (twins["p1"], twins["p2"]):
        r = client.get(f"/api/projects/{pid}/startable", headers=auth("client"))
        assert r.status_code == 200, r.text
        st = r.json()
        assert st["project_id"] == pid
        assert st["startable"] == ["A100"], st
        assert set(st["startable"]) | set(st["blocked"]) <= EXPECTED_ACTIVITIES
        # 차단 사유가 Activity 를 가리킬 때(선행공정) 그 id 는 반드시 이 프로젝트의 것이어야 한다.
        # 다른 축(검측·자재 등)의 related_ids 는 global_id 라 여기서 보지 않는다.
        own = set(_activity_ids(client, auth, pid))
        pointed: set[str] = set()
        for aid, blockers in st["blocked"].items():
            for b in blockers:
                if b["component"] == "predecessor_completion":
                    pointed.update(b["related_ids"])
                    assert set(b["related_ids"]) <= own, (pid, aid, b)
        assert pointed, st   # 회귀 방지: 아무것도 가리키지 않으면 위 단언이 공허하게 참이 된다


def test_s2_object_mappings_stay_in_both_projects(twins):
    """S2-8: 고치기 전에는 `activity_object_mappings` 27행이 통째로 p2 로 옮겨갔다(삭제가 아니라
    `session.get()` 이 p1 의 행을 찾아 `project_id` 를 덮어썼다 — ADR 0008 §Context 1)."""
    n = twins["sch1"]["result"]["mapping_count"]
    assert n == EXPECTED_OBJECT_MAPPING_COUNT == twins["sch2"]["result"]["mapping_count"], (twins["sch1"], twins["sch2"])
    with session_scope() as session:
        rows = session.query(ActivityObjectMappingRow).filter(
            ActivityObjectMappingRow.project_id.in_([twins["p1"], twins["p2"]])).all()
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.project_id] = counts.get(r.project_id, 0) + 1
    assert counts == {twins["p1"]: n, twins["p2"]: n}
    assert len(rows) == 2 * n


def test_s2_confirming_an_object_in_one_project_does_not_move_the_other(client, auth, twins):
    """S2-9: 같은 `(activity_id, global_id)` 라도 프로젝트가 다르면 상태·readiness 가 따로 논다.

    p2 의 A100 매핑 객체를 전부 CONFIRMED 로 만든다 — 이 전이는 S4 의 전제이기도 하다(모듈 순서 의존).
    """
    p1, p2 = twins["p1"], twins["p2"]
    acts1 = {a["activity_id"]: a for a in client.get(f"/api/projects/{p1}/activities", headers=auth("cm")).json()}
    acts2 = {a["activity_id"]: a for a in client.get(f"/api/projects/{p2}/activities", headers=auth("cm")).json()}
    gids1, gids2 = acts1["A100"]["mapped_global_ids"], acts2["A100"]["mapped_global_ids"]
    assert gids1 and gids1 == gids2, "같은 IFC·같은 공정표이므로 매핑된 global_id 집합도 같아야 한다"

    before_p1 = _component(client, auth, p1, "A110", "predecessor_completion")
    assert before_p1 == 0.0, before_p1

    for gid in gids2:
        _confirm_object(client, auth, p2, gid)

    # p2 에서만 확정했으므로 p1 의 같은 global_id 는 PLANNED 그대로다.
    for gid in gids2:
        d1 = client.get(f"/api/objects/{gid}", headers=auth("cm"), params={"project_id": p1}).json()
        d2 = client.get(f"/api/objects/{gid}", headers=auth("cm"), params={"project_id": p2}).json()
        assert d1["current_state"]["state"] == "PLANNED", (gid, d1["current_state"])
        assert d2["current_state"]["state"] == "CONFIRMED", (gid, d2["current_state"])


def test_s4_predecessors_do_not_leak_across_projects(client, auth, twins):
    """S4(계획 0002 §1-b): `predecessors_of` 는 **이 사이클에서 스키마가 잡아주지 않는 유일한 자리**다.

    복합 PK 는 `session.get()` 경로만 `InvalidRequestError` 로 터뜨린다. `select().where(successor_id == …)`
    는 조용히 남의 프로젝트 관계를 끌어온다 — 그래서 이 시나리오만 따로 노린다.

    직전 테스트가 p2 의 A100 만 CONFIRMED 로 만들었다. p2/A110 은 1.0 이 되고 p1/A110 은 0.0 그대로여야
    한다. 필터가 빠지면 `successor_id == "A110"` 인 관계가 **두 개**(p1·p2) 잡혀 근거가 중복 계산되므로,
    값뿐 아니라 blocker 의 `related_ids`·사유 문구까지 함께 고정한다(값만 보면 겹친 관계가 같은 방향으로
    합쳐져 우연히 통과할 수 있다). 프로젝트별로 관계 그래프가 다른 경우는 `test_s4_only_*` 가 본다.
    """
    p1, p2 = twins["p1"], twins["p2"]

    r2 = _readiness(client, auth, p2, "A110")
    assert r2.status_code == 200, r2.text
    score2 = r2.json()
    assert score2["components"]["predecessor_completion"] == 1.0, score2["components"]
    assert _blocker(score2, "predecessor_completion") is None, score2["blockers"]

    r1 = _readiness(client, auth, p1, "A110")
    assert r1.status_code == 200, r1.text
    score1 = r1.json()
    assert score1["components"]["predecessor_completion"] == 0.0, score1["components"]
    b1 = _blocker(score1, "predecessor_completion")
    assert b1 is not None, score1["blockers"]
    # 정확히 선행 **1개**(p1 의 A100)만 세어야 한다. 누수가 있으면 p2 의 A100->A110 관계까지 잡혀
    # "2/2 …" 가 되고 related_ids 에 A100 이 두 번 들어간다.
    assert b1["related_ids"] == ["A100"], b1
    assert b1["reason"] == "1/1 predecessor activities not CONFIRMED", b1


# ═══════════════════════════════════════════════════════════════════════════
# S4 전용 — 관계 그래프가 프로젝트마다 다르면 누수가 **점수 자체**를 틀리게 만든다
# ═══════════════════════════════════════════════════════════════════════════
@pytest.fixture(scope="module")
def divergent_twins(client, auth, user_ids, tmp_path_factory) -> dict:
    """같은 `activity_id` 를 쓰되 **선행 관계만 다른** 두 공정표를 각각의 프로젝트에 올린다.

    q1: A110 의 선행은 A100(미완료)  -> predecessor_completion = 0.0
    q2: A110 의 선행은 A120(완료)    -> predecessor_completion = 1.0

    `predecessors_of` 에서 `project_id` 필터가 빠지면 `successor_id == "A110"` 로 **양쪽 관계가 모두**
    잡히고, 각 관계의 선행 Activity 를 **호출한 프로젝트 안에서** 다시 읽으므로 두 프로젝트 모두
    0.5 가 된다 — 값이 실제로 틀린다. IFC 없이 `percent_complete` 로만 완료를 표현해 이 축 하나만 남긴다.
    """
    q1 = _new_project(client, auth, user_ids, "ADR 0008 선행공정 누수 — 현장 1")
    q2 = _new_project(client, auth, user_ids, "ADR 0008 선행공정 누수 — 현장 2")
    tmp = tmp_path_factory.mktemp("adr0008-predecessors")
    header = "activity_id,name,discipline,predecessors,percent_complete\n"
    csv1 = tmp / "diverge-q1.csv"
    csv1.write_text(header
                    + "A100,q1 선행(미완료),structure,,0\n"
                    + "A110,q1 후행,structure,A100:FS:0,0\n"
                    + "A120,q1 별개(완료),structure,,100\n", encoding="utf-8")
    csv2 = tmp / "diverge-q2.csv"
    csv2.write_text(header
                    + "A100,q2 선행(미완료),structure,,0\n"
                    + "A110,q2 후행,structure,A120:FS:0,0\n"
                    + "A120,q2 별개(완료),structure,,100\n", encoding="utf-8")

    _, job1 = upload(client, auth("cm"), q1, csv1)
    assert job1["status"] == "done", job1
    _, job2 = upload(client, auth("cm"), q2, csv2)
    assert job2["status"] == "done", job2
    return {"q1": q1, "q2": q2}


def test_s4_only_predecessor_filter_keeps_each_projects_graph(client, auth, divergent_twins):
    """S4 전용: 프로젝트마다 선행 그래프가 다르면 누수가 점수를 직접 틀리게 만든다."""
    q1, q2 = divergent_twins["q1"], divergent_twins["q2"]

    s1 = _readiness(client, auth, q1, "A110").json()
    assert s1["components"]["predecessor_completion"] == 0.0, s1["components"]
    b1 = _blocker(s1, "predecessor_completion")
    assert b1 is not None and b1["related_ids"] == ["A100"], b1   # q2 의 A120 관계를 끌어오면 여기 A120 이 섞인다

    s2 = _readiness(client, auth, q2, "A110").json()
    assert s2["components"]["predecessor_completion"] == 1.0, s2["components"]
    assert _blocker(s2, "predecessor_completion") is None, s2["blockers"]

    # 대조군: 선행이 아예 없는 A100 은 양쪽 모두 1.0(관계 조회 자체가 빈 결과여야 한다)
    for pid in (q1, q2):
        s = _readiness(client, auth, pid, "A100").json()
        assert s["components"]["predecessor_completion"] == 1.0, (pid, s["components"])


# ═══════════════════════════════════════════════════════════════════════════
# S3 — 문서 매핑 독립성 (ADR 0007 §Deferred 해소 증거)
# ═══════════════════════════════════════════════════════════════════════════
def _doc_mapping_reviews(client, auth, project_id: str, status: str | None = None) -> list[dict]:
    params: dict[str, str] = {"kind": "document_mapping"}
    if status is not None:
        params["status"] = status
    r = client.get(f"/api/projects/{project_id}/review-requests", headers=auth("cm"), params=params)
    assert r.status_code == 200, r.text
    return sorted(r.json(), key=lambda x: (x["activity_id"] or "", x["conflicting_sources"]["doc_id"]))


@pytest.fixture(scope="module")
def doc_twins(client, auth, user_ids) -> dict:
    """d1 에서 2쌍 확정 + 1쌍 반려한 **뒤에** d2 에 같은 대장을 올린다.

    고치기 전에는 `_drop_already_confirmed` 가 `(activity_id, doc_id)` 만 보고 d1 의 판단을 d2 후보에서
    지워 `mapping_count` 가 6 이 아니라 3 이 됐다(ADR 0008 §Context 2 실측). d2 의 CM 은 **자기가 본 적도
    없는 남의 판단 때문에** 문서 3건이 큐에 뜨지 않는 것을 겪는다.

    **이 픽스처는 개수를 단언하지 않는다.** 개수 단언은 아래 S3 테스트가 한다 — 누수가 있으면
    (이 파일보다 먼저 도는 test_13/14/15 도 같은 대장을 쓰므로) d1 조차 오염된다. 픽스처에서 단언하면
    그 실패가 S3 가 아니라 이 픽스처에 매달린 S5 confirm 테스트들까지 통째로 ERROR 로 만들어
    "어느 방어가 무너졌는지"를 흐린다(12차 리뷰가 지적한 것과 같은 종류의 뭉개짐).
    """
    d1 = _new_project(client, auth, user_ids, "ADR 0008 문서 매핑 — 현장 1")
    d2 = _new_project(client, auth, user_ids, "ADR 0008 문서 매핑 — 현장 2")
    for pid in (d1, d2):
        _, job = upload(client, auth("cm"), pid, FIXTURES / "schedule.csv")
        assert job["status"] == "done", job

    _, reg1 = upload(client, auth("cm"), d1, FIXTURES / "document_register.xlsx")
    assert reg1["status"] == "done", reg1

    open1 = _doc_mapping_reviews(client, auth, d1, status="open")
    assert len(open1) >= 3, open1   # 확정 2 + 반려 1 을 만들 수 있을 만큼만 요구한다(개수 단언은 S3 테스트)
    confirmed = [(r["activity_id"], r["conflicting_sources"]["doc_id"]) for r in open1[:2]]
    rejected_review, rejected_pair = open1[2], (open1[2]["activity_id"], open1[2]["conflicting_sources"]["doc_id"])

    for activity_id, doc_id in confirmed:
        r = client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/confirm", headers=auth("cm"),
                        params={"project_id": d1}, json={"note": "d1 CM 확정"})
        assert r.status_code == 200, r.text
    r = client.post(f"/api/review-requests/{rejected_review['review_request_id']}/resolve", headers=auth("cm"),
                    json={"decision": "rejected", "note": "d1 CM 반려 — 이 현장과 무관"})
    assert r.status_code == 200 and r.json()["status"] == "rejected", r.text

    _, reg2 = upload(client, auth("cm"), d2, FIXTURES / "document_register.xlsx")
    assert reg2["status"] == "done", reg2
    return {"d1": d1, "d2": d2, "reg1": reg1, "reg2": reg2, "open1": open1,
            "confirmed": confirmed, "rejected": rejected_pair}


def test_s3_first_project_starts_with_a_full_queue(client, auth, doc_twins):
    """S3-10 전반: d1 은 자기 대장 그대로 6건이다.

    이 파일보다 먼저 도는 test_13/14/15 도 같은 `document_register.xlsx` 를 쓰므로, 확정·반려가 프로젝트를
    넘어 새면 **d1 조차** 6건으로 시작하지 못한다. 그 경우 아래 d2 단언보다 여기가 먼저 실패해 원인을
    가리킨다."""
    assert doc_twins["reg1"]["result"]["mapping_count"] == EXPECTED_DOC_MAPPING_COUNT, doc_twins["reg1"]
    assert len(doc_twins["open1"]) == EXPECTED_DOC_MAPPING_COUNT, doc_twins["open1"]


def test_s3_one_projects_review_decisions_do_not_shrink_the_others_queue(client, auth, doc_twins):
    """S3-10·12: 고치기 전 여기서 `mapping_count` 가 6 이 아니라 **3** 이었다."""
    assert doc_twins["reg2"]["result"]["mapping_count"] == EXPECTED_DOC_MAPPING_COUNT, doc_twins["reg2"]
    assert len(_doc_mapping_reviews(client, auth, doc_twins["d2"], status="open")) == EXPECTED_DOC_MAPPING_COUNT

    # "매주 재업로드"를 한 번 더 해도 여전히 6건이고 새 요청이 생기지도 않는다.
    _, again = upload(client, auth("cm"), doc_twins["d2"], FIXTURES / "document_register.xlsx")
    assert again["status"] == "done", again
    assert again["result"]["mapping_count"] == EXPECTED_DOC_MAPPING_COUNT, again
    assert len(_doc_mapping_reviews(client, auth, doc_twins["d2"])) == EXPECTED_DOC_MAPPING_COUNT


def test_s3_document_mapping_rows_exist_in_both_projects(doc_twins):
    """S3: 같은 `(activity_id, doc_id)` 쌍이 프로젝트별로 **따로** 존재한다(옮겨간 게 아니다)."""
    with session_scope() as session:
        rows = session.query(ActivityDocumentMappingRow).filter(
            ActivityDocumentMappingRow.project_id.in_([doc_twins["d1"], doc_twins["d2"]])).all()
        by_project: dict[str, set[tuple[str, str]]] = {}
        for r in rows:
            by_project.setdefault(r.project_id, set()).add((r.activity_id, r.doc_id))
    assert set(by_project) == {doc_twins["d1"], doc_twins["d2"]}
    assert by_project[doc_twins["d1"]] == by_project[doc_twins["d2"]]
    assert len(by_project[doc_twins["d1"]]) == EXPECTED_DOC_MAPPING_COUNT
    assert len(rows) == 2 * EXPECTED_DOC_MAPPING_COUNT


def test_s3_rejection_in_one_project_does_not_reject_the_pair_in_the_other(client, auth, doc_twins):
    """S3-13: d1 에서 반려한 쌍을 d2 에서 확정하면 **200** 이다. 409 가 나오면 반려가 샌 것이다."""
    activity_id, doc_id = doc_twins["rejected"]
    r = client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/confirm", headers=auth("cm"),
                    params={"project_id": doc_twins["d2"]}, json={"note": "d2 CM 은 이 문서를 인정한다"})
    assert r.status_code == 200, r.text
    assert r.json()["needs_review"] is False
    assert (r.json()["evidence"].get("extra") or {}).get("mapping_review_decision") is None


def test_s3_first_projects_decisions_survive_the_second_projects_upload(client, auth, doc_twins, user_ids):
    """S3-14: d2 쪽 작업이 d1 의 확정 2쌍·반려 1쌍을 되돌리지 않았다."""
    d1 = doc_twins["d1"]
    with session_scope() as session:
        for activity_id, doc_id in doc_twins["confirmed"]:
            row = session.get(ActivityDocumentMappingRow, (d1, activity_id, doc_id))
            assert row is not None and row.needs_review is False, (activity_id, doc_id)
            assert row.reviewed_by == user_ids["cm"]
            assert (row.evidence.get("extra") or {}).get("mapping_review_decision") is None
        activity_id, doc_id = doc_twins["rejected"]
        row = session.get(ActivityDocumentMappingRow, (d1, activity_id, doc_id))
        assert row is not None and row.needs_review is False
        assert row.evidence["extra"]["mapping_review_decision"] == "rejected"


# ═══════════════════════════════════════════════════════════════════════════
# S5 — 대리키 라우트 인가 (ADR 0006 규칙 2·6, ADR 0008 §5)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.fixture(scope="module")
def outsider(client, auth) -> dict[str, str]:
    """어떤 프로젝트의 멤버도 아닌 계정. 전역 `users.role` 은 인가 판단에 쓰이지 않는다(ADR 0006 §2)."""
    import uuid

    email = f"u-{uuid.uuid4().hex[:10]}@buildtwin.local"
    r = client.post("/api/auth/register", headers=auth("admin"),
                    json={"email": email, "password": "secret123", "role": "cm"})
    assert r.status_code == 201, r.text
    lr = client.post("/api/auth/login", json={"username": email, "password": "secret123"})
    assert lr.status_code == 200, lr.text
    return {"Authorization": f"Bearer {lr.json()['access_token']}"}


def test_s5_readiness_requires_project_id(client, auth, twins):
    """S5-17: `project_id` 누락은 422 — 조용히 "아무 프로젝트나" 로 해석되지 않는다(ADR 0008 §5)."""
    r = client.get("/api/activities/A100/readiness", headers=auth("cm"))
    assert r.status_code == 422, r.text
    assert client.get("/api/activities/A100/readiness").status_code == 401   # 토큰 없음은 인가 이전 단계


def test_s5_readiness_answers_per_project_for_the_same_activity_id(client, auth, twins):
    """S5-18·19: 같은 `activity_id` 라도 `project_id` 에 따라 **그 프로젝트 기준** 점수를 돌려준다."""
    p1, p2 = twins["p1"], twins["p2"]
    s1 = _readiness(client, auth, p1, "A110").json()
    s2 = _readiness(client, auth, p2, "A110").json()
    assert s1["activity_id"] == s2["activity_id"] == "A110"
    # 앞선 시나리오에서 p2 의 A100 만 확정했으므로 두 점수는 반드시 달라야 한다 — 같으면 프로젝트를
    # 구분하지 않고 한쪽 답을 양쪽에 주고 있다는 뜻이다.
    assert s1["components"]["predecessor_completion"] != s2["components"]["predecessor_completion"]
    assert s1["score"] != s2["score"], (s1["score"], s2["score"])


def test_s5_readiness_hides_existence_from_non_members(client, auth, twins, outsider):
    """S5-20: 비멤버에게는 **실재하는 activity_id 든 없는 id 든 바이트 단위로 같은 응답**이다.

    구현 순서가 계약의 일부다(ADR 0008 §5) — 멤버십 먼저, 행 조회는 그 다음. 행을 먼저 읽으면
    비멤버가 응답 차이로 타 프로젝트의 Activity 존재 여부를 알아낼 수 있다(ADR 0006 규칙 2).
    """
    p2 = twins["p2"]
    real = client.get(f"/api/activities/A100/readiness?project_id={p2}", headers=outsider)
    fake = client.get(f"/api/activities/{NO_SUCH_ACTIVITY}/readiness?project_id={p2}", headers=outsider)
    assert real.status_code == fake.status_code == 404, (real.text, fake.text)
    assert real.json()["code"] == "project_not_found", real.text
    assert real.content == fake.content, (real.text, fake.text)   # 존재를 흘리지 않는다

    # 멤버에게는 없는 id 가 activity_not_found 로 구분된다(비멤버 응답과 code 가 다르다).
    member = _readiness(client, auth, p2, NO_SUCH_ACTIVITY)
    assert member.status_code == 404 and member.json()["code"] == "activity_not_found", member.text


def test_s5_confirm_requires_project_id(client, auth, doc_twins):
    """S5-21: confirm 라우트도 같은 표를 만족한다 — 누락 422 / 토큰 없음 401."""
    activity_id, doc_id = doc_twins["confirmed"][0]
    path = f"/api/documents/mappings/{activity_id}/{doc_id}/confirm"
    assert client.post(path, headers=auth("cm"), json={"note": "x"}).status_code == 422
    assert client.post(path, json={"note": "x"}).status_code == 401


def test_s5_confirm_role_matrix(client, auth, doc_twins):
    """S5-21: 확정은 cm 만(ADR 0007 §7). contractor 는 멤버지만 403, admin 은 멤버가 될 수 없어 403."""
    d1 = doc_twins["d1"]
    activity_id, doc_id = doc_twins["confirmed"][0]
    path = f"/api/documents/mappings/{activity_id}/{doc_id}/confirm"
    for role in ("contractor", "client", "admin"):
        r = client.post(path, headers=auth(role), params={"project_id": d1}, json={"note": "권한 없는 확정 시도"})
        assert r.status_code == 403, (role, r.text)
        assert r.json()["code"] == "forbidden_role", (role, r.text)


def test_s5_confirm_hides_existence_from_non_members(client, auth, doc_twins, outsider):
    """S5-20·21: 비멤버에게는 실재하는 매핑이든 없는 매핑이든 바이트 단위로 같은 404 다."""
    d1 = doc_twins["d1"]
    activity_id, doc_id = doc_twins["confirmed"][0]
    real = client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/confirm?project_id={d1}",
                       headers=outsider, json={"note": "x"})
    fake = client.post(f"/api/documents/mappings/{NO_SUCH_ACTIVITY}/{NO_SUCH_DOC}/confirm?project_id={d1}",
                       headers=outsider, json={"note": "x"})
    assert real.status_code == fake.status_code == 404, (real.text, fake.text)
    assert real.json()["code"] == "project_not_found", real.text
    assert real.content == fake.content, (real.text, fake.text)


def test_s5_confirm_target_not_found_is_distinguishable_for_members(client, auth, doc_twins):
    """S5-21: 멤버(cm)에게는 없는 매핑이 404 `document_mapping_target_not_found` 로 구분된다."""
    r = client.post(f"/api/documents/mappings/{NO_SUCH_ACTIVITY}/{NO_SUCH_DOC}/confirm",
                    headers=auth("cm"), params={"project_id": doc_twins["d1"]}, json={"note": "x"})
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "document_mapping_target_not_found", r.text


def test_s5_confirm_refuses_a_rejected_pair_in_its_own_project(client, auth, doc_twins):
    """S5-21: 기존 계약 유지 — d1 에서 반려된 쌍을 d1 에서 확정하면 409(같은 쌍이 d2 에서는 200 이다:
    `test_s3_rejection_in_one_project_does_not_reject_the_pair_in_the_other`)."""
    activity_id, doc_id = doc_twins["rejected"]
    r = client.post(f"/api/documents/mappings/{activity_id}/{doc_id}/confirm", headers=auth("cm"),
                    params={"project_id": doc_twins["d1"]}, json={"note": "실수로 확정 시도"})
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "document_mapping_already_rejected", r.text
