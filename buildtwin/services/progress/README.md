# services/progress

- 담당 에이전트: `progress-engine`
- 입출력 계약: 공정표(CSV/XML/XER) → `Activity[]`; `StateTransition` 상태기계(ADR 0001, actor·evidence 필수); `ReadinessScore{score, components, blockers}`; 3중 검증 → `ReviewRequest`; CP-SAT → 착수 가능 Activity 집합
