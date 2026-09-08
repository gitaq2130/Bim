"""스캔 파이프라인: 로드 → 다운샘플 → 정합 → 모델 좌표 변환 → 객체 판정. 담당: reality-capture."""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

import numpy as np

from packages.core.models.scan import AlignmentInput, ScanState, ScanVerdict, ScanVerdictBatch

from .config import ScanConfig, load_scan_config
from .loader import downsample, load_point_cloud
from .registration import register, sample_reference_from_bboxes
from .verdict import judge_objects, normalize_objects


def run_scan_pipeline(scan_path: str | Path, alignment: AlignmentInput, objects: Iterable[Any], scan_id: str,
                      cfg: ScanConfig | None = None, previous: Mapping[str, ScanVerdict] | None = None) -> ScanVerdictBatch:
    """정합이 ok 가 아니면(needs_alignment_input / registration_failed) 판정을 하지 않고 빈 verdict 배치를 돌려준다."""
    cfg = cfg or load_scan_config()
    specs = normalize_objects(objects)
    cloud = load_point_cloud(scan_path)
    pts = downsample(cloud.points, cfg.registration.voxel_size)

    ref_pts, ref_nrm = sample_reference_from_bboxes([s.bbox for s in specs], 1.0 / cfg.registration.reference_spacing ** 2)
    reg = register(pts, alignment, ref_pts, cfg, scan_id=scan_id, reference_normals=ref_nrm, source_file=cloud.source_path)
    if reg.evidence is not None:
        reg.evidence.extra.update({"raw_point_count": cloud.point_count, "downsampled_point_count": int(len(pts)),
                                   "voxel_size": cfg.registration.voxel_size, "format": cloud.format})
    if reg.status != "ok" or reg.transform is None:
        stats = {st.value: 0 for st in ScanState}
        stats["total"] = 0
        return ScanVerdictBatch(scan_id=scan_id, registration=reg, verdicts=[], bbox_margin=cfg.verdict.bbox_margin, stats=stats)

    pts_model = reg.transform.apply(pts)
    scanner_model = reg.transform.apply(np.asarray(alignment.scanner_position, dtype=float))[0] if alignment.scanner_position else None
    return judge_objects(pts_model, specs, cfg, scanner_pos_model=scanner_model, previous=previous, scan_id=scan_id,
                         registration=reg, source_file=cloud.source_path)


__all__ = ["run_scan_pipeline"]
