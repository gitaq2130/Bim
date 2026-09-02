"""DXF 파서 — ezdxf 기반. 담당: bim-ingest.

modelspace 엔티티를 DrawingEntityDraft로 추출한다. 레이어·블록 이름은 원문 그대로 보존한다(sync-2d3d 규칙 매핑용).
좌표는 도면 원본 단위 그대로 두고, `$INSUNITS`→미터 스케일을 CoordinateSystem.scale에 기록한다.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import ezdxf
import ezdxf.bbox
from ezdxf.math import Vec3

from packages.core.models import BBox2D, BBox3D, CoordinateSystem, DrawingEntityDraft, IngestResult, IngestWarning
from packages.core.models.ingest import IngestStatus

from .config import dxf_flatten_distance_m

# $INSUNITS 코드 → (단위명, 1단위당 미터). DXF 사양(DXF Reference, HEADER $INSUNITS) 기준 정의값.
INSUNITS_TO_METERS: dict[int, tuple[str, float]] = {
    1: ("in", 0.0254),
    2: ("ft", 0.3048),
    3: ("mi", 1609.344),
    4: ("mm", 0.001),
    5: ("cm", 0.01),
    6: ("m", 1.0),
    7: ("km", 1000.0),
    8: ("microinch", 0.0254e-6),
    9: ("mil", 0.0254e-3),
    10: ("yd", 0.9144),
    11: ("angstrom", 1e-10),
    12: ("nm", 1e-9),
    13: ("um", 1e-6),
    14: ("dm", 0.1),
    15: ("dam", 10.0),
    16: ("hm", 100.0),
    17: ("Gm", 1e9),
}
SUPPORTED_DXFTYPES = ("LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "INSERT", "TEXT", "MTEXT", "HATCH", "SPLINE")
_EXT_SENTINEL = 1e19         # ezdxf가 미설정 $EXTMIN/$EXTMAX에 두는 ±1e20 감지용


def _xy(p: Any) -> tuple[float, float]:
    v = Vec3(p)
    return (float(v.x), float(v.y))


def _bbox_from_points(points: list[tuple[float, float]]) -> BBox2D | None:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return BBox2D(min=(min(xs), min(ys)), max=(max(xs), max(ys)))


def _entity_bbox(entity: Any) -> BBox2D | None:
    """블록 참조처럼 자체 정점이 없는 엔티티는 ezdxf.bbox로 실제 범위를 구한다."""
    try:
        ext = ezdxf.bbox.extents([entity], fast=True)
    except Exception:  # noqa: BLE001
        return None
    if not ext.has_data:
        return None
    return BBox2D(min=(float(ext.extmin.x), float(ext.extmin.y)), max=(float(ext.extmax.x), float(ext.extmax.y)))


def _hatch_points(entity: Any) -> tuple[list[tuple[float, float]], dict[str, Any]]:
    points: list[tuple[float, float]] = []
    path_count = 0
    for path in entity.paths:
        path_count += 1
        if hasattr(path, "vertices"):            # PolylinePath
            points.extend(_xy(v) for v in path.vertices)
        elif hasattr(path, "edges"):             # EdgePath
            for edge in path.edges:
                if hasattr(edge, "start") and hasattr(edge, "end"):
                    points.append(_xy(edge.start))
                    points.append(_xy(edge.end))
                elif hasattr(edge, "center"):
                    c, r = Vec3(edge.center), float(getattr(edge, "radius", 0.0))
                    points.extend([(c.x - r, c.y - r), (c.x + r, c.y + r)])
                elif hasattr(edge, "control_points"):
                    points.extend(_xy(p) for p in edge.control_points)
    attrs = {"pattern_name": getattr(entity.dxf, "pattern_name", None), "path_count": path_count, "solid_fill": bool(getattr(entity.dxf, "solid_fill", 0))}
    return points, attrs


def resolve_insunits(insunits: int) -> tuple[str, float] | None:
    """$INSUNITS 코드 → (단위명, 1단위당 m). 모르면 None."""
    return INSUNITS_TO_METERS.get(insunits)


def flatten_distance_in_drawing_units(unit_scale: float, flatten_distance_m: float | None = None) -> float:
    """config/ingest.yaml 의 flatten_distance_m(m) 을 도면 단위로 환산. mm 도면(0.001)과 m 도면(1.0)이 같은 정밀도로 평탄화된다."""
    tol_m = dxf_flatten_distance_m() if flatten_distance_m is None else float(flatten_distance_m)
    if unit_scale <= 0:
        raise ValueError(f"unit_scale must be positive, got {unit_scale}")
    return tol_m / unit_scale


def _extract(entity: Any, flatten_distance: float) -> DrawingEntityDraft | None:
    dxftype = entity.dxftype()
    if dxftype not in SUPPORTED_DXFTYPES:
        return None
    d = entity.dxf
    draft = DrawingEntityDraft(handle=d.handle, layer=d.layer, dxftype=dxftype)
    attrs: dict[str, Any] = {}
    if getattr(d, "color", None) is not None:
        attrs["color"] = int(d.color)
    if getattr(d, "linetype", None):
        attrs["linetype"] = d.linetype

    if dxftype == "LINE":
        draft.points = [_xy(d.start), _xy(d.end)]
    elif dxftype == "LWPOLYLINE":
        draft.points = [(float(x), float(y)) for x, y in entity.get_points(format="xy")]
        attrs["closed"] = bool(entity.closed)
        attrs["const_width"] = float(getattr(d, "const_width", 0.0) or 0.0)
    elif dxftype == "POLYLINE":
        draft.points = [_xy(v.dxf.location) for v in entity.vertices]
        attrs["closed"] = bool(entity.is_closed)
        attrs["is_3d"] = bool(entity.is_3d_polyline)
    elif dxftype == "CIRCLE":
        c = _xy(d.center)
        r = float(d.radius)
        draft.points = [c]
        draft.radius = r
        draft.bbox = BBox2D(min=(c[0] - r, c[1] - r), max=(c[0] + r, c[1] + r))
    elif dxftype == "ARC":
        c = _xy(d.center)
        draft.points = [c] + [_xy(p) for p in entity.flattening(flatten_distance)]
        draft.radius = float(d.radius)
        attrs["start_angle"] = float(d.start_angle)
        attrs["end_angle"] = float(d.end_angle)
        draft.bbox = _bbox_from_points(draft.points[1:])
    elif dxftype == "INSERT":
        ins = _xy(d.insert)
        draft.block_name = d.name
        draft.insert_point = ins
        draft.rotation_deg = float(getattr(d, "rotation", 0.0) or 0.0)
        draft.scale = (float(getattr(d, "xscale", 1.0) or 1.0), float(getattr(d, "yscale", 1.0) or 1.0))
        draft.points = [ins]
        draft.bbox = _entity_bbox(entity) or _bbox_from_points(draft.points)
        attrs["attribs"] = {a.dxf.tag: a.dxf.text for a in getattr(entity, "attribs", [])}
    elif dxftype == "TEXT":
        ins = _xy(d.insert)
        draft.text = entity.dxf.text
        draft.insert_point = ins
        draft.rotation_deg = float(getattr(d, "rotation", 0.0) or 0.0)
        draft.points = [ins]
        attrs["height"] = float(getattr(d, "height", 0.0) or 0.0)
        draft.bbox = _entity_bbox(entity) or _bbox_from_points(draft.points)
    elif dxftype == "MTEXT":
        ins = _xy(d.insert)
        draft.text = entity.plain_text()
        draft.insert_point = ins
        draft.rotation_deg = float(getattr(d, "rotation", 0.0) or 0.0)
        draft.points = [ins]
        attrs["char_height"] = float(getattr(d, "char_height", 0.0) or 0.0)
        attrs["width"] = float(getattr(d, "width", 0.0) or 0.0)
        draft.bbox = _entity_bbox(entity) or _bbox_from_points(draft.points)
    elif dxftype == "HATCH":
        draft.points, hatch_attrs = _hatch_points(entity)
        attrs.update(hatch_attrs)
    elif dxftype == "SPLINE":
        draft.points = [_xy(p) for p in entity.flattening(flatten_distance)]
        attrs["degree"] = int(getattr(d, "degree", 0) or 0)
        attrs["closed"] = bool(entity.closed)

    if draft.bbox is None:
        draft.bbox = _bbox_from_points(draft.points)
    draft.attrs = attrs
    return draft


def _header_extent(doc: ezdxf.document.Drawing) -> BBox3D | None:
    try:
        lo, hi = Vec3(doc.header.get("$EXTMIN")), Vec3(doc.header.get("$EXTMAX"))
    except Exception:  # noqa: BLE001
        return None
    vals = (lo.x, lo.y, lo.z, hi.x, hi.y, hi.z)
    if any(abs(v) >= _EXT_SENTINEL for v in vals) or lo.x > hi.x or lo.y > hi.y:
        return None
    return BBox3D(min=(float(lo.x), float(lo.y), float(lo.z)), max=(float(hi.x), float(hi.y), float(hi.z)))


def parse_dxf(path: str | Path, flatten_distance_m: float | None = None) -> IngestResult:
    """DXF 파일 → IngestResult(entities=[DrawingEntityDraft...]). flatten_distance_m 미지정 시 config/ingest.yaml."""
    path = Path(path)
    warnings: list[IngestWarning] = []
    try:
        doc = ezdxf.readfile(str(path))
    except Exception as exc:  # noqa: BLE001
        return IngestResult(
            status="failed", source_kind="dxf",
            warnings=[IngestWarning(code="DXF_OPEN_FAILED", message=f"DXF 파일을 열 수 없습니다: {exc}", context={"path": str(path)})],
            coordinate_system=CoordinateSystem(source="dxf_local", notes="file open failed"),
        )

    # 단위: $INSUNITS. 알 수 없으면 경고 + scale 1.0(항등) 유지 — 실제 값은 사용자 입력으로 보정한다.
    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    unit_info = resolve_insunits(insunits)
    if unit_info is None:
        unit_name, scale = "unknown", 1.0
        warnings.append(IngestWarning(
            code="DXF_UNIT_UNKNOWN",
            message=f"$INSUNITS={insunits}은(는) 해석할 수 없는 단위입니다. scale=1.0으로 두었으니 사용자 확인이 필요합니다.",
            context={"insunits": insunits},
        ))
    else:
        unit_name, scale = unit_info
    flatten_distance = flatten_distance_in_drawing_units(scale, flatten_distance_m)

    msp = doc.modelspace()
    entities: list[DrawingEntityDraft] = []
    by_layer: Counter[str] = Counter()
    by_type: Counter[str] = Counter()
    skipped: Counter[str] = Counter()
    for entity in msp:
        try:
            draft = _extract(entity, flatten_distance)
        except Exception as exc:  # noqa: BLE001 — 개별 엔티티 오류는 건너뛰고 기록
            warnings.append(IngestWarning(code="DXF_ENTITY_FAILED", message=str(exc), context={"handle": entity.dxf.handle, "dxftype": entity.dxftype()}))
            continue
        if draft is None:
            skipped[entity.dxftype()] += 1
            continue
        entities.append(draft)
        by_layer[draft.layer] += 1
        by_type[draft.dxftype] += 1

    stats: dict[str, int] = {"entities_total": len(entities)}
    stats.update({f"layer:{k}": v for k, v in by_layer.items()})
    stats.update({f"dxftype:{k}": v for k, v in by_type.items()})
    if skipped:
        stats.update({f"skipped:{k}": v for k, v in skipped.items()})
        warnings.append(IngestWarning(
            code="DXF_UNSUPPORTED_ENTITIES",
            message=f"지원하지 않는 엔티티 {sum(skipped.values())}개를 건너뛰었습니다.",
            context=dict(skipped),
        ))

    extent = _header_extent(doc)
    extent_note = "extent_source=header($EXTMIN/$EXTMAX)"
    if extent is None:
        try:
            ext = ezdxf.bbox.extents(msp, fast=True)
            if ext.has_data:
                extent = BBox3D(min=(float(ext.extmin.x), float(ext.extmin.y), float(ext.extmin.z)),
                                max=(float(ext.extmax.x), float(ext.extmax.y), float(ext.extmax.z)))
        except Exception:  # noqa: BLE001
            extent = None
        extent_note = "extent_source=computed(modelspace)" if extent is not None else "extent_source=none"

    coordinate_system = CoordinateSystem(
        source="dxf_local", scale=scale, unit=unit_name, extent=extent,
        notes=f"dxfversion={doc.dxfversion}; insunits={insunits}; flatten_distance_units={flatten_distance:g}; {extent_note}; origin/rotation to model frame must come from user input or grid alignment",
    )
    status: IngestStatus = "ok" if entities else "failed"
    if entities and any(w.code == "DXF_ENTITY_FAILED" for w in warnings):
        status = "partial"
    return IngestResult(status=status, source_kind="dxf", entities=entities, warnings=warnings,
                        coordinate_system=coordinate_system, stats=stats)
