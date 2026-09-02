"""knowledge 테스트 공용 픽스처."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from packages.core.models.evidence import Evidence
from packages.core.models.orm import Base
from packages.core.models.scan import ScanState, ScanVerdict


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    s: Session = factory()
    try:
        yield s
    finally:
        s.close()
        engine.dispose()


@pytest.fixture
def mismatch_scan() -> ScanVerdict:
    """기둥 위치불일치 스캔 판정 픽스처. offset_vector는 Evidence.extra에 둔다."""
    return ScanVerdict(
        scan_id="scan-001",
        global_id="2O2Fr$t4X7Zf8NOew3FLKI",
        state=ScanState.MISMATCH,
        confidence=0.8,
        evidence=Evidence(
            source_type="scan",
            source_id="scan-001",
            file_uri="s3://buildtwin/scans/scan-001.e57",
            method="bbox_density",
            extra={"offset_vector": [0.06, 0.02, 0.0], "density": 0.42},
        ),
    )


@pytest.fixture
def column_object() -> dict:
    return {"global_id": "2O2Fr$t4X7Zf8NOew3FLKI", "ifc_type": "IfcColumn", "level": "B1F", "state": "IN_PROGRESS"}


@pytest.fixture
def activity() -> dict:
    return {
        "activity_id": "A-1010",
        "name": "B1F 기둥 콘크리트 타설",
        "discipline": "structure",
        "planned_start": date(2026, 9, 5),
        "percent_complete": 0.0,
    }
