"""reality-capture 픽스처 로더(unit·regression 공용). alignment.json / verdict.expected.json / sample.ifc 1F 객체 bbox."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from packages.core.models.scan import AlignmentInput

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
SAMPLE_IFC = FIXTURES / "sample.ifc"
SAMPLE_PLY = FIXTURES / "sample.ply"
# 픽스처 생성기(make_fixtures.py)의 1F 기둥 치수: COL×COL×(STOREY_H-SLAB_T). bbox 가 깨지면 판정 테스트 전체가 무의미하다.
COLUMN_SIZE_1F = (0.6, 0.6, 3.8)


def load_alignment() -> AlignmentInput:
    return AlignmentInput.model_validate(json.loads((FIXTURES / "alignment.json").read_text()))


def load_expected_verdicts() -> dict:
    return json.loads((FIXTURES / "verdict.expected.json").read_text())


def load_ifc_objects_1f(expected: dict, path: Path = SAMPLE_IFC) -> list[dict]:
    """sample.ifc 를 ifcopenshell.geom(월드 좌표)으로 열어 기대 판정 대상(1F) 객체의 AABB 를 만든다."""
    import ifcopenshell
    import ifcopenshell.geom

    f = ifcopenshell.open(str(path))
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
    for o in out:
        if o["ifc_type"] == "IfcColumn":
            size = np.array(o["bbox"]["max"]) - np.array(o["bbox"]["min"])
            assert np.allclose(size, COLUMN_SIZE_1F, atol=1e-6), (o["name"], size)
    return out


def verdict_accuracy(verdicts, expected_verdicts: dict[str, str]) -> tuple[float, int, int]:
    """(정확도, 맞춘 수, 기대 수). 기대 global_id 집합과 판정 집합이 같아야 한다."""
    got = {v.global_id: v.state.value for v in verdicts}
    assert set(got) == set(expected_verdicts), set(got) ^ set(expected_verdicts)
    hits = sum(got[g] == expected_verdicts[g] for g in expected_verdicts)
    return hits / len(expected_verdicts), hits, len(expected_verdicts)
