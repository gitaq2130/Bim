"""스캔 정합·판정 설정 로더. 모든 임계값은 `config/scan.yaml`(settings.config_dir)에서 온다 — 코드에 숫자 리터럴 금지.

담당: reality-capture. 필드에 기본값을 두지 않는다(누락 시 즉시 ValidationError) — 임계값이 코드에 숨는 것을 막기 위함.
"""
from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field

from packages.core.settings import settings

SCAN_CONFIG_FILENAME = "scan.yaml"


class RegistrationConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    max_rmse: float = Field(gt=0)            # m. 초과 시 registration_failed
    voxel_size: float = Field(gt=0)          # m. 다운샘플 복셀
    icp_max_distance: float = Field(gt=0)    # m. ICP 대응점 최대 거리
    icp_max_iterations: int = Field(ge=1)
    min_fitness: float = Field(ge=0, le=1)   # 대응점 비율 하한

    @property
    def reference_spacing(self) -> float:
        """BIM 표면 참조 점군 간격(m). ICP 대응 거리의 절반 — 대응 거리 안에 항상 참조점이 있도록."""
        return self.icp_max_distance / 2.0


class VerdictConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    bbox_margin: float = Field(ge=0)               # m. 객체 bbox 여유
    surface_distance: float = Field(gt=0)          # m. 표면 일치 허용 거리
    min_density_not_built: float = Field(ge=0)     # points/m². 미만이면 NOT_BUILT
    density_in_progress: float = Field(ge=0)       # points/m²
    density_done: float = Field(gt=0)              # points/m²
    min_surface_match_done: float = Field(ge=0, le=1)
    mismatch_offset: float = Field(gt=0)           # m. 초과 offset이면 MISMATCH
    occlusion_unverifiable: float = Field(ge=0, le=1)
    confidence_floor: float = Field(ge=0, le=1)

    # ---- 파생값(독립 임계값이 아니라 위 값들의 조합) -------------------------------------------
    @property
    def coverage_not_built(self) -> float:
        """표면 확인율(coverage) 기준 NOT_BUILT 상한. 밀도 축의 '미시공/시공중 경계'(min_density_not_built)를 시공중 기준
        밀도(density_in_progress)에 대한 비율로 환산해 표면 확인율 축에 적용한다. 인접 객체·바닥 점이 만드는 체계적 오염(수 %)보다
        높고, 실제 부분 시공(수십 %)보다 낮은 값이 된다."""
        ref = self.density_in_progress if self.density_in_progress > 0 else self.density_done
        return min(1.0, self.min_density_not_built / ref)

    @property
    def interface_margin(self) -> float:
        """접합부 판정 여유(m). 다른 객체 bbox 에서 이 거리 안의 표면 셀은 그 객체의 (노이즈 포함) 표면 점으로 확인될 수 있으므로
        어느 객체의 증거로도 세지 않는다 = 확인 반경(mismatch_offset) + 표면 노이즈 허용(surface_distance)."""
        return self.mismatch_offset + self.surface_distance

    @property
    def mismatch_search_range(self) -> float:
        """위치불일치 탐색 범위(m). 허용 offset의 2배까지 XY로 bbox를 이동시켜 본다."""
        return 2.0 * self.mismatch_offset

    @property
    def search_margin(self) -> float:
        """객체가 실제로 존재할 수 있는 창(bbox 확장량, m) = 여유 + 탐색 범위. 가림 계산에서 '자기 점'을 제외하는 범위이기도 하다."""
        return self.bbox_margin + self.mismatch_search_range


class ScanConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    registration: RegistrationConfig
    verdict: VerdictConfig


def scan_config_path(config_dir: str | Path | None = None) -> Path:
    return Path(config_dir or settings.config_dir) / SCAN_CONFIG_FILENAME


def load_scan_config(path: str | Path | None = None) -> ScanConfig:
    """`config/scan.yaml` → ScanConfig. path 미지정 시 settings.config_dir(=.env/CONFIG_DIR)에서 읽는다."""
    p = Path(path) if path else scan_config_path()
    if not p.exists():
        raise FileNotFoundError(f"scan config not found: {p}")
    with open(p, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    return ScanConfig.model_validate(raw)


__all__ = ["RegistrationConfig", "ScanConfig", "VerdictConfig", "load_scan_config", "scan_config_path"]
