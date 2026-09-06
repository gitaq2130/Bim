# ADR 0003 — 기하·바운딩박스 저장: JSON 우선, PostGIS는 Deferred

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-02

## Context
CLAUDE.md §1 기본 스택은 PostgreSQL + PostGIS다. MVP 단계에서는 (a) 로컬 개발·CI에서 SQLite로 돌아가야 하고 (b) 공간 쿼리는 "층 필터 + 바운딩박스 IoU" 수준이며 객체 수는 수만 개 이하다.

## Decision
- `bim_objects.bbox`, `drawing_entities.bbox`, `evidence` 등 기하 요약은 **JSON 컬럼**에 저장한다(`packages/core/models/orm.py`). SQLite·PostgreSQL에서 동일하게 동작한다.
- 메시 원본은 DB에 넣지 않는다. ingest가 모델당 하나의 JSON 메시 번들(`{global_id: {vertices, faces}}`)과 OBJ를 저장소(로컬 `storage/` 또는 MinIO)에 쓰고 `bim_objects.mesh_ref = "<bundle_uri>#<global_id>"`로 참조한다. 3D 뷰어는 이 번들을 직접 로드한다(XKT 변환기 불필요).
- 공간 필터는 Python(numpy/shapely) 측에서 수행한다.

## Deferred
- 객체 수 10만 이상 또는 반경 검색·교차 쿼리가 필요해지면 PostGIS `geometry(POLYGONZ)` 컬럼과 GiST 인덱스를 추가하는 마이그레이션 ADR을 쓴다. JSON bbox는 그대로 두고 파생 컬럼으로 채운다.
