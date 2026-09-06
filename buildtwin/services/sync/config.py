"""sync 설정 로더 — config/sync.yaml. 임계값은 코드에 숫자 리터럴로 두지 않는다. 담당: sync-2d3d."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from packages.core.models.mapping import MAPPING_REVIEW_THRESHOLD
from packages.core.settings import ROOT, settings

CONFIG_FILENAME = "sync.yaml"


class SyncConfig(BaseModel):
    """config/sync.yaml 스키마. 모든 값은 파일에서 온다(기본값 없음)."""
    min_geo_score: float = Field(ge=0.0, le=1.0)
    line_buffer_ratio: float = Field(gt=0.0)
    geo_weight: float = Field(ge=0.0)
    rule_weight: float = Field(ge=0.0)
    rule_mismatch_penalty: float = Field(le=0.0)
    skip_dxftypes: list[str]
    skip_layers: list[str]
    grid_angle_tolerance_deg: float = Field(gt=0.0)
    grid_orthogonality_tolerance_deg: float = Field(gt=0.0)
    grid_min_intersections: int = Field(ge=2)
    grid_inlier_ratio: float = Field(gt=0.0)
    grid_max_hypothesis_pairs: int = Field(ge=1)
    grid_column_cluster_ratio: float = Field(gt=0.0)
    plan_section_default_offset: float

    @property
    def review_threshold(self) -> float:
        """계약값 — packages.core.models.mapping.MAPPING_REVIEW_THRESHOLD 단일 소스. yaml 에 두지 않는다."""
        return MAPPING_REVIEW_THRESHOLD


def config_path(path: str | Path | None = None) -> Path:
    """settings.config_dir/sync.yaml, 없으면 저장소 기본 config/sync.yaml."""
    if path is not None:
        return Path(path)
    p = Path(settings.config_dir) / CONFIG_FILENAME
    return p if p.exists() else ROOT / "config" / CONFIG_FILENAME


@lru_cache(maxsize=8)
def _load(path_str: str) -> SyncConfig:
    with open(path_str, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    # review_threshold 는 core 계약값. yaml 에 있으면 같은 값인지만 검증하고(다르면 실패) 필드로는 받지 않는다.
    if "review_threshold" in data:
        value = data.pop("review_threshold")
        if float(value) != MAPPING_REVIEW_THRESHOLD:
            raise ValueError(
                f"{path_str}: review_threshold={value} conflicts with core MAPPING_REVIEW_THRESHOLD={MAPPING_REVIEW_THRESHOLD}; "
                "remove the key — the contract value lives in packages/core/models/mapping.py")
    return SyncConfig.model_validate(data)


def load_sync_config(path: str | Path | None = None) -> SyncConfig:
    return _load(str(config_path(path).resolve()))
