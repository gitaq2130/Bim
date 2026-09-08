"""sync 테스트 입력 빌더(tests/helpers — unit·regression 공용). 라이브러리 코드는 ingest 에 의존하지 않으므로 여기서 ezdxf/ifcopenshell 로 직접 만든다."""
from __future__ import annotations

import json
from pathlib import Path

import ezdxf
import ezdxf.bbox
import ifcopenshell
import ifcopenshell.geom
import numpy as np
from ezdxf import units as dxf_units

from packages.core.models import TARGET_IFC_TYPES, BBox2D, BBox3D, BimObjectDraft, DrawingEntityDraft
from services.sync.transform import DrawingAlignment

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
SAMPLE_DXF = FIXTURES / "sample.dxf"
SAMPLE_IFC = FIXTURES / "sample.ifc"


def _xy(v) -> tuple[float, float]:
    return float(v.x), float(v.y)


def _bbox2d(pts: list[tuple[float, float]]) -> BBox2D | None:
    if not pts:
        return None
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return BBox2D(min=(min(xs), min(ys)), max=(max(xs), max(ys)))


def load_dxf_entities(path: Path = SAMPLE_DXF) -> tuple[list[DrawingEntityDraft], float]:
    """(entities, unit_scale). LINE/LWPOLYLINE/INSERT/TEXT/CIRCLE 만, 좌표는 원본 단위."""
    doc = ezdxf.readfile(str(path))
    unit_scale = float(dxf_units.conversion_factor(int(doc.header.get("$INSUNITS", 0) or 0), dxf_units.M))
    out: list[DrawingEntityDraft] = []
    for e in doc.modelspace():
        t = e.dxftype()
        d = DrawingEntityDraft(handle=e.dxf.handle, layer=e.dxf.layer, dxftype=t)
        if t == "LINE":
            d.points = [_xy(e.dxf.start), _xy(e.dxf.end)]
        elif t == "LWPOLYLINE":
            d.points = [(float(x), float(y)) for x, y in e.get_points(format="xy")]
            d.attrs = {"closed": bool(e.closed)}
        elif t == "CIRCLE":
            d.points, d.radius = [_xy(e.dxf.center)], float(e.dxf.radius)
        elif t == "INSERT":
            d.block_name, d.insert_point = e.dxf.name, _xy(e.dxf.insert)
            d.points = [d.insert_point]
            ext = ezdxf.bbox.extents([e])
            if ext.has_data:
                d.bbox = BBox2D(min=(float(ext.extmin.x), float(ext.extmin.y)), max=(float(ext.extmax.x), float(ext.extmax.y)))
        elif t in ("TEXT", "MTEXT"):
            d.text, d.insert_point = e.dxf.text if t == "TEXT" else e.plain_text(), _xy(e.dxf.insert)
            d.points = [d.insert_point]
        else:
            continue
        if d.bbox is None:
            d.bbox = _bbox2d(d.points)
        out.append(d)
    return out, unit_scale


def load_ifc_objects(path: Path = SAMPLE_IFC) -> list[BimObjectDraft]:
    """ifcopenshell.geom(USE_WORLD_COORDS) 로 bbox, ContainedInStructure 로 storey."""
    f = ifcopenshell.open(str(path))
    s = ifcopenshell.geom.settings()
    s.set(s.USE_WORLD_COORDS, True)
    out: list[BimObjectDraft] = []
    for p in f.by_type("IfcProduct"):
        if not p.is_a("IfcElement") or p.is_a() not in TARGET_IFC_TYPES or not p.Representation:
            continue
        shape = ifcopenshell.geom.create_shape(s, p)   # 참조를 유지해야 verts 버퍼가 해제되지 않는다
        verts = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
        storey = None
        for rel in getattr(p, "ContainedInStructure", None) or []:
            storey = rel.RelatingStructure
        out.append(BimObjectDraft(
            global_id=p.GlobalId, ifc_type=p.is_a(), name=p.Name,
            level=storey.Name if storey is not None else None,
            level_elevation=float(storey.Elevation) if storey is not None and storey.Elevation is not None else None,
            bbox=BBox3D(min=tuple(map(float, verts.min(axis=0))), max=tuple(map(float, verts.max(axis=0)))),
            express_id=p.id(),
        ))
    return out


def load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def true_alignment() -> DrawingAlignment:
    """픽스처 ground truth(테스트 전용) — sample.dxf.expected.json 의 alignment."""
    a = load_json("sample.dxf.expected.json")["alignment"]
    return DrawingAlignment(origin=tuple(a["origin_m"]), rotation_deg=a["rotation_deg"], scale=a["scale"], source="user_input")


def expected_mappings() -> dict[str, dict]:
    data = load_json("mapping.expected.json")
    return {m["handle"]: m for m in data["mappings"]}


def accuracy(mappings, expected: dict[str, dict], layers: set[str] | None = None) -> tuple[float, int, int]:
    """(정확도, 맞춘 수, 기대 수). 기대 handle 중 global_id 가 일치하는 비율."""
    got = {m.entity_handle: m.global_id for m in mappings}
    keys = [h for h, v in expected.items() if layers is None or v["layer"] in layers]
    hit = sum(1 for h in keys if got.get(h) == expected[h]["global_id"])
    return (hit / len(keys) if keys else 0.0), hit, len(keys)
