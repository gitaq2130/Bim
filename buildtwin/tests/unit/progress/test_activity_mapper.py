from __future__ import annotations

import pytest

from packages.core.models.progress import Activity, Schedule
from services.progress.activity_mapper import map_activities_to_objects, mapping_accuracy, resolve_target
from services.progress.importers import import_schedule

from .conftest import FIXTURES


@pytest.mark.parametrize("filename", ["schedule.csv", "schedule.xml", "schedule.xer"])
def test_mapping_accuracy_against_expected(filename, sample_objects, schedule_expected):
    schedule = import_schedule(FIXTURES / filename, "P1")
    mappings = map_activities_to_objects(schedule, sample_objects)
    assert mapping_accuracy(mappings, schedule_expected["activity_object_mapping"]) >= 0.9
    for m in mappings:
        assert 0.0 <= m.confidence <= 1.0
        assert m.evidence.source_type == "schedule"
        assert m.evidence.method in {"wbs_rule", "keyword_rule", "level_zone"}
        assert "matched_rules" in m.evidence.extra
        assert not m.needs_review


def test_level_mismatch_is_excluded_and_keyword_only_lowers_confidence(sample_objects):
    schedule = Schedule(schedule_id="S", project_id="P", source_format="csv", relations=[], activities=[
        Activity(activity_id="X1", name="2F 슬래브 타설"),          # 층은 이름에서 추론, WBS 없음
        Activity(activity_id="X2", name="배관 설치", level="1F"),   # 대상 타입 객체가 없음
        Activity(activity_id="X3", name="잡철물 설치", level="1F"),  # 타입 추론 불가 → 매핑 없음
    ])
    mappings = map_activities_to_objects(schedule, sample_objects)
    by_act: dict[str, list] = {}
    for m in mappings:
        by_act.setdefault(m.activity_id, []).append(m)
    slab_2f = [o.global_id for o in sample_objects if o.ifc_type == "IfcSlab" and o.level == "2F"]
    assert [m.global_id for m in by_act["X1"]] == slab_2f
    assert by_act["X1"][0].evidence.method == "keyword_rule"
    assert by_act["X1"][0].confidence < 0.9
    assert "X2" not in by_act and "X3" not in by_act


def test_wbs_table_supplies_types_when_name_has_no_keyword():
    target = resolve_target(Activity(activity_id="W", name="공사 1구간", wbs_code="1.3.1"))
    assert target.wbs_hit and "IfcDuctSegment" in target.ifc_types and target.level == "1F"
