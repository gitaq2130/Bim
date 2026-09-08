"""3단계 매핑: ① 좌표계 변환 → ② 층 일치 + bbox 겹침(IoU) → ③ 레이어/블록 규칙. 담당: sync-2d3d.

confidence = clamp(geo_weight·geo_score + rule_weight·rule_norm), rule_norm: weight>0 → 0.5+0.5·w, 0 → 0.5, 음수 → 0.
needs_review 는 confidence < review_threshold(core 계약 0.7)일 때 자동.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.base import BaseGeometry

from packages.core.models import BBox2D, BBox3D, BimObjectDraft, DrawingEntityDraft, EntityObjectMapping, Evidence

from .config import SyncConfig, load_sync_config
from .rules import LayerMappingRules, layer_rule_match, load_layer_rules, match_any
from .transform import DrawingAlignment, alignment_to_transform, transform_points_2d

_POLYGON_DXFTYPES = ("HATCH", "SOLID", "3DFACE", "TRACE")
_MAX_EVIDENCE_POINTS = 16


@dataclass
class _Candidate:
    obj: BimObjectDraft
    box2d: BBox2D
    geom: BaseGeometry


@dataclass
class EntityGeometry:
    kind: str                     # polygon | line | circle | bbox | point
    geom: BaseGeometry            # 모델 좌표(m), 면적 > 0
    points: np.ndarray            # 변환된 점 (N,2)
    bbox: BBox2D


def is_skipped_entity(entity: DrawingEntityDraft, cfg: SyncConfig, rules: LayerMappingRules) -> bool:
    """그리드/주석/텍스트 엔티티는 매핑 대상이 아니다."""
    if entity.dxftype.upper() in {t.upper() for t in cfg.skip_dxftypes}:
        return True
    if rules.is_grid_layer(entity.layer) or match_any(entity.layer, cfg.skip_layers):
        return True
    return bool(entity.text) and not entity.points and entity.bbox is None


def typical_member_width(objects: list[BimObjectDraft]) -> float | None:
    """후보 객체 bbox의 짧은 수평변 중앙값 — 선형 엔티티 버퍼 폭의 근거(하드코딩 m 금지)."""
    ws = [min(o.bbox.size[0], o.bbox.size[1]) for o in objects if o.bbox is not None]
    ws = [w for w in ws if w > 0]
    return float(np.median(ws)) if ws else None


def _is_closed(entity: DrawingEntityDraft, pts: np.ndarray) -> bool:
    if entity.dxftype.upper() in _POLYGON_DXFTYPES or bool(entity.attrs.get("closed")):
        return True
    return len(pts) >= 4 and bool(np.allclose(pts[0], pts[-1]))


def _bbox_of(pts: np.ndarray) -> BBox2D:
    return BBox2D(min=(float(pts[:, 0].min()), float(pts[:, 1].min())), max=(float(pts[:, 0].max()), float(pts[:, 1].max())))


def entity_geometry(entity: DrawingEntityDraft, alignment: DrawingAlignment, buffer_m: float) -> EntityGeometry | None:
    """엔티티를 모델 좌표계의 면 기하로 바꾼다. 선/점은 buffer_m 만큼 부풀린다."""
    transform = alignment_to_transform(alignment)
    raw: list[tuple[float, float]] = list(entity.points)
    if not raw and entity.insert_point is not None:
        raw = [entity.insert_point]
    if not raw and entity.bbox is not None:
        b = entity.bbox
        raw = [(b.min[0], b.min[1]), (b.max[0], b.min[1]), (b.max[0], b.max[1]), (b.min[0], b.max[1])]
    if not raw:
        return None
    pts = transform_points_2d(transform, raw)
    if not np.all(np.isfinite(pts)):
        return None

    geom: BaseGeometry | None = None
    kind = "point"
    if entity.radius is not None and entity.radius > 0:
        geom, kind = Point(pts[0]).buffer(entity.radius * alignment.scale), "circle"
    elif len(pts) >= 3 and _is_closed(entity, pts):
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.area > 0:
            geom, kind = poly, "polygon"
    if geom is None and len(pts) >= 2:
        line = LineString(pts)
        if line.length > 0:
            geom, kind = line.buffer(buffer_m, cap_style="flat"), "line"
    if geom is None and len(pts) == 1 and entity.bbox is not None and entity.bbox.area() > 0:
        b = entity.bbox
        corners = transform_points_2d(transform, [(b.min[0], b.min[1]), (b.max[0], b.min[1]),
                                                  (b.max[0], b.max[1]), (b.min[0], b.max[1])])
        geom, kind, pts = Polygon(corners), "bbox", corners
    if geom is None:
        geom, kind = Point(pts[0]).buffer(buffer_m), "point"
    if geom.is_empty or geom.area <= 0:
        return None
    return EntityGeometry(kind=kind, geom=geom, points=pts, bbox=_bbox_of(pts))


def geo_iou(a: BaseGeometry, b: BaseGeometry) -> float:
    inter = a.intersection(b).area
    union = a.area + b.area - inter
    return float(inter / union) if union > 0 else 0.0


def rule_score_norm(score: float) -> float:
    if score > 0:
        return 0.5 + 0.5 * min(score, 1.0)
    return 0.5 if score == 0 else 0.0


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def build_mappings(drawing_id: str, entities: list[DrawingEntityDraft], objects: list[BimObjectDraft],
                   alignment: DrawingAlignment, level: str | None = None, cfg: SyncConfig | None = None,
                   rules: LayerMappingRules | None = None, file_uri: str | None = None) -> list[EntityObjectMapping]:
    """엔티티별로 가장 그럴듯한 객체 하나를 고른다. 기하 점수가 floor 미만이면 매핑하지 않는다."""
    cfg = cfg or load_sync_config()
    rules = rules or load_layer_rules()
    pool = [o for o in objects if o.bbox is not None and (level is None or o.level == level)]
    if not pool:
        return []
    width = typical_member_width(pool)
    if width is None:
        return []
    buffer_m = cfg.line_buffer_ratio * width
    cands = [_Candidate(obj=o, box2d=o.bbox.to_2d(), geom=box(*o.bbox.to_2d().min, *o.bbox.to_2d().max)) for o in pool if o.bbox]
    stage1 = "grid_align" if alignment.source == "grid_auto_align" else "user_align"

    out: list[EntityObjectMapping] = []
    for e in entities:
        if is_skipped_entity(e, cfg, rules):
            continue
        eg = entity_geometry(e, alignment, buffer_m)
        if eg is None:
            continue
        scored: list[tuple[float, float, float, _Candidate, str | None]] = []
        for c in cands:
            if not c.box2d.intersects(eg.bbox):
                continue
            geo = geo_iou(eg.geom, c.geom)
            if geo < cfg.min_geo_score:
                continue
            rm = layer_rule_match(e.layer, e.block_name, c.obj.ifc_type, rules, cfg.rule_mismatch_penalty)
            conf = _clamp01(cfg.geo_weight * geo + cfg.rule_weight * rule_score_norm(rm.score))
            scored.append((conf, geo, rm.score, c, rm.rule_id))
        if not scored:
            continue
        conf, geo, rscore, best, rule_id = max(scored, key=lambda s: (s[0], s[1]))
        stages = [stage1, "bbox_iou"] + (["layer_rule"] if rscore != 0 else [])
        ev = Evidence(
            source_type="mapping", source_id=drawing_id, file_uri=file_uri, bbox=best.obj.bbox,
            coordinates=[(float(x), float(y), 0.0) for x, y in eg.points[:_MAX_EVIDENCE_POINTS]],
            rule_id=rule_id, method="|".join(stages),
            extra={"iou": round(geo, 6), "rule_score": rscore, "transform_source": alignment.source,
                   "entity_kind": eg.kind, "entity_layer": e.layer, "ifc_type": best.obj.ifc_type,
                   "level": best.obj.level, "candidate_count": len(scored), "buffer_m": round(buffer_m, 6),
                   "entity_bbox_model": {"min": eg.bbox.min, "max": eg.bbox.max}},
        )
        out.append(EntityObjectMapping(drawing_id=drawing_id, entity_handle=e.handle, global_id=best.obj.global_id,
                                       confidence=conf, evidence=ev, needs_review=conf < cfg.review_threshold))
    return out


def entity_bbox_model(entity: DrawingEntityDraft, alignment: DrawingAlignment) -> BBox3D | None:
    """엔티티의 모델 좌표 bbox(z=0) — API/뷰어 오버레이용 보조."""
    eg = entity_geometry(entity, alignment, buffer_m=math.ulp(1.0))
    if eg is None:
        return None
    return BBox3D(min=(eg.bbox.min[0], eg.bbox.min[1], 0.0), max=(eg.bbox.max[0], eg.bbox.max[1], 0.0))
