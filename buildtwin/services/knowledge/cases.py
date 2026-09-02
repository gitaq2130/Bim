"""사례 DB — `rules/cases/*.yaml`에 저장된 CaseRecord를 읽고 검색하고 규칙 초안으로 변환한다."""
from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import yaml

from packages.core.models.knowledge import CaseRecord, RiskLevel, Rule, RuleScope, RuleThen
from services.common.safe_expr import validate
from services.knowledge.loader import default_rules_dir

__all__ = ["CaseStore", "to_rule_draft", "CaseLoadError"]


class CaseLoadError(ValueError):
    pass


def _load_file(path: Path) -> list[CaseRecord]:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or []
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise CaseLoadError(f"{path}: top-level must be a list of cases")
    out: list[CaseRecord] = []
    for i, item in enumerate(data):
        try:
            out.append(CaseRecord.model_validate(item))
        except Exception as e:
            raise CaseLoadError(f"{path}[{i}]: {e}") from e
    return out


def _text_blob(case: CaseRecord) -> str:
    parts = [case.situation, case.direct_impact, case.outcome or "", case.project_type, case.discipline]
    parts += case.early_signals + case.cascading_impacts + case.recommended_actions
    return "\n".join(p for p in parts if p).lower()


class CaseStore:
    """YAML 파일 기반 사례 저장소. `add(persist=True)`는 `<cases_dir>/<case_id>.yaml`로 기록한다."""

    def __init__(self, cases_dir: str | Path | None = None, autoload: bool = True) -> None:
        base = Path(cases_dir) if cases_dir is not None else default_rules_dir() / "cases"
        self.cases_dir = base
        self._cases: dict[str, CaseRecord] = {}
        if autoload and base.is_dir():
            self.load()

    def load(self) -> list[CaseRecord]:
        self._cases.clear()
        for path in sorted(self.cases_dir.glob("*.yaml")) + sorted(self.cases_dir.glob("*.yml")):
            for case in _load_file(path):
                if case.case_id in self._cases:
                    raise CaseLoadError(f"duplicate case id {case.case_id} in {path}")
                self._cases[case.case_id] = case
        return list(self._cases.values())

    def all(self) -> list[CaseRecord]:
        return list(self._cases.values())

    def get(self, case_id: str) -> CaseRecord | None:
        return self._cases.get(case_id)

    def add(self, case: CaseRecord, persist: bool = False) -> CaseRecord:
        if case.case_id in self._cases:
            raise CaseLoadError(f"duplicate case id {case.case_id}")
        self._cases[case.case_id] = case
        if persist:
            self.cases_dir.mkdir(parents=True, exist_ok=True)
            path = self.cases_dir / f"{case.case_id}.yaml"
            with path.open("w", encoding="utf-8") as f:
                yaml.safe_dump([case.model_dump(mode="json")], f, allow_unicode=True, sort_keys=False)
        return case

    def find(
        self,
        discipline: str | None = None,
        project_type: str | None = None,
        keywords: Iterable[str] | str | None = None,
    ) -> list[CaseRecord]:
        """discipline/project_type은 정확히(대소문자 무시), keywords는 본문 부분일치(모두 포함)."""
        kws = [keywords] if isinstance(keywords, str) else list(keywords or [])
        kws = [k.lower() for k in kws if k]
        out: list[CaseRecord] = []
        for case in self._cases.values():
            if discipline and case.discipline.lower() != discipline.lower():
                continue
            if project_type and case.project_type.lower() != project_type.lower():
                continue
            if kws:
                blob = _text_blob(case)
                if not all(k in blob for k in kws):
                    continue
            out.append(case)
        return out

    def to_rule_draft(self, case: CaseRecord, **kw) -> Rule:
        return to_rule_draft(case, **kw)


def to_rule_draft(
    case: CaseRecord,
    when: str | None = None,
    risk_level: RiskLevel | str = RiskLevel.MEDIUM,
    object_types: list[str] | None = None,
    required_evidence: list[str] | None = None,
) -> Rule:
    """사례 → 규칙 초안. `source: case`, `source_ref: <case_id>`, reliability는 사례 값을 잇는다.

    `when`을 주지 않으면 progress-engine/사람이 `logic.matched_case_ids`에 사례 id를 넣었을 때만 맞는
    보수적 조건식을 쓴다. 전문가가 조건식을 다듬은 뒤 `rules/risk/`에 올린다.
    """
    expr = when or f"logic.matched_case_ids is not None and '{case.case_id}' in logic.matched_case_ids"
    validate(expr)
    action = "; ".join(case.recommended_actions) or f"사례 {case.case_id} 참조: {case.situation}"
    return Rule(
        id=f"RULE-CASE-{case.case_id}",
        version=1,
        source="case",
        source_ref=case.case_id,
        reliability=case.reliability,
        scope=RuleScope(discipline=case.discipline, object_types=list(object_types or [])),
        when=expr,
        then=RuleThen(
            risk_level=RiskLevel(risk_level),
            action=action,
            required_evidence=list(required_evidence or []),
        ),
        tags=sorted({"case", case.discipline, case.project_type}),
        description=f"[사례 초안] {case.situation} → {case.direct_impact}",
    )
