"""설정 스왑 시 판정이 바뀌는지(임계값이 코드가 아니라 config/scan.yaml 에서 온다는 증거) + 로더 경로."""
from __future__ import annotations

import numpy as np
import pytest
import yaml
from pydantic import ValidationError

from packages.core import settings as settings_module
from packages.core.models.scan import ScanState
from services.scan.config import load_scan_config, scan_config_path
from services.scan.verdict import judge_objects


def _box_surface_points(bmin, bmax, density, rng, height_fraction=1.0):
    bmin, bmax = np.asarray(bmin, float), np.asarray(bmax, float)
    bmax = bmax.copy()
    bmax[2] = bmin[2] + (bmax[2] - bmin[2]) * height_fraction
    size = bmax - bmin
    pts = []
    for ax in range(3):
        u, v = [i for i in range(3) if i != ax]
        n = max(1, int(size[u] * size[v] * density))
        for val in (bmin[ax], bmax[ax]):
            p = np.zeros((n, 3))
            p[:, ax] = val
            p[:, u] = rng.uniform(bmin[u], bmax[u], n)
            p[:, v] = rng.uniform(bmin[v], bmax[v], n)
            pts.append(p)
    return np.vstack(pts)


@pytest.fixture
def swapped_config_dir(tmp_path, monkeypatch):
    def _make(**overrides):
        raw = yaml.safe_load(scan_config_path().read_text(encoding="utf-8"))
        for section, values in overrides.items():
            raw[section].update(values)
        (tmp_path / "scan.yaml").write_text(yaml.safe_dump(raw), encoding="utf-8")
        monkeypatch.setattr(settings_module.settings, "config_dir", str(tmp_path))
        return load_scan_config()
    return _make


def test_loader_reads_from_settings_config_dir(swapped_config_dir):
    base = load_scan_config()
    swapped = swapped_config_dir(registration={"max_rmse": base.registration.max_rmse * 10})
    assert swapped.registration.max_rmse == pytest.approx(base.registration.max_rmse * 10)
    assert scan_config_path().name == "scan.yaml"


def test_thresholds_change_verdict(swapped_config_dir):
    base = load_scan_config()
    rng = np.random.default_rng(7)
    bbox = {"min": [0, 0, 0], "max": [0.6, 0.6, 3.0]}
    dense = _box_surface_points(bbox["min"], bbox["max"], base.verdict.density_done * 2, rng)
    obj = [{"global_id": "OBJ", "bbox": bbox, "ifc_type": "IfcColumn"}]

    assert judge_objects(dense, obj, base, scan_id="s").verdicts[0].state == ScanState.ESTIMATED_DONE
    # 완료 밀도 기준을 훨씬 올리면 같은 점군이 IN_PROGRESS 로
    stricter = swapped_config_dir(verdict={"density_done": base.verdict.density_done * 10,
                                           "density_in_progress": base.verdict.density_done * 5})
    assert judge_objects(dense, obj, stricter, scan_id="s").verdicts[0].state == ScanState.IN_PROGRESS
    # 미시공 기준을 올리면 NOT_BUILT 로
    not_built = swapped_config_dir(verdict={"min_density_not_built": base.verdict.density_done * 100})
    assert judge_objects(dense, obj, not_built, scan_id="s").verdicts[0].state == ScanState.NOT_BUILT


def test_half_height_is_in_progress_and_offset_is_mismatch(cfg):
    rng = np.random.default_rng(3)
    bbox = {"min": [0, 0, 0], "max": [0.6, 0.6, 3.0]}
    obj = [{"global_id": "OBJ", "bbox": bbox}]
    half = _box_surface_points(bbox["min"], bbox["max"], cfg.verdict.density_done * 2, rng, height_fraction=0.4)
    assert judge_objects(half, obj, cfg, scan_id="s").verdicts[0].state == ScanState.IN_PROGRESS
    shift = cfg.verdict.mismatch_offset * 1.6
    moved = _box_surface_points(bbox["min"], bbox["max"], cfg.verdict.density_done * 2, rng) + [shift, 0, 0]
    v = judge_objects(moved, obj, cfg, scan_id="s").verdicts[0]
    assert v.state == ScanState.MISMATCH
    assert abs(v.evidence.extra["offset_vector"][0] - shift) < cfg.verdict.surface_distance
    empty = np.zeros((0, 3))
    assert judge_objects(empty, obj, cfg, scan_id="s").verdicts[0].state == ScanState.NOT_BUILT


def test_missing_config_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(settings_module.settings, "config_dir", str(tmp_path))
    with pytest.raises(FileNotFoundError):
        load_scan_config()


def test_derived_values_follow_yaml_ratios(swapped_config_dir):
    """reference_spacing 과 mismatch_search_range 는 코드 상수가 아니라 yaml 의 비율·배수에서 나온다."""
    base = load_scan_config()
    assert base.registration.reference_spacing == pytest.approx(
        base.registration.icp_max_distance * base.registration.reference_spacing_ratio)
    assert base.verdict.mismatch_search_range == pytest.approx(
        base.verdict.mismatch_offset * base.verdict.mismatch_search_multiplier)
    assert base.verdict.search_margin == pytest.approx(base.verdict.bbox_margin + base.verdict.mismatch_search_range)

    swapped = swapped_config_dir(registration={"reference_spacing_ratio": base.registration.reference_spacing_ratio * 3},
                                 verdict={"mismatch_search_multiplier": base.verdict.mismatch_search_multiplier * 4})
    assert swapped.registration.reference_spacing == pytest.approx(base.registration.reference_spacing * 3)
    assert swapped.verdict.mismatch_search_range == pytest.approx(base.verdict.mismatch_search_range * 4)
    assert swapped.verdict.search_margin == pytest.approx(base.verdict.bbox_margin + base.verdict.mismatch_search_range * 4)


def test_ratio_keys_are_required(tmp_path, monkeypatch):
    """코드 기본값이 없으므로 yaml 에서 키가 빠지면 로드가 실패해야 한다."""
    raw = yaml.safe_load(scan_config_path().read_text(encoding="utf-8"))
    del raw["registration"]["reference_spacing_ratio"]
    del raw["verdict"]["mismatch_search_multiplier"]
    (tmp_path / "scan.yaml").write_text(yaml.safe_dump(raw), encoding="utf-8")
    monkeypatch.setattr(settings_module.settings, "config_dir", str(tmp_path))
    with pytest.raises(ValidationError):
        load_scan_config()
