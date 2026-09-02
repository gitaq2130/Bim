# services/api

- 담당 에이전트: `api`
- 입출력 계약: HTTP 요청 → 서비스 호출 → Pydantic 응답. 업로드 → `job_id` → `GET /jobs/{id}` 폴링. `GET /objects/{global_id}` → `ObjectDetail{basic, current_state, history, next_actions}`
