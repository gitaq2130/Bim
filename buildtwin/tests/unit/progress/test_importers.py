from __future__ import annotations

import pytest

from services.progress.importers import detect_format, import_schedule
from services.progress.importers._common import infer_discipline, infer_level, normalize_level, parse_predecessors
from services.progress.importers.msproject_xml import parse_duration_days

from .conftest import FIXTURES


@pytest.mark.parametrize("filename,fmt", [("schedule.csv", "csv"), ("schedule.xml", "msproject_xml"), ("schedule.xer", "p6_xer")])
def test_import_counts_and_relations_match_expected(filename, fmt, schedule_expected):
    schedule = import_schedule(FIXTURES / filename, "P1")
    assert schedule.source_format == fmt
    assert len(schedule.activities) == schedule_expected["activity_count"]
    assert len(schedule.relations) == schedule_expected["relation_count"]
    assert [a.activity_id for a in schedule.activities] == schedule_expected["activities"]
    got = [[r.predecessor_id, r.successor_id, r.type, r.lag_days] for r in schedule.relations]
    assert got == schedule_expected["relations"]
    assert schedule.warnings == []


@pytest.mark.parametrize("filename", ["schedule.csv", "schedule.xml", "schedule.xer"])
def test_import_infers_level_and_discipline(filename):
    schedule = import_schedule(FIXTURES / filename, "P1")
    by_id = {a.activity_id: a for a in schedule.activities}
    assert by_id["A100"].level == "1F" and by_id["A400"].level == "2F"
    assert by_id["A100"].discipline == "structure"
    assert by_id["A200"].discipline == "architecture"
    assert by_id["A300"].discipline == "mechanical"
    assert by_id["A100"].duration_days == 8.0
    assert by_id["A100"].wbs_code == "1.1.1"
    assert str(by_id["A100"].planned_start) == "2026-09-01"


def test_csv_extra_numeric_columns_become_resources():
    schedule = import_schedule(FIXTURES / "schedule.csv", "P1", fmt="csv")
    assert schedule.activities[0].resources == {"crew": 4.0}


def test_explicit_format_aliases_and_detection():
    assert detect_format("x.XER") == "p6_xer"
    assert import_schedule(FIXTURES / "schedule.xml", "P1", fmt="xml").source_format == "msproject_xml"
    with pytest.raises(ValueError):
        detect_format("schedule.txt")


def test_predecessor_string_parsing_and_warnings():
    warnings: list[str] = []
    rels = parse_predecessors("A100:FS:0;A110:SS:2, A120, A130:XX:q", "A200", warnings)
    assert [(r.predecessor_id, r.type, r.lag_days) for r in rels] == [("A100", "FS", 0.0), ("A110", "SS", 2.0), ("A120", "FS", 0.0), ("A130", "FS", 0.0)]
    assert len(warnings) == 2


def test_level_and_discipline_heuristics():
    assert infer_level("지하1층 기둥") == "B1"
    assert infer_level("지상 3층 슬래브") == "3F"
    assert normalize_level("2층") == "2F"
    assert infer_level("옥상 덕트") == "RF"
    assert infer_discipline("전기 트레이 설치") == "electrical"
    assert infer_discipline("배관 설치") == "mechanical"
    assert infer_discipline("보 시공") == "structure"
    assert infer_discipline("보수 공사") is None   # '보' 단독 키워드만 구조로 본다
    assert parse_duration_days("PT64H0M0S") == 8.0
