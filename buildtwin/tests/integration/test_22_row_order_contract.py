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

## 20칸 — **변이 2 × 축 2 × 자리 5**. 초판의 한 칸이 N=1 이었고 요약이 그 위에 서 있었다

초판(`cac4559`)은 A5 삭제·postgres 를 `1 failed`(**N=1**)로 적고 *"18칸이 죽고 두 칸이 안 죽는다"* 로
요약했는데, **architect 재현(2/5)과 리뷰어 재현(2/9)이 그 칸을 반증했다.** 아래는 이 파일의
소유자가 **다시 잰** 값이고 **칸마다 N 이 붙어 있다** — 「N=1 로 잰 칸을 표에 두지 않는 것」이 이
재측정의 요구다.

**잰 자리.** 포트 **55441** 의 임시 클러스터(`initdb -A trust`, `PostgreSQL 16.13
(Ubuntu 16.13-0ubuntu0.24.04.1)`, `autovacuum=on`, 측정이 끝나고 반납했다). 코드 트리는
`f4758f0`↔`1532c69` 사이에서 **`docs/` 만 달랐다**(어떤 테스트도 그 문서를 import 하지 않는다).
**N 의 단위는 pytest 세션**이고(세션마다 새 스키마/새 임시 DB + 새 커넥션 — ADR 0015 §2-1 이
*"같은 세-술어 문장이 세션마다 다른 btree 를 고른다"* 를 잰 그 단위), 명령은 **두 축 모두**
`pytest -q tests/integration` 이다 — **초판 표의 sqlite 칸은 루트 `pytest -q` 였으므로 그 칸의
`1 failed, 837 passed` 와 아래 값은 같은 명령이 아니다.** 기준선은 두 축 모두 **222 passed**
(postgres 는 `tests_on_postgres=187 floor=187 engines=1`).
*역방향 변이* = 그 `order_by` 의 컬럼마다 `.desc()`. *삭제 변이* = 그 `order_by(...)` 를 지운다.
변이는 **한 자리씩** 적용 → `git diff` 로 적용 확인(무력 변이 방지) → 측정 → 원복 → 루트
`git status --porcelain` 확인. 도구는 전부 저장소 밖이다.

| 자리 | 역방향 · sqlite | 역방향 · pg | 삭제 · sqlite | 삭제 · pg |
|---|---|---|---|---|
| A1 `project_drawings` | **4/4** | **4/4** | **4/4** | **4/4** |
| A2 `entity_mappings_for_object` | **4/4** | **4/4** | **4/4** | **4/4** |
| A3 `progress…load_mappings` | **4/4**(`2 failed`) | **4/4**(`2 failed`) | **10/10**(`2 failed`) | **세션 의존 — 6/10** |
| A4 `model_objects` | **4/4** | **4/4** | **4/4** | **4/4** |
| A5 `sync…load_mappings` | **4/4** | **4/4** | **0/10 — 안 죽는다** | **세션 의존 — 2/20** |

**역방향 10칸은 전부 죽는다**(칸마다 N=4). **삭제 10칸은 셋으로 갈린다** — 결정적으로 죽는 것
**일곱**(A1·A2·A4 의 두 축 여섯 **+ A3·sqlite**), **세션 의존 둘**(A3·pg 6/10 · A5·pg 2/20),
안정적으로 안 죽는 것 **하나**(A5·sqlite 0/10).
**초판의 "18 + 2" 가 거짓인 이유는 둘이다**: ① A5·pg 를 N=1 값으로 「죽는다」 쪽에 넣었고
② **「죽는다 / 안 죽는다」는 이분법 자체가 세션 의존 칸을 담지 못한다** — 그 칸은 두 상자 어디에도
들어가지 않는다.

**네 관측자 대조**(같은 코드 트리, 서로 다른 포트·클러스터. 값 뒤가 그 관측자의 N 이다):

| 칸 | qa 초판(55441) | architect(55442) | reviewer(55443) | **qa 재측정(55441)** |
|---|---|---|---|---|
| A3 삭제 · pg | 5/10 | 4/10 | 5/9 | **6/10** |
| A5 삭제 · sqlite | 0/10 | 0/5 | 0/4 | **0/10** |
| A3 삭제 · sqlite | `2 failed`(**N=1**) | 2/2 | 4/4 | **10/10** |
| A5 삭제 · pg | `1 failed`(**N=1**) | 2/5 | 2/9 | **2/20** |

**부정 단정 둘(0/10 · 세션 의존)은 네 관측자에서 재현되고**, N=1 이었던 두 칸은 재측정에서 성질이
갈렸다 — A3·sqlite 는 **결정적으로 죽고**, A5·pg 는 **세션 의존이다.**
*재지 않은 것*: 네 값의 비율 차이가 유의한지는 검정하지 않았다(클러스터·포트가 다르다).
이 표가 기대는 것은 비율이 아니라 **「그 칸이 한 값으로 고정되지 않는다」** 하나다.

## 안 죽는 칸에 이름 붙이기 — **그 칸이 관측된 통합 세션 안에서** 쟀다

ADR 0016 §3 2 의 게이트는 *"안 죽는 칸은 `EXPLAIN`(sqlite 는 `EXPLAIN QUERY PLAN`)으로 왜 안 죽는지
이름 붙여 적는다 — 이름 붙이지 못한 칸은 재지 않은 것"* 이다. **초판이 붙인 이름은 저장소 밖
2~3행 탐침의 것이었고, 그 탐침은 통합 세션의 실측을 틀리게 예측한다:**

| 자리 | 저장소 밖 탐침(2~3행, 세션 12회) | 그 이름이 예측하는 것 | **통합 세션 실측(이 라운드)** |
|---|---|---|---|
| A3 · pg | `Index Scan … _pkey` **12/12** | *"안 죽는다"* | pkey **4/10** · `ix_…_project_id` **6/10** → **6/10 죽음** |
| A5 · pg | `Bitmap Heap Scan` **12/12** | *"언제나 죽는다"* | pkey **18/20** · `Bitmap Heap Scan` **2/20** → **2/20 죽음** |

**그러므로 「이름」은 그 칸이 관측된 세션 안에서 잡았을 때만 이름이다.** 저장소 밖 탐침이 붙인 이름은
**그 세션의 계획 분포를 대표하지 않으므로**, 정정 상자 자신이 금지한 「이름으로 면제」와 구별되지
않는다. 아래가 그 게이트를 만족시키는 형태다.

**세션 안 계획 ↔ 그 세션의 사망 여부.** 계측은 저장소 밖 pytest 플러그인이다 —
`after_cursor_execute` 에서 **그 세션의 같은 커넥션**에 `EXPLAIN` 과 같은 문장을 한 번 더 쏘고
(둘 다 읽기 전용), 그 세션의 테스트 결과와 짝짓는다. **커밋하지 않았다**(측정 뒤 원복하고 루트
`git status --porcelain` 으로 확인했다).

| 자리 · 축 | 세션 안 **무정렬** 계획 | 무정렬 첫 행 | 그 세션 | 세션 수 |
|---|---|---|---|---|
| A3 · pg | `Index Scan using activity_object_mappings_pkey` | `ORD-A100` (= 정답) | **산다** | 4 |
| A3 · pg | `Index Scan using ix_activity_object_mappings_project_id` | `ORD-A900` | **죽는다**(2 failed) | 6 |
| A5 · pg | `Index Scan using entity_object_mappings_pkey` | `H-aaa/ORD-OBJ-A5` (= 정답) | **산다** | 18 |
| A5 · pg | `Bitmap Heap Scan on entity_object_mappings` | `H-zzz/ORD-OBJ-A5` | **죽는다**(1 failed) | 2 |
| A3 · sqlite | `SEARCH … USING INDEX ix_activity_object_mappings_project_id (project_id=?)` | `ORD-A900` | **죽는다**(2 failed) | 4 |
| A5 · sqlite | `SEARCH … USING INDEX sqlite_autoindex_entity_object_mappings_1 (drawing_id=?)` | `H-aaa/ORD-OBJ-A5` (= 정답) | **산다** | 4 |

**38 세션 38/38 에서 세션 안 계획이 그 세션의 결과를 완전히 예측한다 — 「같은 계획인데 결과가 갈린」
세션은 0 이다.** 그래서 이 게이트는 **세션 안에서 재는 한** 작동한다. 다만 그것이 요구하는 이름은
**칸마다 하나가 아니라 계획마다 하나**다 — 「안 죽는 칸」 안에도 죽는 계획이 섞여 있고, 칸을 하나의
이름으로 부르는 순간 그 섞임이 사라진다.
- **투영이 계획을 바꾼다**(리뷰어 관측, 이 표가 그것을 피하는 방식). 저장소 밖 탐침을 2컬럼으로 쏘면
  A3·sqlite 가 `COVERING INDEX …` 라 *"안 죽는다"* 를 예측한다. 위 표는 **ORM 이 실제로 쏘는 문장
  그대로**를 `EXPLAIN` 에 넘기므로 그 갈래가 없다.
- **재지 않은 것 — 무엇이 세션마다 계획을 뒤집는가.** 행 수는 세션마다 같다(같은 픽스처). 통계 수집
  타이밍·autovacuum 을 의심할 뿐 **태우지 않았다.** 관측 하나만 적는다: 두 병렬 스트림에서 **같은
  회차 번호**의 세션이 함께 죽었다(A3 은 2·3·4회차, A5 는 5회차) — 시간에 걸린 클러스터 단위 요인을
  시사하지만 이 파일은 그것을 재지 않았다.
- **재지 않은 것 — 정렬이 있을 때의 계획.** 위 표는 전부 **무정렬**(삭제 변이) 쪽이다.

**그리고 그 이름은 정렬을 지울 근거가 아니라 정렬이 있어야 하는 근거다**(ADR 0016 §2-3 정정 상자):
「산다」 행의 계획이 다음 세션에도 뽑힌다는 보장이 없다는 것을, 바로 위 표의 「죽는다」 행이 값으로
보인다.

- **왜 그 계획에서 안 죽는가 — 붙인 정렬 키가 「필터를 뺀 PK 나머지」와 같기 때문이다.**
  ADR 0016 결정 2 가 A3·A5 의 키를 **결정성의 축**(PK 또는 PK 접두사)으로 골랐다: 플래너가 **PK
  인덱스를 걷는 계획**을 고르면 `ORDER BY` 가 없어도 결과가 이미 그 순서다(위 표의 「산다」 행 넷).
- **초판의 전칭 부정은 거짓이다** — *"어떤 픽스처도 이 두 칸을 죽일 수 없다 … 갈리게 하려면 정렬 키를
  PK 나머지가 아닌 것으로 바꾸는 수밖에 없다"*. 근거 셋:
  ① **같은 문단이 이미 반박했다.** 초판의 세 줄 위가 *"통합 세션에서는 행 수·통계가 달라 계획이
  갈린다"* 라고 적는다 — **행 수를 정하는 것이 곧 픽스처다.**
  ② ADR 0016 §4 는 *"§후속 16 이 행 수를 키울 때 그 값이 올라가야 한다"* 라고 적고, §6 대안 8
  (*"행을 늘려 플래너가 계획을 바꾸게 만든다"*)을 **불가능이 아니라 다른 근거로** 기각한다
  (회귀가 플래너의 계획에 고정되는 것 = ADR 0015 결정 1 이 금지한 것의 다른 얼굴).
  ③ **이 라운드의 실측이 직접 보인다** — 같은 픽스처·같은 행 수에서도 A5·pg 가 **20세션 중 2세션에서
  죽었다.** 「죽일 수 없다」가 아니라 「이 행 수에서는 대부분의 세션이 그 계획을 고른다」다.
  **그래서 한정어를 붙인다: 이 픽스처의 행 수·통계에서, 이 두 칸은 대부분의 세션에서 죽지 않는다.**
  그 칸을 죽게 만드는 길은 정렬 키 교체 **하나가 아니다** — 행 수를 키워 플래너의 선택을 바꾸는 길이
  있고, **이 파일은 그 길을 재지 않았다**(그 자리는 ADR 0016 §Deferred 8 과 계획 0012 §후속 16 이다).
- **그래서 이 두 자리에서 계약을 실제로 붙드는 것은 역방향 변이 쪽이다** — A3·A5 모두 두 축에서
  **4/4** 죽는다. 역방향은 엔진이 어떤 계획을 고르든 **다른 답을 강제**하기 때문이다
  (ADR 0016 §2-3 정정 상자: *"역방향 변이가 안 죽으면 그 회귀가 장식이다"*).

## 배역 (한 프로젝트를 다섯 자리가 나눠 쓴다)

| 자리 | 무엇을 태우는가 | 소비자(고르는 한 원소) |
|---|---|---|
| A1 `queries.project_drawings` | 도면 넷(`ord-drawing-a` < `-m` < `-x` < `-z`) | `GET /projects/{id}/drawings` 의 `[0]` — `apps/web/src/pages/ViewerPage.tsx` 의 `list[0]` 폴백 |
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
    """A5 — `GET /drawings/{id}/mappings` 의 `[0]`(브로커의 `panTo(handles[0])`)와
    `find(x => x.global_id === g)`(선택 바 칩의 confidence 배지)가 고르는 행.

    **초판은 여기에 `flyTo(globalIds[0])` 도 적었다 — 그것은 순서 소비자가 아니다.** 그 줄은
    `pushTo3d` 의 `single` 가드 안이고 `globalIds.length === 0` 은 그 앞에서 조기 return 하므로
    **그 줄이 도는 순간 길이가 언제나 1** 이다(ADR 0016 §2-1 역방향 확인 — `apps/web/src/sync/broker.ts`
    의 `pushTo3d`·`single`). 이 테스트가 실제로 붙드는 것은 `panTo` 와 `find` 둘이다.
    """
    r = client.get(f"/api/drawings/{D_A5}/mappings", headers=auth("cm"))
    assert r.status_code == 200, r.text
    rows = r.json()
    pairs = [(x["entity_handle"], x["global_id"]) for x in rows]
    assert sorted(pairs) == [(H_FIRST, OBJ_A5), (H_FIRST, OBJ_A5B), (H_LAST, OBJ_A5)], pairs   # 음성 대조군
    assert pairs[0] == (H_FIRST, OBJ_A5), f"브로커가 pan/fly 하는 대상이 갈렸다: {pairs}"
    picked = next(x for x in rows if x["global_id"] == OBJ_A5)
    assert picked["entity_handle"] == H_FIRST and picked["confidence"] == pytest.approx(0.55), picked
