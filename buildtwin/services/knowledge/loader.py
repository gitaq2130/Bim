"""규칙 로더 — `rules/risk/*.yaml`을 읽어 `list[Rule]`로 검증한다."""
from __future__ import annotations

from pathlib import Path

import yaml

from packages.core.models.knowledge import Rule
from services.common.safe_expr import UnsafeExpressionError, validate

__all__ = ["RuleLoadError", "load_rules", "default_rules_dir", "ALLOWED_DISCIPLINES", "check_discipline"]

# docs/glossary.md "공종(discipline)" 허용값. `mep`는 쓰지 않는다(mechanical / electrical로 나눈다).
ALLOWED_DISCIPLINES: frozenset[str] = frozenset({"structure", "architecture", "mechanical", "electrical", "civil", "finishing"})


def check_discipline(value: str | None, where: str) -> None:
    """discipline이 glossary 허용값이 아니면 RuleLoadError."""
    if value is not None and value not in ALLOWED_DISCIPLINES:
        raise RuleLoadError(f"{where}: discipline {value!r} not in {sorted(ALLOWED_DISCIPLINES)}")


class RuleLoadError(ValueError):
    """규칙 파일 스키마/조건식/중복 id 오류."""


def default_rules_dir() -> Path:
    """`settings.rules_dir`(.env의 RULES_DIR) 기준. settings 로딩 실패 시 저장소 루트/rules."""
    try:
        from packages.core.settings import settings

        return Path(settings.rules_dir)
    except Exception:  # pragma: no cover - pydantic-settings 미설치 등
        return Path(__file__).resolve().parents[2] / "rules"


def _load_file(path: Path) -> list[Rule]:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or []
    if not isinstance(data, list):
        raise RuleLoadError(f"{path}: top-level must be a list of rules")
    rules: list[Rule] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            raise RuleLoadError(f"{path}[{i}]: rule must be a mapping")
        try:
            rule = Rule.model_validate(item)
        except Exception as e:
            raise RuleLoadError(f"{path}[{i}] ({item.get('id', '?')}): {e}") from e
        check_discipline(rule.scope.discipline, f"{path} rule {rule.id}")
        try:
            validate(rule.when)
        except UnsafeExpressionError as e:
            raise RuleLoadError(f"{path} rule {rule.id}: unsafe `when`: {e}") from e
        rules.append(rule)
    return rules


def load_rules(rules_dir: str | Path | None = None) -> list[Rule]:
    """`<rules_dir>/risk/*.yaml` 전부 로드. 파일명 정렬 순서. 중복 id는 오류."""
    base = Path(rules_dir) if rules_dir is not None else default_rules_dir()
    risk_dir = base / "risk" if base.name != "risk" else base
    if not risk_dir.is_dir():
        raise RuleLoadError(f"rules directory not found: {risk_dir}")
    rules: list[Rule] = []
    seen: dict[str, Path] = {}
    for path in sorted(risk_dir.glob("*.yaml")) + sorted(risk_dir.glob("*.yml")):
        for rule in _load_file(path):
            if rule.id in seen:
                raise RuleLoadError(f"duplicate rule id {rule.id}: {seen[rule.id]} and {path}")
            seen[rule.id] = path
            rules.append(rule)
    return rules
