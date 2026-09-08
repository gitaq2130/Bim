"""ScanState 에 CONFIRMED 가 없고, 모듈 어디에서도 '확정'을 내지 않는지."""
from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from packages.core.models.scan import ScanState, ScanVerdict

SCAN_DIR = Path(__file__).resolve().parents[3] / "services" / "scan"


def test_scanstate_has_no_confirmed():
    assert "CONFIRMED" not in ScanState.__members__
    assert set(ScanState.__members__) == {"NOT_BUILT", "IN_PROGRESS", "ESTIMATED_DONE", "MISMATCH", "UNVERIFIABLE"}


def test_scan_module_never_mentions_confirmed_state_or_transition():
    for py in SCAN_DIR.glob("*.py"):
        src = py.read_text(encoding="utf-8")
        assert "StateTransition" not in src, py
        assert '"CONFIRMED"' not in src and "ScanState.CONFIRMED" not in src, py


def test_verdict_rejects_non_enum_state():
    with pytest.raises(ValidationError):
        ScanVerdict(scan_id="s", global_id="g", state="CONFIRMED", confidence=1.0,
                    evidence={"source_type": "scan", "source_id": "s"})
