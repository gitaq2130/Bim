# config/

- `readiness.yaml` — Work Readiness Score 가중치·착수 임계값·기본 구성값·차단 심각도 (담당: `progress-engine`)
- `resources.yaml` — 착수 가능 집합(CP-SAT) 자원 한도 (담당: `progress-engine`)
- `wbs_mapping.yaml` — WBS 코드 → IFC 타입/공종/층 표 (담당: `progress-engine`, 선택)
- `activity_mapping.yaml` — Activity↔객체 매핑 규칙 가중치, 작업명 키워드, 층/구역 정규화 패턴 (담당: `progress-engine`)
- `scan.yaml` — 정합 RMSE 임계값, 점 밀도·형상 일치율·offset 임계값, 가림 비율 임계값 (담당: `reality-capture`)
- 코드에 숫자 리터럴로 두지 않고 이 파일들에서 읽는다. 시크릿은 여기 두지 않는다(`.env`만).
- 읽기 경로는 `settings.config_dir`(기본 `<repo>/config`). 해당 경로에 파일이 없으면 저장소 기본 파일로 폴백한다.
