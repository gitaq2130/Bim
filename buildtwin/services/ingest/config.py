"""config/ingest.yaml 로더. settings.config_dir 우선, 없으면 저장소 기본 config/ 로 폴백(다른 서비스와 같은 규약)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from packages.core.settings import ROOT, settings

INGEST_CONFIG_FILENAME = "ingest.yaml"
_DEFAULT_CONFIG_DIR = ROOT / "config"


def config_path(filename: str = INGEST_CONFIG_FILENAME) -> Path:
    primary = Path(settings.config_dir) / filename
    return primary if primary.exists() else _DEFAULT_CONFIG_DIR / filename


@lru_cache(maxsize=4)
def load_ingest_config(path: str | None = None) -> dict[str, Any]:
    p = Path(path) if path else config_path()
    if not p.exists():
        raise FileNotFoundError(f"config file not found: {INGEST_CONFIG_FILENAME} (searched {settings.config_dir}, {_DEFAULT_CONFIG_DIR})")
    with open(p, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"config file {p} must contain a mapping at top level")
    return data


def dxf_flatten_distance_m() -> float:
    """곡선 평탄화 허용 오차(m)."""
    value = (load_ingest_config().get("dxf") or {}).get("flatten_distance_m")
    if value is None:
        raise KeyError("config/ingest.yaml: dxf.flatten_distance_m is required")
    return float(value)
