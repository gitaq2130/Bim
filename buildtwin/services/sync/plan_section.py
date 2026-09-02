"""층별 평면 단면(서버측 bbox 폴백). 담당: sync-2d3d.

뷰어(viewer-3d getPlanSection)가 메시를 정밀하게 자르고, 이 모듈은 2D 오버레이 엔드포인트용으로 객체 bbox 를
레벨 표고 + offset 높이에서 잘라 사각형 외곽선을 만든다.
"""
from __future__ import annotations

from packages.core.models import BimObjectDraft

from .config import SyncConfig, load_sync_config


def level_elevation(objects: list[BimObjectDraft], level: str | None) -> float | None:
    """레벨 표고: 객체의 level_elevation → 없으면 해당 레벨 객체 bbox 최소 z."""
    same = [o for o in objects if level is None or o.level == level]
    for o in same:
        if o.level_elevation is not None:
            return float(o.level_elevation)
    zs = [o.bbox.min[2] for o in same if o.bbox is not None]
    return float(min(zs)) if zs else None


def plan_section_from_objects(objects: list[BimObjectDraft], level: str | None, elevation_offset: float | None = None,
                              cfg: SyncConfig | None = None) -> dict:
    """{level, elevation, cut_elevation, polylines:[{global_id, ifc_type, points:[[x,y],...]}]}."""
    cfg = cfg or load_sync_config()
    offset = cfg.plan_section_default_offset if elevation_offset is None else float(elevation_offset)
    elev = level_elevation(objects, level)
    if elev is None:
        return {"level": level, "elevation": None, "cut_elevation": None, "polylines": []}
    cut = elev + offset
    polylines: list[dict] = []
    for o in objects:
        if o.bbox is None or (level is not None and o.level != level):
            continue
        if not (o.bbox.min[2] <= cut <= o.bbox.max[2]):
            continue
        (x0, y0, _), (x1, y1, _) = o.bbox.min, o.bbox.max
        polylines.append({"global_id": o.global_id, "ifc_type": o.ifc_type, "level": o.level,
                          "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]})
    return {"level": level, "elevation": elev, "cut_elevation": cut, "polylines": polylines}
