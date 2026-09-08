# services/sync

- 담당 에이전트: `sync-2d3d`
- 입출력 계약: `(drawing_id, model_id, DrawingAlignment?)` → `EntityObjectMapping[]{entity_handle, global_id, confidence, evidence, needs_review}`; 클라이언트 브로커는 뷰어 선택 이벤트 → 반대편 highlight
