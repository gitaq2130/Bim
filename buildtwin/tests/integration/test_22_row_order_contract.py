"""계획 0012 §작업 7 — ⓐ 다섯 자리(A1~A5)의 `ORDER BY` 를 붙드는 회귀 다섯.

## 이 파일이 왜 있는가

계획 0012 §1-d 가 값으로 남긴 관측: 그 다섯 자리에 **역방향 정렬을 주입해도 죽는 것이 0** 이었다
(자리당 N=1, 루트 `pytest -q` 832 passed · postgres `tests/integration` 216 passed — 잰 트리 `08238c9`).
`57fc8ff`(api A1·A2·A4) · `7e4b160`(progress-engine A3) · `2be9918`(sync-2d3d A5) 이 정렬을 붙였고,
세 커밋 본문이 각각 *"이 정렬은 아직 무보호다"* 라고 적었다. **이 파일이 그 다섯 줄을 붙든다**
(ADR 0016 결정 3: *"`ORDER BY` 는 그것을 지우면 죽는 회귀와 같은 사이클에 온다"*).

## 픽스처가 쓰는 축 — **정렬의 역순으로 삽입한다**

기대값을 **삽입 순서**나 **힙 배치**에서 끌어오지 않는다(ADR 0015 §2-1 결정 1). 하는 일은 반대다:
각 자리마다 행을 **붙인 정렬의 역순으로 하나씩 `add`+`flush`** 해서, `ORDER BY` 가 **없을 때** 두 엔진이
흔히 돌려주는 순서(삽입 순서)와 **있을 때**의 순서가 서로 다른 답을 내게 만든다. 기대값은 언제나
**정렬 계약**이 정하는 원소이고, 삽입 순서는 **결함 코드가 다른 답을 내도록** 만드는 장치일 뿐이다.
(계획 0012 §검증 시나리오 S2·S3·S4·S5 가 요구한 것이 이것이다 — 행이 하나뿐이면 결함 코드와 옳은
코드가 **구별되지 않는다**.)

각 테스트는 **① 고른 한 원소의 값**(계약)과 **② 그 목록에 무엇이 들어 있는지의 집합**(음성 대조군)을
함께 단언한다. ②가 있어야 실패가 "순서가 틀렸다"인지 "행이 없어졌다/늘었다"인지 갈린다 —
없으면 이 파일이 다른 이유로 빨개져도 같은 메시지를 낸다.

## 20칸 — **변이 2 × 축 2 × 자리 5** 를 실제로 태운 값

잰 트리: `2be9918` + 이 파일(작업 트리). 기준선은 **sqlite 루트 `pytest -q` 838 passed** ·
**postgres `tests/integration` 222 passed**(`tests_on_postgres=187`, 포트 55441, PostgreSQL 16.13).
*역방향 변이* = 그 `order_by` 의 컬럼마다 `.desc()`. *삭제 변이* = 그 `order_by(...)` 를 지운다.
변이는 **한 건씩** 적용 → `git diff --stat` 으로 적용 확인 → 측정 → 원복 → 루트
`git status --porcelain` 전문 확인(저장소 밖 스크립트).

| 자리 | 역방향 · sqlite | 역방향 · postgres | 삭제 · sqlite | 삭제 · postgres |
|---|---|---|---|---|
| A1 `project_drawings` | `1 failed, 837 passed` (`test_a1_…`) | `1 failed, 221 passed` | `1 failed, 837 passed` | `1 failed, 221 passed` |
| A2 `entity_mappings_for_object` | `1 failed, 837 passed` (`test_a2_…`) | `1 failed, 221 passed` | `1 failed, 837 passed` | `1 failed, 221 passed` |
| A3 `progress…load_mappings` | `2 failed, 836 passed` (`test_a3_…` 둘) | `2 failed, 220 passed` | `2 failed, 836 passed` | **죽은 세션 5/10 — 닫히지 않았다** |
| A4 `model_objects` | `1 failed, 837 passed` (`test_a4_…`) | `1 failed, 221 passed` | `1 failed, 837 passed` | `1 failed, 221 passed` |
| A5 `sync…load_mappings` | `1 failed, 837 passed` (`test_a5_…`) | `1 failed, 221 passed` | **죽은 세션 0/10 — 닫히지 않았다** | `1 failed, 221 passed` |

**18칸이 죽고 두 칸이 안 죽는다. 그 두 칸은 픽스처의 결함이 아니라 구조다** — 그리고 그 사실을
여기 적는 이유는, 다음 사람이 "행을 더 넣으면 되겠지"로 같은 자리를 다시 파지 않게 하기 위해서다.

- **N 의 단위는 pytest 세션이다**(세션마다 새 스키마/새 임시 DB + 새 커넥션 — ADR 0015 §2-1 이
  *"같은 세-술어 문장이 세션마다 다른 btree 를 고른다"* 를 잰 그 단위). 두 부정 단정 모두 **N=10**,
  명령은 `pytest -q tests/integration`(축만 갈아 끼운다).
- **왜 안 죽는가 — 붙인 정렬 키가 「필터를 뺀 PK 나머지」와 같기 때문이다.** ADR 0016 결정 2 가
  A3·A5 의 키를 **결정성의 축**(PK 또는 PK 접두사)으로 골랐고, 그 선택의 대가가 이 두 칸이다:
  플래너가 **PK 인덱스를 걷는 계획**을 고르면 `ORDER BY` 가 없어도 결과가 이미 그 순서다.
  실행값(저장소 밖 탐침, 같은 포트·같은 ORM 스키마, 세션 12회):
  - A3 무정렬 → `Index Scan using activity_object_mappings_pkey` **12/12**, 첫 행 `ORD-A100`
    (= 정렬이 있을 때와 **같은 답**). 통합 세션에서는 행 수·통계가 달라 계획이 갈리고, 그래서
    5/10 만 죽는다.
  - A5 무정렬 → postgres 는 `Bitmap Heap Scan` **12/12**(삽입 순서 → 죽는다)인데 **SQLite** 는
    `SEARCH … USING INDEX sqlite_autoindex_entity_object_mappings_1 (drawing_id=?)` 라
    (`entity_handle`, `global_id`) 순서가 공짜로 나온다 → 첫 행이 `H-aaa/G1` 로 **정답과 같다**.
  - 즉 **어떤 픽스처도 이 두 칸을 죽일 수 없다.** 그 계획에서는 결함 코드와 옳은 코드가 **같은 행을
    돌려주기 때문**이고(CLAUDE.md §6-2 1 이 이름 붙인 모양 그대로), 갈리게 하려면 정렬 키를 PK 나머지가
    **아닌** 것으로 바꾸는 수밖에 없다 — 그것은 이 파일의 소유가 아니다.
- **그래서 이 두 자리에서 계약을 실제로 붙드는 것은 역방향 변이 쪽 두 칸이다**(A3·A5 모두 두 축에서
  죽는다). 삭제 변이 두 칸은 §후속으로 남긴다.

## 배역 (한 프로젝트를 다섯 자리가 나눠 쓴다)

| 자리 | 무엇을 태우는가 | 소비자(고르는 한 원소) |
|---|---|---|
| A1 `queries.project_drawings` | 도면 셋(`ord-drawing-a` < `-m` < `-x` < `-z`) | `GET /projects/{id}/drawings` 의 `[0]` — `apps/web/src/pages/ViewerPage.tsx` 의 `list[0]` 폴백 |
| A2 `queries.entity_mappings_for_object` | 한 객체 × 두 도면 × 두 핸들 | `services/api/usecases.py` 의 `mappings[0].drawing_id` → `ObjectDetail.linked.drawing_id` |
| A3 `progress.persistence.load_mappings` | 한 객체 × 두 Activity | `services/api/usecases.py` 의 `logic["activity_ids"][0]` → 규칙 평가 응답의 `context.activity_id` |
| A4 `queries.model_objects` | **bbox 가 완전히 같은** 후보 둘 | `services/sync/matcher.py` 의 `max(scored, key=(conf, iou))` — 동률에서 첫 원소 |
| A5 `sync.persistence.load_mappings` | 한 도면 × 두 핸들 × 두 객체 | `GET /drawings/{id}/mappings` 의 `[0]` · `find(x => x.global_id === g)` |

**A2 가 한 객체를 두 도면에 거는 이유**: 같은 도면 안 두 핸들만으로는 `drawing_id` 축이 드러나지 않는다.
**A1 이 도면을 새로 만드는 이유**: 통합 스위트의 다른 자리는 `project_drawings` 를 1회·≤1행으로만
태운다(계획 0012 §1-c) — 행이 하나면 순서가 없다.

## 화면 축 — 이 파일 밖

판정 경로가 둘이다(계획 0012 §검증 시나리오 말미): **① 서버가 순서를 정하는가**(이 파일)
**② 화면이 그 순서를 그대로 쓰는가**. ②의 자리는 `apps/web/` 이고 이 파일은 거기 없다.
- A5 의 브로커 축은 **이미 있다**: `apps/web/src/sync/broker.test.ts` 의
  *"3D 선택 → 2D highlight(매핑된 handle, exclusive) + panTo(첫 handle)"* 가 `panTo(handles[0])` 를
  서버가 준 순서의 첫 핸들로 못박는다.
- A1·A5 의 `ViewerPage` 축은 **없다** — `ls apps/web/src/pages/*.test.tsx` 에 `ViewerPage.test.tsx` 가
  없다(실행값: `DocumentDetailPage` · `DocumentsPage` · `ProjectMembersPage` · `ReviewsPage` ·
  `SummaryPage` · `UploadPage` 여섯뿐). **없는 것을 있다고 하지 않는다.**
"""
from __future__ import annotations

import pytest

from packages.core.db import session_scope
from packages.core.models.orm import (
    ActivityObjectMappingRow,
    ActivityRow,
    BimObjectRow,
    DrawingEntityRow,
    DrawingRow,
    EntityObjectMappingRow,
    FileRow,
    ModelRow,
    ScheduleRow,
)

from .conftest import add_member

# ---------------------------------------------------------------- 배역 상수
FILE_ID = "ord-file"
MODEL_ID = "ord-model"
SCHEDULE_ID = "ord-schedule"

#: 오름차순: a < m < x < z. A1 의 `[0]` 은 언제나 `D_FIRST` 다.
D_FIRST = "ord-drawing-a"
D_A5 = "ord-drawing-m"
D_A4 = "ord-drawing-x"
D_LAST = "ord-drawing-z"
ALL_DRAWINGS = [D_FIRST, D_A5, D_A4, D_LAST]

H_FIRST, H_LAST = "H-aaa", "H-zzz"

OBJ_A2 = "ORD-OBJ-A2"
OBJ_A3 = "ORD-OBJ-A3"
OBJ_A4_WINS = "ORD-OBJ-A4-A"     # global_id 오름차순의 첫 원소
OBJ_A4_LOSES = "ORD-OBJ-A4-Z"
OBJ_A5 = "ORD-OBJ-A5"
OBJ_A5B = "ORD-OBJ-A5B"

ACT_FIRST, ACT_LAST = "ORD-A100", "ORD-A900"

#: A4 의 동률을 만드는 유일한 장치 — 두 후보가 **완전히 같은** bbox·ifc_type 을 갖는다.
A4_BBOX = {"min": [0.0, 0.0, 0.0], "max": [2.0, 2.0, 3.0]}
A4_IFC_TYPE = "IfcColumn"
A4_ENTITY_HANDLE = "E-A4"
A4_ALIGNMENT = {"origin": [0.0, 0.0], "rotation_deg": 0.0, "scale": 1.0, "source": "user_input"}

_CS = {"source": "ifc_local", "origin": [0.0, 0.0, 0.0], "rotation_deg": 0.0, "scale": 1.0, "unit": "m"}


def _evidence(note: str) -> dict:
    return {"source_type": "mapping", "source_id": "plan-0012-work-7", "method": "fixture", "note": note, "extra": {}}


def _plant(session, row) -> None:
    """한 행씩 `add` + `flush`. **호출 순서 = 삽입 순서**이고, 이 파일은 그것을 정렬의 역순으로 부른다."""
    session.add(row)
    session.flush()


def _drawing(project_id: str, drawing_id: str, level: str | None) -> DrawingRow:
    return DrawingRow(drawing_id=drawing_id, project_id=project_id, file_id=FILE_ID, level=level,
                      coordinate_system=dict(_CS), alignment=None, svg_uri=None, stats={})


def _obj(project_id: str, global_id: str, *, bbox: dict | None = None, ifc_type: str = "IfcWall") -> BimObjectRow:
    return BimObjectRow(project_id=project_id, global_id=global_id, model_id=MODEL_ID, model_version=1,
                        ifc_type=ifc_type, name=global_id, level=None, bbox=bbox, psets={}, quantity={},
                        state="PLANNED", is_orphaned=False)


def _entity_mapping(project_id: str, drawing_id: str, handle: str, global_id: str, confidence: float) -> EntityObjectMappingRow:
    return EntityObjectMappingRow(drawing_id=drawing_id, entity_handle=handle, global_id=global_id,
                                  project_id=project_id, confidence=confidence,
                                  evidence=_evidence(f"{drawing_id}/{handle}/{global_id}"), needs_review=False)


@pytest.fixture(scope="module")
def ordering_project(client, auth, user_ids) -> str:
    """이 파일 전용 프로젝트. **모든 행을 붙인 정렬의 역순으로 심는다**(파일 머리 「픽스처가 쓰는 축」).

    `client` 를 통해 프로젝트·멤버십만 API 로 만들고, 나머지 행은 `session_scope` 로 직접 심는다 —
    다섯 자리 각각이 요구하는 **행의 모양**(같은 객체가 두 도면에, 같은 bbox 를 갖는 후보 둘 …)은
    업로드 픽스처가 만들어 주지 않는다.
    """
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "정렬 계약 회귀(계획 0012 작업 7)"})
    assert r.status_code == 201, r.text
    project_id = r.json()["project_id"]
    for role in ("contractor", "cm", "client"):
        add_member(client, auth("admin"), project_id, user_ids[role], role)

    with session_scope() as session:
        _plant(session, FileRow(file_id=FILE_ID, project_id=project_id, kind="ifc", filename="ord.ifc",
                                uri="memory://ord.ifc", sha256="0" * 64, size=1))
        _plant(session, ModelRow(model_id=MODEL_ID, project_id=project_id, file_id=FILE_ID, version=1,
                                 coordinate_system=dict(_CS), levels=[], stats={}))
        _plant(session, ScheduleRow(schedule_id=SCHEDULE_ID, project_id=project_id, file_id=None,
                                    source_format="csv", warnings=[]))

        # A1 — 도면 넷을 `drawing_id` 오름차순의 **역순**으로 심는다.
        for did in reversed(ALL_DRAWINGS):
            _plant(session, _drawing(project_id, did, level="1F" if did == D_FIRST else None))

        # 객체. A4 의 둘만 bbox 를 갖는다(`jobs.build_and_persist_mappings` 가 bbox 없는 객체를 거른다).
        for gid in (OBJ_A2, OBJ_A3, OBJ_A5, OBJ_A5B):
            _plant(session, _obj(project_id, gid))
        _plant(session, _obj(project_id, OBJ_A4_LOSES, bbox=dict(A4_BBOX), ifc_type=A4_IFC_TYPE))
        _plant(session, _obj(project_id, OBJ_A4_WINS, bbox=dict(A4_BBOX), ifc_type=A4_IFC_TYPE))

        # A2 — (`drawing_id`, `entity_handle`) 오름차순의 역순.
        for did, handle in ((D_LAST, H_LAST), (D_FIRST, H_LAST), (D_FIRST, H_FIRST)):
            _plant(session, _entity_mapping(project_id, did, handle, OBJ_A2, 0.8))

        # A5 — (`entity_handle`, `global_id`) 오름차순의 역순. 같은 객체를 두 핸들에 걸어
        # `find(x => x.global_id === g)` 가 **어느 confidence 를 읽는지** 갈리게 한다.
        _plant(session, _entity_mapping(project_id, D_A5, H_LAST, OBJ_A5, 0.95))
        _plant(session, _entity_mapping(project_id, D_A5, H_FIRST, OBJ_A5B, 0.65))
        _plant(session, _entity_mapping(project_id, D_A5, H_FIRST, OBJ_A5, 0.55))

        # A3 — (`activity_id`, `global_id`) 오름차순의 역순.
        for aid in (ACT_LAST, ACT_FIRST):
            _plant(session, ActivityRow(project_id=project_id, activity_id=aid, schedule_id=SCHEDULE_ID,
                                        name=f"정렬 회귀 {aid}"))
        for aid in (ACT_LAST, ACT_FIRST):
            _plant(session, ActivityObjectMappingRow(project_id=project_id, activity_id=aid, global_id=OBJ_A3,
                                                     confidence=0.9, evidence=_evidence(f"{aid}/{OBJ_A3}"),
                                                     needs_review=False))

        # A4 — 도면 엔티티 하나. 두 후보의 bbox 와 **정확히 겹치는** 닫힌 폴리라인이라 두 후보의
        # (confidence, iou) 가 같아진다 = `max` 의 동률.
        _plant(session, DrawingEntityRow(drawing_id=D_A4, handle=A4_ENTITY_HANDLE, layer="A-COL",
                                         dxftype="LWPOLYLINE", points=[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]],
                                         bbox={"min": [0.0, 0.0], "max": [2.0, 2.0]}, attrs={"closed": True}))
        session.commit()
    return project_id


# ---------------------------------------------------------------- A1
def test_a1_project_drawings_first_row_is_the_smallest_drawing_id(client, auth, ordering_project):
    """A1 — `GET /projects/{id}/drawings` 의 `[0]`(뷰어 기본 도면 폴백)이 `drawing_id` 최소값이다."""
    r = client.get(f"/api/projects/{ordering_project}/drawings", headers=auth("cm"))
    assert r.status_code == 200, r.text
    ids = [d["drawing_id"] for d in r.json()]
    # 음성 대조군: 행이 넷 다 있고 하나도 새지 않았다(≥2 여야 순서가 존재한다).
    assert sorted(ids) == sorted(ALL_DRAWINGS), ids
    assert ids[0] == D_FIRST, f"뷰어가 여는 기본 도면이 갈렸다: {ids}"


# ---------------------------------------------------------------- A2
def test_a2_object_detail_links_the_smallest_drawing_and_handle(client, auth, ordering_project):
    """A2 — `ObjectDetail.linked.drawing_id` = `mappings[0].drawing_id`. 두 키를 함께 태운다."""
    r = client.get(f"/api/objects/{OBJ_A2}", headers=auth("cm"), params={"project_id": ordering_project})
    assert r.status_code == 200, r.text
    refs = [(e["drawing_id"], e["handle"]) for e in r.json()["linked"]["entity_refs"]]
    assert sorted(refs) == [(D_FIRST, H_FIRST), (D_FIRST, H_LAST), (D_LAST, H_LAST)], refs
    assert refs[0] == (D_FIRST, H_FIRST), f"고른 한 원소가 갈렸다: {refs}"
    assert r.json()["linked"]["drawing_id"] == D_FIRST, r.json()["linked"]


# ---------------------------------------------------------------- A3
def test_a3_rule_evaluation_names_the_smallest_activity_id(client, auth, ordering_project):
    """A3 — 규칙 평가가 싣는 Activity 는 `logic["activity_ids"][0]` 이다(`usecases.py` 의 `[0]`).

    `verification.py` 의 `ReviewRequest(activity_id=… or (logic.get("activity_ids") or [None])[0])` 도
    같은 목록의 같은 `[0]` 을 읽는다 — 이 응답이 그 값을 **HTTP 로 보이게 하는 자리**다.
    """
    r = client.post(f"/api/projects/{ordering_project}/rules/evaluate", headers=auth("cm"),
                    json={"global_id": OBJ_A3, "persist": False})
    assert r.status_code == 200, r.text
    body = r.json()
    activity_ids = body["context"]["logic"]["activity_ids"]
    assert sorted(activity_ids) == [ACT_FIRST, ACT_LAST], activity_ids     # 음성 대조군
    assert activity_ids[0] == ACT_FIRST, activity_ids
    assert body["context"]["activity_id"] == ACT_FIRST, body["context"]


def test_a3_object_detail_activity_ids_start_with_the_smallest(client, auth, ordering_project):
    """A3(둘째 소비자) — 객체 상세의 `linked.activity_ids` 도 같은 `load_mappings` 목록이다."""
    r = client.get(f"/api/objects/{OBJ_A3}", headers=auth("cm"), params={"project_id": ordering_project})
    assert r.status_code == 200, r.text
    aids = r.json()["linked"]["activity_ids"]
    assert sorted(aids) == [ACT_FIRST, ACT_LAST], aids
    assert aids[0] == ACT_FIRST, aids


# ---------------------------------------------------------------- A4
def test_a4_tied_candidates_are_broken_by_model_objects_order(client, auth, ordering_project):
    """A4 — `(confidence, iou)` 가 **완전히 같은** 후보 둘에서 `max` 가 고르는 객체.

    동률이 실제로 만들어졌는지를 먼저 값으로 확인한다(계획 0012 §열린 질문 1 · 작업 7 완료 조건 4):
    같은 입력에서 **객체 목록만 뒤집으면 승자가 뒤집힌다** — 동률이 아니면 승자는 같다.
    """
    from services.api import jobs, queries
    from services.sync.matcher import build_mappings
    from services.sync.transform import DrawingAlignment

    with session_scope() as session:
        objects = [o for o in queries.as_models(queries.model_objects(session, MODEL_ID)) if o.bbox is not None]
        entities = jobs.drawing_entities(session, D_A4)
    assert [o.global_id for o in objects] == [OBJ_A4_WINS, OBJ_A4_LOSES], [o.global_id for o in objects]
    alignment = DrawingAlignment.model_validate(A4_ALIGNMENT)
    forward = build_mappings(D_A4, entities, objects, alignment)
    backward = build_mappings(D_A4, entities, list(reversed(objects)), alignment)
    assert len(forward) == len(backward) == 1, (forward, backward)
    assert forward[0].confidence == backward[0].confidence, "동률이 아니다 — 이 배역은 순서를 드러내지 못한다"
    assert forward[0].global_id == OBJ_A4_WINS and backward[0].global_id == OBJ_A4_LOSES, (
        "후보 순서를 뒤집어도 승자가 같다 = 동률이 만들어지지 않았다(작업 7 완료 조건 4)")

    # 그리고 운영 경로(`POST /drawings/{id}/alignment` → `jobs.build_and_persist_mappings`)가
    # `queries.model_objects` 의 순서를 그대로 쓴다.
    r = client.post(f"/api/drawings/{D_A4}/alignment", headers=auth("cm"), json=A4_ALIGNMENT)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done", r.json()
    m = client.get(f"/api/drawings/{D_A4}/mappings", headers=auth("cm"))
    assert m.status_code == 200, m.text
    rows = m.json()
    assert [x["entity_handle"] for x in rows] == [A4_ENTITY_HANDLE], rows      # 음성 대조군
    assert rows[0]["evidence"]["extra"]["candidate_count"] == 2, rows[0]["evidence"]["extra"]
    assert rows[0]["global_id"] == OBJ_A4_WINS, rows[0]


# ---------------------------------------------------------------- A5
def test_a5_drawing_mappings_first_row_and_the_row_find_picks(client, auth, ordering_project):
    """A5 — `GET /drawings/{id}/mappings` 의 `[0]`(브로커의 `panTo(handles[0])`·`flyTo(globalIds[0])`)와
    `find(x => x.global_id === g)`(선택 바 칩의 confidence 배지)가 고르는 행."""
    r = client.get(f"/api/drawings/{D_A5}/mappings", headers=auth("cm"))
    assert r.status_code == 200, r.text
    rows = r.json()
    pairs = [(x["entity_handle"], x["global_id"]) for x in rows]
    assert sorted(pairs) == [(H_FIRST, OBJ_A5), (H_FIRST, OBJ_A5B), (H_LAST, OBJ_A5)], pairs   # 음성 대조군
    assert pairs[0] == (H_FIRST, OBJ_A5), f"브로커가 pan/fly 하는 대상이 갈렸다: {pairs}"
    picked = next(x for x in rows if x["global_id"] == OBJ_A5)
    assert picked["entity_handle"] == H_FIRST and picked["confidence"] == pytest.approx(0.55), picked
