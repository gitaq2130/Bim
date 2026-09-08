# tests/fixtures

- 담당 에이전트: `qa`
- 예정 파일: `sample.ifc`(+`.expected.json`), `sample.dxf`(+`.expected.json`, `mapping.expected.json`), `sample.ply`/`sample.e57`(+`verdict.expected.json`, `alignment.json`), `schedule.{csv,xml,xer}`(+`schedule.expected.json`)
- 대용량 파일은 git에 넣지 않고 `make fixtures`(`scripts/fetch_fixtures.py`)로 받는다. 합성 스크립트는 `gen/`에 두고 seed를 고정한다.
