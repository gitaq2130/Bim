# ADR 0002 — RVT·DWG 처리 경로

- 상태: Accepted (③ Revit 애드인은 Deferred)
- 작성: architect
- 날짜: 2026-09-02

## Context
RVT는 Revit 없이 서버에서 열 수 없다. DWG는 ODA 라이선스 없이 직접 파싱이 어렵다(CLAUDE.md §0 기술 제약).

## Decision
| 입력 | MVP 경로 | 구현 위치 |
|---|---|---|
| RVT + APS 자격증명 있음 | APS Model Derivative(v2)로 IFC 번역 → `parse_ifc` | `services/ingest/rvt_adapter.py` |
| RVT + 자격증명 없음 | `IngestResult(status="needs_ifc_export")` + Revit→IFC 내보내기 안내(UI 표시) | 동일 |
| DWG + ODA File Converter 경로 설정됨 | DWG→DXF 변환 후 `parse_dxf` | `services/ingest/dwg_adapter.py` |
| DWG + 변환기 없음 | `failed` + "DXF로 다시 업로드" 경고 | 동일 |
| DXF | `ezdxf` 직접 파싱 | `services/ingest/dxf_parser.py` |

RVT 바이너리 직접 파싱 코드는 어떤 경우에도 두지 않는다(`reviewer` 체크).

## Deferred — ③ Revit 애드인(pyRevit/C#)
- 목적: IFC 내보내기 시 손실되는 Revit 파라미터(공정 코드·시공 구역·자재 코드)와 ElementId↔GlobalId 매핑을 함께 내보낸다.
- 형식 초안: `IFC + sidecar JSON {global_id: {element_id, parameters{}}}` → `bim-ingest`가 sidecar를 `psets["Pset_Revit"]`로 병합.
- 조건: 실제 RVT 고객 프로젝트가 생기고 APS 비용/지연이 문제가 될 때 착수.

## Consequences
- RVT 사용자는 첫 업로드에서 안내를 받고 IFC를 다시 올리게 된다. UI 마찰이 있으나 파이프라인이 단순해진다.
- APS 사용 시 번역 대기(수 분)와 과금이 발생한다. `jobs` 폴링으로 노출한다.
