"""안전 불변식 config 검증(과제 3, `services/progress/config_loader.UnsafeConfigOverrideError`) — 담당: qa.

네 키는 코드가 읽어서 분기하지 않는 "문서화용" 값이다 — 값을 바꿔도 조용히 아무 일도 일어나지 않는 것이
가장 위험하므로 로딩 시점에 검사해 위험한 값이면 요란하게 실패한다:

- `document_approval.use_confirmed_mappings_only` (True 만) — readiness.yaml
- `document_approval.scoring` (`"all_or_nothing"` 만) — readiness.yaml
- `title_matching.auto_confirm` (False 만) — document_register.yaml
- `mapping.always_needs_review` (True 만) — document_register.yaml

각각 위험한 값이면 실패하고, 키가 아예 없으면(하위 호환) 통과해야 한다. 실제 config/ 파일은 건드리지
않는다 — `settings.config_dir` 를 임시 디렉터리로 돌려 로더가 그 파일을 우선 찾게 한다(`config_path()`:
override 디렉터리에 파일이 있으면 그것을, 없으면 기본 `config/` 로 폴백).
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from packages.core.settings import settings
from services.progress.config_loader import (
    UnsafeConfigOverrideError,
    load_config,
    load_document_register_config,
    load_readiness_config,
)


@pytest.fixture
def isolated_config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """settings.config_dir 를 빈 임시 디렉터리로 돌린다. 이 디렉터리에 없는 파일은 그대로 기본
    config/ 로 폴백하므로(config_path()), 검사 대상 파일 하나만 이 안에 써 넣으면 된다."""
    monkeypatch.setattr(settings, "config_dir", str(tmp_path))
    return tmp_path


def _write(tmp_path: Path, filename: str, data: dict) -> None:
    (tmp_path / filename).write_text(yaml.safe_dump(data), encoding="utf-8")


# ── readiness.yaml: document_approval.use_confirmed_mappings_only (True 만) ────────────────
def test_use_confirmed_mappings_only_false_is_rejected(isolated_config_dir):
    base = load_config("readiness.yaml")   # 실제 config/readiness.yaml 은 건드리지 않고 값만 베낀다
    bad = {**base, "document_approval": {**base["document_approval"], "use_confirmed_mappings_only": False}}
    _write(isolated_config_dir, "readiness.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="use_confirmed_mappings_only"):
        load_readiness_config()


def test_use_confirmed_mappings_only_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("readiness.yaml")
    without = {**base, "document_approval": {k: v for k, v in base["document_approval"].items()
                                              if k != "use_confirmed_mappings_only"}}
    _write(isolated_config_dir, "readiness.yaml", without)
    cfg = load_readiness_config()   # 예외 없이 통과해야 한다(하위 호환)
    assert "use_confirmed_mappings_only" not in cfg["document_approval"]


# ── readiness.yaml: document_approval.scoring ("all_or_nothing" 만) ────────────────────────
def test_scoring_ratio_is_rejected(isolated_config_dir):
    base = load_config("readiness.yaml")
    bad = {**base, "document_approval": {**base["document_approval"], "scoring": "ratio"}}
    _write(isolated_config_dir, "readiness.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="scoring"):
        load_readiness_config()


def test_scoring_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("readiness.yaml")
    without = {**base, "document_approval": {k: v for k, v in base["document_approval"].items() if k != "scoring"}}
    _write(isolated_config_dir, "readiness.yaml", without)
    cfg = load_readiness_config()
    assert "scoring" not in cfg["document_approval"]


# ── document_register.yaml: title_matching.auto_confirm (False 만) ─────────────────────────
def test_auto_confirm_true_is_rejected(isolated_config_dir):
    base = load_config("document_register.yaml")
    bad = {**base, "title_matching": {**base["title_matching"], "auto_confirm": True}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="auto_confirm"):
        load_document_register_config()


def test_auto_confirm_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("document_register.yaml")
    without = {**base, "title_matching": {k: v for k, v in base["title_matching"].items() if k != "auto_confirm"}}
    _write(isolated_config_dir, "document_register.yaml", without)
    cfg = load_document_register_config()
    assert "auto_confirm" not in cfg["title_matching"]


# ── document_register.yaml: mapping.always_needs_review (True 만) ──────────────────────────
def test_always_needs_review_false_is_rejected(isolated_config_dir):
    base = load_config("document_register.yaml")
    bad = {**base, "mapping": {**base["mapping"], "always_needs_review": False}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="always_needs_review"):
        load_document_register_config()


def test_always_needs_review_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("document_register.yaml")
    without = {**base, "mapping": {k: v for k, v in base["mapping"].items() if k != "always_needs_review"}}
    _write(isolated_config_dir, "document_register.yaml", without)
    cfg = load_document_register_config()
    assert "always_needs_review" not in cfg["mapping"]
