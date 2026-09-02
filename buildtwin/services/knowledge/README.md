# services/knowledge

- 담당 에이전트: `knowledge`
- 입출력 계약: `rules/*.yaml` + 입력 컨텍스트 → `RuleVerdict[]{rule_id, risk_level, action, required_evidence, confidence, evidence}`; `ExpertReviewLog` 미들웨어(proposal vs final diff)
