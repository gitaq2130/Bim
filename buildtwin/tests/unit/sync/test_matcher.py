"""3단계 매핑 정확도·needs_review·스킵 규칙 테스트."""
from __future__ import annotations

import pytest
from shapely.geometry import box

from packages.core.models import MAPPING_REVIEW_THRESHOLD, DrawingEntityDraft
from services.sync.config import load_sync_config
from services.sync.matcher import build_mappings, entity_geometry, geo_iou, typical_member_width
from services.sync.rules import load_layer_rules
from services.sync.transform import DrawingAlignment, auto_align_by_grid, grid_from_ifc_objects

from tests.helpers.sync_fixtures import accuracy, expected_mappings, load_dxf_entities, load_ifc_objects, true_alignment

DRAWING_ID = "dwg-sample-1f"


@pytest.fixture(scope="module")
def dxf():
    return load_dxf_entities()


@pytest.fixture(scope="module")
def objects():
    return load_ifc_objects()


def _consistent_expected(entities, objects, expected: dict[str, dict]) -> tuple[dict[str, dict], list[str]]:
    """픽스처 정합성 필터: 진짜 정합값에서 기대 객체가 기하 후보가 될 수 있는(IoU ≥ min_geo_score) 쌍만 남긴다.
    sample.ifc 의 Y방향 보(BY*)·서/동 벽(W*-W/E)은 ifcopenshell 월드 기하가 DXF 위치와 다르다(픽스처 생성기 이슈, qa 소유).
    반환: (consistent, excluded_handles)."""
    cfg = load_sync_config()
    a = true_alignment()
    pool = [o for o in objects if o.level == "1F"]
    buffer_m = cfg.line_buffer_ratio * typical_member_width(pool)
    by_handle = {e.handle: e for e in entities}
    by_gid = {o.global_id: o for o in objects}
    out, excluded = {}, []
    for h, v in expected.items():
        eg = entity_geometry(by_handle[h], a, buffer_m)
        ob = by_gid[v["global_id"]].bbox.to_2d()
        if geo_iou(eg.geom, box(*ob.min, *ob.max)) >= cfg.min_geo_score:
            out[h] = v
        else:
            excluded.append(h)
    return out, excluded


def test_mapping_accuracy_with_true_alignment(dxf, objects):
    entities, _ = dxf
    expected = expected_mappings()
    mappings = build_mappings(DRAWING_ID, entities, objects, true_alignment(), level="1F")
    col_acc, col_hit, col_n = accuracy(mappings, expected, {"A-COL"})
    all_acc, all_hit, all_n = accuracy(mappings, expected)
    consistent, excluded = _consistent_expected(entities, objects, expected)
    cons_acc, cons_hit, cons_n = accuracy(mappings, consistent)
    print(f"\nmapping_column_accuracy={col_acc:.3f} ({col_hit}/{col_n}) "
          f"mapping_overall_accuracy_raw={all_acc:.3f} ({all_hit}/{all_n}) "
          f"mapping_overall_accuracy_consistent={cons_acc:.3f} ({cons_hit}/{cons_n}) "
          f"fixture_inconsistent_handles={excluded}")
    assert col_acc >= 0.9
    assert cons_acc >= 0.8
    # 기하적으로 불가능한 기대쌍(픽스처 이슈)은 틀리게 매핑되지 않고 '매핑 없음'이어야 한다
    got = {m.entity_handle: m.global_id for m in mappings}
    wrong = [h for h in expected if h in got and got[h] != expected[h]["global_id"]]
    assert wrong == [], wrong
    for m in mappings:
        assert 0.0 <= m.confidence <= 1.0
        ev = m.evidence
        assert ev.source_type == "mapping" and ev.source_id == DRAWING_ID
        assert ev.method and ev.method.startswith("user_align|bbox_iou")
        assert {"iou", "rule_score", "transform_source"} <= set(ev.extra)
        assert ev.bbox is not None and ev.coordinates
    cols = [m for m in mappings if m.entity_handle in {h for h, v in expected.items() if v["layer"] == "A-COL"}]
    assert all(m.evidence.method == "user_align|bbox_iou|layer_rule" and m.evidence.rule_id == "layer:A-COL*" for m in cols)
    assert all(m.confidence >= MAPPING_REVIEW_THRESHOLD and not m.needs_review for m in cols)


def test_mapping_accuracy_with_auto_alignment(dxf, objects):
    entities, unit_scale = dxf
    gx, gy = grid_from_ifc_objects(objects)
    alignment = auto_align_by_grid(entities, gx, gy, load_layer_rules().grid_layers, unit_scale)
    assert alignment is not None
    mappings = build_mappings(DRAWING_ID, entities, objects, alignment, level="1F")
    col_acc, hit, n = accuracy(mappings, expected_mappings(), {"A-COL"})
    print(f"\nmapping_column_accuracy(auto_align)={col_acc:.3f} ({hit}/{n})")
    assert col_acc >= 0.9
    assert all(m.evidence.method.startswith("grid_align|") for m in mappings)
    assert all(m.evidence.extra["transform_source"] == "grid_auto_align" for m in mappings)


def test_low_confidence_mappings_are_flagged_for_review(dxf, objects):
    """정합을 일부러 30cm 흔들면 IoU 가 떨어져 낮은 confidence 가 생긴다 — 전부 needs_review 여야 한다."""
    entities, _ = dxf
    t = true_alignment()
    shifted = DrawingAlignment(origin=(t.origin[0] + 0.3, t.origin[1] - 0.25), rotation_deg=t.rotation_deg,
                               scale=t.scale, source="user_input")
    mappings = build_mappings(DRAWING_ID, entities, objects, shifted, level="1F")
    low = [m for m in mappings if m.confidence < MAPPING_REVIEW_THRESHOLD]
    assert low, "perturbed alignment should produce low-confidence mappings"
    assert all(m.needs_review for m in low)
    assert all(not m.needs_review for m in mappings if m.confidence >= MAPPING_REVIEW_THRESHOLD)
    assert all(m.reviewed_by is None for m in mappings)


def test_grid_and_text_entities_produce_no_mappings(dxf, objects):
    entities, _ = dxf
    mappings = build_mappings(DRAWING_ID, entities, objects, true_alignment(), level="1F")
    handles = {m.entity_handle for m in mappings}
    by_handle = {e.handle: e for e in entities}
    for h in handles:
        e = by_handle[h]
        assert e.layer not in ("GRID", "A-TEXT") and e.dxftype != "TEXT"
    grid_or_text = [e.handle for e in entities if e.layer in ("GRID", "A-TEXT")]
    assert grid_or_text and not (set(grid_or_text) & handles)


def test_level_filter_and_floor(dxf, objects):
    entities, _ = dxf
    cfg = load_sync_config()
    # 다른 층만 남기면 매핑은 그 층 객체로만 간다
    m2 = build_mappings(DRAWING_ID, entities, objects, true_alignment(), level="2F", cfg=cfg)
    gids = {o.global_id: o for o in objects}
    assert m2 and all(gids[m.global_id].level == "2F" for m in m2)
    # 존재하지 않는 층 → 후보 없음
    assert build_mappings(DRAWING_ID, entities, objects, true_alignment(), level="B9") == []
    # 객체와 전혀 겹치지 않는 엔티티는 floor 미만이라 매핑되지 않는다
    far = DrawingEntityDraft(handle="ZZ", layer="A-COL", dxftype="LWPOLYLINE", attrs={"closed": True},
                             points=[(0, 0), (600, 0), (600, 600), (0, 600)])
    assert build_mappings(DRAWING_ID, [far], objects, true_alignment(), level="1F", cfg=cfg) == []


def test_layer_rule_mismatch_lowers_confidence(objects):
    """같은 기하라도 레이어 규칙이 다른 타입을 가리키면 감점된다."""
    a = true_alignment()
    col = next(o for o in objects if o.name == "C1-11")
    (x0, y0, _), (x1, y1, _) = col.bbox.min, col.bbox.max
    pts = [tuple(p) for p in a.model_to_drawing([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])]
    mk = lambda layer: DrawingEntityDraft(handle="H", layer=layer, dxftype="LWPOLYLINE", points=pts, attrs={"closed": True})  # noqa: E731
    good = build_mappings(DRAWING_ID, [mk("A-COL")], objects, a, level="1F")[0]
    none = build_mappings(DRAWING_ID, [mk("X-MISC")], objects, a, level="1F")[0]
    bad = build_mappings(DRAWING_ID, [mk("M-DUCT")], objects, a, level="1F")[0]
    assert good.global_id == none.global_id == bad.global_id == col.global_id
    assert good.confidence > none.confidence > bad.confidence
    assert bad.evidence.extra["rule_score"] < 0 and bad.needs_review
    assert none.evidence.method == "user_align|bbox_iou"
