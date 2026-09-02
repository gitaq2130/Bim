from __future__ import annotations

import numpy as np
import pytest

from packages.core.models import BBox3D, BimObjectDraft
from services.sync.plan_section import level_elevation, plan_section_from_objects

from .helpers import load_ifc_objects


@pytest.fixture(scope="module")
def objects():
    return load_ifc_objects()


def test_plan_section_1f_has_six_column_outlines(objects):
    sec = plan_section_from_objects(objects, "1F", elevation_offset=1.2)
    assert sec["level"] == "1F" and sec["elevation"] == 0.0 and sec["cut_elevation"] == pytest.approx(1.2)
    cols = [p for p in sec["polylines"] if p["ifc_type"] == "IfcColumn"]
    assert len(cols) == 6
    assert all(len(p["points"]) == 5 and p["points"][0] == p["points"][-1] for p in cols)
    assert all(p["level"] == "1F" for p in sec["polylines"])
    c11_id = next(o.global_id for o in objects if o.name == "C1-11")
    c11 = next(p for p in cols if p["global_id"] == c11_id)
    assert np.allclose(c11["points"][:4], [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], atol=1e-9)
    # 보(z 3.3~3.8)는 1.2m 단면에 없고, 3.5m 단면에는 있다
    assert not [p for p in sec["polylines"] if p["ifc_type"] == "IfcBeam"]
    high = plan_section_from_objects(objects, "1F", elevation_offset=3.5)
    assert len([p for p in high["polylines"] if p["ifc_type"] == "IfcBeam"]) == 8


def test_plan_section_default_offset_and_fallback_elevation(objects):
    sec = plan_section_from_objects(objects, "1F")          # config 기본 offset
    assert sec["cut_elevation"] is not None and sec["polylines"]
    objs = [BimObjectDraft(global_id="g", ifc_type="IfcWall", level="L", bbox=BBox3D(min=(0, 0, 10), max=(1, 1, 13)))]
    assert level_elevation(objs, "L") == 10.0                # level_elevation 없으면 bbox 최소 z
    assert plan_section_from_objects(objs, "L", 1.0)["polylines"][0]["global_id"] == "g"
    assert plan_section_from_objects(objs, "L", 5.0)["polylines"] == []
    assert plan_section_from_objects(objs, "NOPE", 1.0)["polylines"] == []
