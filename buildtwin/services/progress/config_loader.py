"""config/*.yaml 로더. settings.config_dir 우선, 없으면 저장소 기본 config/ 로 폴백. 숫자 상수는 코드에 두지 않는다."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from packages.core.settings import ROOT, settings

_DEFAULT_CONFIG_DIR = ROOT / "config"


def config_path(filename: str) -> Path:
    primary = Path(settings.config_dir) / filename
    if primary.exists():
        return primary
    return _DEFAULT_CONFIG_DIR / filename


def load_config(filename: str, required: bool = True) -> dict[str, Any]:
    path = config_path(filename)
    if not path.exists():
        if required:
            raise FileNotFoundError(f"config file not found: {filename} (searched {settings.config_dir}, {_DEFAULT_CONFIG_DIR})")
        return {}
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"config file {path} must contain a mapping at top level")
    return data


def load_readiness_config() -> dict[str, Any]:
    return load_config("readiness.yaml")


def load_resources_config() -> dict[str, Any]:
    return load_config("resources.yaml", required=False)


def load_activity_mapping_config() -> dict[str, Any]:
    return load_config("activity_mapping.yaml")


def load_wbs_mapping_config() -> dict[str, Any]:
    return load_config("wbs_mapping.yaml", required=False)
