# config/

- `readiness.yaml` — Work Readiness Score 가중치 (담당: `progress-engine`)
- `scan.yaml` — 정합 RMSE 임계값, 점 밀도·형상 일치율·offset 임계값, 가림 비율 임계값 (담당: `reality-capture`)
- 코드에 숫자 리터럴로 두지 않고 이 파일들에서 읽는다. 시크릿은 여기 두지 않는다(`.env`만).
