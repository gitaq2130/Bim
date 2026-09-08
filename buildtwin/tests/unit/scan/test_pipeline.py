"""전체 파이프라인: sample.ply + alignment.json + sample.ifc 1F 객체 → verdict.expected.json 대비 정확도 ≥ 0.85 및 대표 케이스."""
from __future__ import annotations

import json

import pytest

from packages.core.models.scan import AlignmentInput, ScanState, ScanVerdict
from services.scan.pipeline import run_scan_pipeline

MIN_ACCURACY = 0.85


@pytest.fixture(scope="module")
def batch(cfg, alignment, ifc_objects_1f, scan_ply):
    return run_scan_pipeline(scan_ply, alignment, ifc_objects_1f, scan_id="scan-1f", cfg=cfg)


def _by_name(ifc_objects_1f):
    return {o["name"]: o["global_id"] for o in ifc_objects_1f}


def test_registration_ok(batch, cfg):
    assert batch.registration.status == "ok", batch.registration.message
    assert batch.registration.rmse < cfg.registration.max_rmse
    assert batch.bbox_margin == cfg.verdict.bbox_margin


def test_accuracy_against_expected(batch, expected):
    exp = expected["verdicts"]
    got = {v.global_id: v.state.value for v in batch.verdicts}
    assert set(got) == set(exp)
    hits = sum(got[g] == exp[g] for g in exp)
    accuracy = hits / len(exp)
    print(f"\nscan verdict accuracy: {accuracy:.3f} ({hits}/{len(exp)})")
    assert accuracy >= MIN_ACCURACY, {g: (got[g], exp[g]) for g in exp if got[g] != exp[g]}


def test_representative_columns(batch, ifc_objects_1f):
    names = _by_name(ifc_objects_1f)
    states = {v.global_id: v.state for v in batch.verdicts}
    for col in ("C1-11", "C1-12", "C1-21"):
        assert states[names[col]] == ScanState.ESTIMATED_DONE, col
    assert states[names["C1-22"]] == ScanState.IN_PROGRESS       # 절반 높이
    assert states[names["C1-31"]] == ScanState.MISMATCH          # 80mm offset
    assert states[names["C1-32"]] == ScanState.UNVERIFIABLE      # 차폐 박스 뒤
    assert states[names["W1-S"]] == ScanState.ESTIMATED_DONE
    assert states[names["S1"]] == ScanState.NOT_BUILT


def test_mismatch_evidence_has_offset_vector(batch, ifc_objects_1f, cfg):
    names = _by_name(ifc_objects_1f)
    v = next(v for v in batch.verdicts if v.global_id == names["C1-31"])
    off = v.evidence.extra["offset_vector"]
    assert v.evidence.extra["offset_norm"] > cfg.verdict.mismatch_offset
    assert abs(off[0] - 0.08) < cfg.verdict.surface_distance and abs(off[1] - 0.08) < cfg.verdict.surface_distance


def test_unverifiable_confidence_capped_by_occlusion(batch, ifc_objects_1f, cfg):
    names = _by_name(ifc_objects_1f)
    v = next(v for v in batch.verdicts if v.global_id == names["C1-32"])
    occ = v.evidence.extra["occlusion_ratio"]
    assert occ > cfg.verdict.occlusion_unverifiable
    assert v.confidence <= max(cfg.verdict.confidence_floor, 1 - occ) + 1e-9


def test_every_verdict_has_confidence_and_evidence(batch):
    required = {"point_count", "density", "surface_match_ratio", "z_coverage", "offset_vector", "occlusion_ratio", "rule_id"}
    for v in batch.verdicts:
        assert isinstance(v, ScanVerdict)
        assert 0.0 <= v.confidence <= 1.0
        assert v.evidence.source_type == "scan" and v.evidence.source_id == "scan-1f"
        assert v.evidence.bbox is not None and v.evidence.file_uri
        assert required <= set(v.evidence.extra), required - set(v.evidence.extra)
        assert v.evidence.extra["rule_id"] == "SCAN-VERDICT-v1"
        assert v.state.value != "CONFIRMED"
    assert batch.stats["total"] == len(batch.verdicts)
    assert sum(batch.stats[s.value] for s in ScanState) == batch.stats["total"]


def test_diff_against_previous(batch, cfg, alignment, ifc_objects_1f, scan_ply):
    previous = {v.global_id: v for v in batch.verdicts}
    again = run_scan_pipeline(scan_ply, alignment, ifc_objects_1f, scan_id="scan-2", cfg=cfg, previous=previous)
    for v in again.verdicts:
        d = v.diff_from_previous
        assert d is not None and d.prev_scan_id == "scan-1f"
        assert d.prev_state == previous[v.global_id].state and d.curr_state == v.state
        assert abs(d.density_delta) < 1e-6


def test_pipeline_without_alignment_skips_verdict(cfg, ifc_objects_1f, scan_ply):
    batch = run_scan_pipeline(scan_ply, AlignmentInput(), ifc_objects_1f, scan_id="s", cfg=cfg)
    assert batch.registration.status == "needs_alignment_input"
    assert batch.verdicts == [] and batch.stats["total"] == 0


def test_celery_task_returns_json(alignment, ifc_objects_1f, scan_ply):
    from services.scan.tasks import register_scan_task

    out = register_scan_task.apply(args=("job-1", str(scan_ply), alignment.model_dump_json(), json.dumps(ifc_objects_1f), "scan-t")).get()
    assert out["job_id"] == "job-1" and out["scan_id"] == "scan-t"
    assert out["registration"]["status"] == "ok"
    assert len(out["verdicts"]) == len(ifc_objects_1f)
    json.dumps(out)   # JSON 직렬화 가능
