"""reality-capture 테스트 공용 픽스처: 설정, 기준점, sample.ifc 1F 객체 bbox(ifcopenshell 월드 좌표), 기대 판정.
로더 본체는 tests/helpers/scan_fixtures.py (회귀 테스트와 공용)."""
from __future__ import annotations

from pathlib import Path

import pytest

from packages.core.models.scan import AlignmentInput
from services.scan.config import ScanConfig, load_scan_config
from tests.helpers.scan_fixtures import load_alignment, load_expected_verdicts, load_ifc_objects_1f

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture(scope="session")
def cfg() -> ScanConfig:
    return load_scan_config()


@pytest.fixture(scope="session")
def alignment() -> AlignmentInput:
    return load_alignment()


@pytest.fixture(scope="session")
def expected() -> dict:
    return load_expected_verdicts()


@pytest.fixture(scope="session")
def ifc_objects_1f(expected) -> list[dict]:
    """sample.ifc 를 ifcopenshell.geom(월드 좌표)으로 열어 기대 판정 대상(1F) 객체의 AABB 를 만든다."""
    return load_ifc_objects_1f(expected)


@pytest.fixture(scope="session")
def scan_ply() -> Path:
    return FIXTURES / "sample.ply"
