"""객체별 시공 상태 판정(verdict). 출력은 ScanState 5종(NOT_BUILT/IN_PROGRESS/ESTIMATED_DONE/MISMATCH/UNVERIFIABLE)뿐이다.
'확정'은 이 모듈이 낼 수 없다(ADR 0001 불변식 3) — 사람(CM) 승인은 progress-engine 쪽 상태기계가 담당한다.

담당: reality-capture. 모든 임계값은 cfg(config/scan.yaml)에서 읽는다. 규칙 ID: SCAN-VERDICT-v1.

객체별 지표(모델 좌표 점군 기준):
- point_count / density        : bbox(+margin) 안 점 수, 표면적(m²) 당 밀도
- surface_match_ratio          : 안쪽 점 중 bbox 표면에서 surface_distance 안에 있는 비율(형상 일치율)
- surface_coverage             : bbox 표면 격자 셀 중 mismatch_offset 안에 점이 있는 비율(표면 확인율).
                                 다른 객체의 여유 범위와 겹치는 셀(접합부)은 어느 객체의 증거로도 세지 않는다.
- z_coverage                   : bbox 높이 구간(폭 bbox_margin) 중 점이 있는 비율(시공 높이 비율)
- offset_vector                : XY 이동 탐색(±2·mismatch_offset)으로 찾은, 점군을 가장 잘 설명하는 bbox 이동량
- occlusion_ratio              : occlusion.compute_occlusion 참조

판정 순서: 가림 > NOT_BUILT > MISMATCH > ESTIMATED_DONE > IN_PROGRESS.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
from pydantic import BaseModel
from scipy.spatial import cKDTree

from packages.core.models.coordinate import BBox3D
from packages.core.models.evidence import Evidence
from packages.core.models.identity import BimObjectDraft
from packages.core.models.scan import Registration, ScanState, ScanVerdict, ScanVerdictBatch

from .config import ScanConfig
from .diff import VOLUME_KEY, compute_diff
from .geometry import bbox_arrays, bbox_surface_area, distance_to_surface, points_inside, sample_faces
from .occlusion import OcclusionResult, compute_occlusion

RULE_ID = "SCAN-VERDICT-v1"
METHOD = "bbox_density+surface_match+coverage+shift_search+raycast_occlusion"


class ObjectSpec(BaseModel):
    """판정 입력 객체(모델 좌표 bbox). dict / BimObjectDraft 에서 normalize_objects 로 만든다."""
    global_id: str
    bbox: BBox3D
    ifc_type: str | None = None


def normalize_objects(objects: Iterable[Any]) -> list[ObjectSpec]:
    out: list[ObjectSpec] = []
    for o in objects:
        if isinstance(o, ObjectSpec):
            out.append(o)
        elif isinstance(o, BimObjectDraft):
            if o.bbox is None:
                raise ValueError(f"object {o.global_id} has no bbox")
            out.append(ObjectSpec(global_id=o.global_id, bbox=o.bbox, ifc_type=o.ifc_type))
        elif isinstance(o, Mapping):
            bbox = o["bbox"]
            bbox = bbox if isinstance(bbox, BBox3D) else BBox3D.model_validate(bbox)
            out.append(ObjectSpec(global_id=str(o["global_id"]), bbox=bbox, ifc_type=o.get("ifc_type")))
        else:
            raise TypeError(f"unsupported object spec: {type(o)!r}")
    return out


# ------------------------------------------------------------------ 지표
@dataclass
class ObjectMetrics:
    point_count: int = 0
    surface_area: float = 0.0
    density: float = 0.0
    surface_match_ratio: float = 0.0
    surface_coverage: float = 0.0
    z_coverage: float = 0.0
    occupied_volume: float = 0.0
    offset_vector: tuple[float, float, float] = (0.0, 0.0, 0.0)
    offset_norm: float = 0.0
    shifted_point_count: int = 0
    shifted_surface_match_ratio: float = 0.0
    shifted_surface_coverage: float = 0.0
    shift_searched: bool = False
    occlusion_ratio: float = 0.0
    los_blocked_ratio: float = 0.0
    unobserved_ratio: float = 0.0
    occlusion: OcclusionResult | None = field(default=None, repr=False)

    def as_extra(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("occlusion", None)
        d["offset_vector"] = list(self.offset_vector)
        return d


def _ramp(x: float, lo: float, hi: float) -> float:
    """lo→0, hi→1 선형, [0,1] 클립. lo==hi 이면 계단."""
    if hi <= lo:
        return 1.0 if x >= hi else 0.0
    return float(np.clip((x - lo) / (hi - lo), 0.0, 1.0))


def _interface_mask(samples: np.ndarray, others: Sequence[tuple[np.ndarray, np.ndarray]], margin: float) -> np.ndarray:
    """샘플이 다른 객체 bbox(+margin) 안에 있으면 True(접합부 셀)."""
    mask = np.zeros(len(samples), dtype=bool)
    for omin, omax in others:
        mask |= points_inside(samples, omin - margin, omax + margin)
    return mask


def _coverage(bmin: np.ndarray, bmax: np.ndarray, tree: cKDTree | None, cfg: ScanConfig,
              others: Sequence[tuple[np.ndarray, np.ndarray]]) -> float:
    v = cfg.verdict
    samples, _, areas = sample_faces(bmin, bmax, v.mismatch_offset)
    if len(samples) == 0 or tree is None:
        return 0.0
    keep = ~_interface_mask(samples, others, v.bbox_margin)
    if not keep.any():
        return 0.0
    d, _ = tree.query(samples[keep], k=1, distance_upper_bound=v.mismatch_offset)
    w = areas[keep]
    return float(np.sum(w[np.isfinite(d)]) / np.sum(w))


def _match_stats(points: np.ndarray, bmin: np.ndarray, bmax: np.ndarray, cfg: ScanConfig) -> tuple[int, int]:
    """(bbox+margin 안 점 수, 그중 표면 허용치 안 점 수)."""
    v = cfg.verdict
    inside = points_inside(points, bmin - v.bbox_margin, bmax + v.bbox_margin)
    if not inside.any():
        return 0, 0
    d = distance_to_surface(points[inside], bmin, bmax)
    return int(inside.sum()), int(np.sum(d <= v.surface_distance))


def _shift_search(candidates: np.ndarray, bmin: np.ndarray, bmax: np.ndarray, cfg: ScanConfig) -> tuple[np.ndarray, int, int]:
    """XY 이동 격자 탐색: 표면 허용치 안 점 수를 최대로 하는 이동량. 거친 격자(간격 surface_distance) → 미세 격자."""
    v = cfg.verdict
    r = v.mismatch_search_range
    coarse = np.arange(-r, r + v.surface_distance / 2, v.surface_distance)

    def evaluate(dx: float, dy: float) -> tuple[int, int]:
        s = np.array([dx, dy, 0.0])
        return _match_stats(candidates, bmin + s, bmax + s, cfg)

    best = (np.zeros(3), 0, 0)
    for dx in coarse:
        for dy in coarse:
            n_in, n_match = evaluate(dx, dy)
            if n_match > best[2]:
                best = (np.array([dx, dy, 0.0]), n_in, n_match)
    fine_step = v.surface_distance / len(coarse)          # 거친 격자 한 칸을 격자 수만큼 더 나눈다
    fine = np.arange(-v.surface_distance, v.surface_distance + fine_step / 2, fine_step)
    cx, cy = best[0][0], best[0][1]
    for dx in fine:
        for dy in fine:
            n_in, n_match = evaluate(cx + dx, cy + dy)
            if n_match > best[2]:
                best = (np.array([cx + dx, cy + dy, 0.0]), n_in, n_match)
    return best


def compute_metrics(points_model: np.ndarray, spec: ObjectSpec, cfg: ScanConfig, *, tree: cKDTree | None,
                    others: Sequence[tuple[np.ndarray, np.ndarray]], scanner_pos_model: np.ndarray | None,
                    solid_bboxes: Sequence[BBox3D]) -> ObjectMetrics:
    v = cfg.verdict
    bmin, bmax = bbox_arrays(spec.bbox)
    m = ObjectMetrics(surface_area=bbox_surface_area(spec.bbox))
    inside_mask = points_inside(points_model, bmin - v.bbox_margin, bmax + v.bbox_margin)
    inside = points_model[inside_mask]
    m.point_count = int(len(inside))
    m.density = m.point_count / m.surface_area if m.surface_area > 0 else 0.0
    if m.point_count:
        d = distance_to_surface(inside, bmin, bmax)
        m.surface_match_ratio = float(np.mean(d <= v.surface_distance))
        height = bmax[2] - bmin[2]
        nbins = max(1, int(np.ceil(height / v.bbox_margin))) if v.bbox_margin > 0 else 1
        hist, _ = np.histogram(inside[:, 2], bins=nbins, range=(bmin[2], bmax[2] if height > 0 else bmin[2] + v.bbox_margin))
        m.z_coverage = float(np.count_nonzero(hist) / nbins)
        vox = np.unique(np.floor((inside - bmin) / v.bbox_margin).astype(np.int64), axis=0) if v.bbox_margin > 0 else inside
        m.occupied_volume = float(len(vox) * v.bbox_margin ** 3)
    m.surface_coverage = _coverage(bmin, bmax, tree, cfg, others)

    # 위치불일치 탐색: 점은 있는데 표면과 안 맞을 때만(비용 절감 + 정합된 객체는 탐색 불필요)
    if m.density >= v.min_density_not_built and m.surface_match_ratio < v.min_surface_match_done:
        window = points_inside(points_model, bmin - v.search_margin, bmax + v.search_margin)
        cand = points_model[window]
        if len(cand):
            shift, n_in, n_match = _shift_search(cand, bmin, bmax, cfg)
            m.shift_searched = True
            m.offset_vector = tuple(float(x) for x in shift)
            m.offset_norm = float(np.linalg.norm(shift))
            m.shifted_point_count = n_in
            m.shifted_surface_match_ratio = n_match / n_in if n_in else 0.0
            m.shifted_surface_coverage = _coverage(bmin + shift, bmax + shift, tree, cfg, others)

    if scanner_pos_model is not None:
        occ = compute_occlusion(spec.bbox, scanner_pos_model, None, solid_bboxes, cfg, tree=tree)
        m.occlusion = occ
        m.occlusion_ratio = occ.occlusion_ratio
        m.los_blocked_ratio = occ.los_blocked_ratio
        m.unobserved_ratio = occ.unobserved_ratio
    return m


# ------------------------------------------------------------------ 판정
def decide(m: ObjectMetrics, cfg: ScanConfig) -> tuple[ScanState, float, str]:
    """지표 → (상태, confidence, 사유). 임계값은 cfg.verdict 만 사용."""
    v = cfg.verdict
    floor = v.confidence_floor

    def bounded(score: float) -> float:
        return float(np.clip(floor + (1.0 - floor) * float(np.clip(score, 0.0, 1.0)), floor, 1.0))

    occlusion_cap = max(floor, 1.0 - m.occlusion_ratio)

    if m.occlusion_ratio > v.occlusion_unverifiable:
        conf = min(bounded(_ramp(m.occlusion_ratio, v.occlusion_unverifiable, 1.0)), occlusion_cap)
        return ScanState.UNVERIFIABLE, conf, f"occlusion {m.occlusion_ratio:.2f} > {v.occlusion_unverifiable}"

    if m.density < v.min_density_not_built or m.surface_coverage < v.coverage_not_built:
        by_density = 1.0 - _ramp(m.density, 0.0, v.min_density_not_built)
        by_cov = 1.0 - _ramp(m.surface_coverage, 0.0, v.coverage_not_built)
        conf = min(bounded(max(by_density, by_cov)), occlusion_cap)
        return ScanState.NOT_BUILT, conf, (f"density {m.density:.1f}/m² < {v.min_density_not_built} or "
                                           f"coverage {m.surface_coverage:.2f} < {v.coverage_not_built:.2f}")

    # 정렬 상태 지표: 허용 offset 안의 이동이면 이동한 bbox 기준 지표를 쓴다(허용치 내 오차는 일치로 본다)
    match, coverage = m.surface_match_ratio, m.surface_coverage
    if m.shift_searched and m.offset_norm <= v.mismatch_offset:
        match = max(match, m.shifted_surface_match_ratio)
        coverage = max(coverage, m.shifted_surface_coverage)

    if (m.shift_searched and m.offset_norm > v.mismatch_offset
            and m.shifted_surface_match_ratio >= v.min_surface_match_done
            and m.shifted_surface_coverage >= v.coverage_not_built):
        s_off = _ramp(m.offset_norm, v.mismatch_offset, v.mismatch_search_range)
        s_fit = _ramp(m.shifted_surface_match_ratio, v.min_surface_match_done, 1.0)
        conf = min(bounded((s_off + s_fit) / 2.0), occlusion_cap)
        return ScanState.MISMATCH, conf, f"points fit bbox shifted by {m.offset_norm:.3f} m > {v.mismatch_offset}"

    done = (m.density >= v.density_done and match >= v.min_surface_match_done
            and coverage >= v.min_surface_match_done and m.z_coverage >= v.min_surface_match_done)
    if done:
        s_density = _ramp(m.density, v.density_done, v.density_done + (v.density_done - v.density_in_progress))
        s_match = _ramp(match, v.min_surface_match_done, 1.0)
        s_cov = _ramp(coverage, v.min_surface_match_done, 1.0)
        conf = min(bounded((s_density + s_match + s_cov) / 3.0), occlusion_cap)
        return ScanState.ESTIMATED_DONE, conf, (f"density {m.density:.0f}/m² ≥ {v.density_done}, match {match:.2f}, "
                                                f"coverage {coverage:.2f}")

    # IN_PROGRESS: 증거는 있으나 완료 조건 미달. 얼마나 뚜렷이 '미완'인지로 confidence
    s_evidence = _ramp(m.density, v.min_density_not_built, v.density_in_progress)
    s_not_done = max(1.0 - _ramp(m.density, v.density_in_progress, v.density_done),
                     1.0 - _ramp(min(coverage, m.z_coverage), 0.0, v.min_surface_match_done))
    conf = min(bounded(s_evidence * s_not_done), occlusion_cap)
    return ScanState.IN_PROGRESS, conf, (f"density {m.density:.0f}/m², match {match:.2f}, coverage {coverage:.2f}, "
                                         f"z_coverage {m.z_coverage:.2f} — below done thresholds")


def judge_objects(points_model: np.ndarray, objects: Iterable[Any], cfg: ScanConfig, *,
                  scanner_pos_model: Sequence[float] | np.ndarray | None = None,
                  previous: Mapping[str, ScanVerdict] | None = None, scan_id: str = "scan",
                  registration: Registration | None = None, source_file: str | None = None) -> ScanVerdictBatch:
    """모델 좌표 점군 + 객체 bbox 목록 → ScanVerdictBatch. 각 verdict에 confidence·evidence·diff 포함."""
    v = cfg.verdict
    specs = normalize_objects(objects)
    pts = np.asarray(points_model, dtype=float).reshape(-1, 3)
    tree = cKDTree(pts) if len(pts) else None
    scanner = np.asarray(scanner_pos_model, dtype=float).reshape(3) if scanner_pos_model is not None else None
    arrays = [bbox_arrays(s.bbox) for s in specs]

    # 1차: 밀도·일치율만으로 '물리적으로 존재하는(솔리드)' 객체 → 가림 계산의 bbox 차폐물
    solid: list[BBox3D] = []
    for s, (bmin, bmax) in zip(specs, arrays):
        n_in, n_match = _match_stats(pts, bmin, bmax, cfg)
        area = bbox_surface_area(s.bbox)
        if area > 0 and n_in / area >= v.density_done and n_in and n_match / n_in >= v.min_surface_match_done:
            solid.append(s.bbox)

    verdicts: list[ScanVerdict] = []
    stats: dict[str, int] = {st.value: 0 for st in ScanState}
    for i, spec in enumerate(specs):
        others = [a for j, a in enumerate(arrays) if j != i]
        solid_others = [b for b in solid if b is not spec.bbox]
        m = compute_metrics(pts, spec, cfg, tree=tree, others=others, scanner_pos_model=scanner, solid_bboxes=solid_others)
        state, conf, reason = decide(m, cfg)
        extra = m.as_extra()
        extra.update({"rule_id": RULE_ID, "reason": reason, "ifc_type": spec.ifc_type, VOLUME_KEY: m.occupied_volume,
                      "scanner_position_model": [float(x) for x in scanner] if scanner is not None else None})
        evidence = Evidence(source_type="scan", source_id=scan_id, file_uri=source_file, bbox=spec.bbox,
                            rule_id=RULE_ID, method=METHOD, extra=extra)
        verdict = ScanVerdict(scan_id=scan_id, global_id=spec.global_id, state=state, confidence=conf, evidence=evidence)
        prev = previous.get(spec.global_id) if previous else None
        verdict.diff_from_previous = compute_diff(prev, verdict, None, m.density)
        verdicts.append(verdict)
        stats[state.value] += 1

    reg = registration or Registration(scan_id=scan_id, status="ok", method="preregistered",
                                       message="points supplied in model coordinates; no registration performed here")
    stats["total"] = len(verdicts)
    return ScanVerdictBatch(scan_id=scan_id, registration=reg, verdicts=verdicts, bbox_margin=v.bbox_margin, stats=stats)


__all__ = ["METHOD", "RULE_ID", "ObjectMetrics", "ObjectSpec", "compute_metrics", "decide", "judge_objects", "normalize_objects"]
