"""reality-capture 테스트 공용 픽스처: 설정, 기준점, sample.ifc 1F 객체 bbox(ifcopenshell 월드 좌표), 기대 판정."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from packages.core.models.scan import AlignmentInput
from services.scan.config import ScanConfig, load_scan_config

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture(scope="session")
def cfg() -> ScanConfig:
    return load_scan_config()


@pytest.fixture(scope="session")
def alignment() -> AlignmentInput:
    return AlignmentInput.model_validate(json.loads((FIXTURES / "alignment.json").read_text()))


@pytest.fixture(scope="session")
def expected() -> dict:
    return json.loads((FIXTURES / "verdict.expected.json").read_text())


@pytest.fixture(scope="session")
def ifc_objects_1f(expected) -> list[dict]:
    """sample.ifc 를 ifcopenshell.geom(월드 좌표)으로 열어 기대 판정 대상(1F) 객체의 AABB 를 만든다."""
    import ifcopenshell
    import ifcopenshell.geom

    f = ifcopenshell.open(str(FIXTURES / "sample.ifc"))
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    wanted = set(expected["verdicts"])
    out = []
    for el in f.by_type("IfcProduct"):
        if el.GlobalId not in wanted or not el.Representation:
            continue
        shape = ifcopenshell.geom.create_shape(settings, el)   # shape 객체를 살려둔 채 verts 를 복사(버퍼 use-after-free 방지)
        verts = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
        del shape
        out.append({"global_id": el.GlobalId, "ifc_type": el.is_a(), "name": el.Name,
                    "bbox": {"min": verts.min(axis=0).tolist(), "max": verts.max(axis=0).tolist()}})
    assert len(out) == len(wanted)
    # 기하 sanity: 1F 기둥은 0.6×0.6×3.8 (기둥 bbox 가 깨지면 판정 테스트 전체가 무의미)
    for o in out:
        if o["ifc_type"] == "IfcColumn":
            size = np.array(o["bbox"]["max"]) - np.array(o["bbox"]["min"])
            assert np.allclose(size, [0.6, 0.6, 3.8], atol=1e-6), (o["name"], size)
    return out


@pytest.fixture(scope="session")
def scan_ply() -> Path:
    return FIXTURES / "sample.ply"
