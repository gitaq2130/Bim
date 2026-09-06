from __future__ import annotations

import pytest

from packages.core.models import EntityObjectMapping, Evidence
from services.sync.review_queue import confirm_mapping, mappings_needing_review


def _m(handle: str, conf: float) -> EntityObjectMapping:
    ev = Evidence(source_type="mapping", source_id="dwg1", method="user_align|bbox_iou", extra={"iou": conf, "rule_score": 0})
    return EntityObjectMapping(drawing_id="dwg1", entity_handle=handle, global_id=f"G{handle}", confidence=conf, evidence=ev)


def test_review_queue_and_confirm():
    ms = [_m("A", 0.95), _m("B", 0.55), _m("C", 0.69), _m("D", 0.7)]
    reqs = mappings_needing_review(ms, project_id="p1")
    assert [r.conflicting_sources["entity_handle"] for r in reqs] == ["B", "C"]
    r = reqs[0]
    assert r.kind == "mapping" and r.project_id == "p1" and r.global_id == "GB" and r.status == "open"
    assert r.conflicting_sources["candidate_global_id"] == "GB" and r.conflicting_sources["confidence"] == 0.55
    assert r.evidence.source_type == "mapping" and r.confidence == 0.55 and r.title

    ok = confirm_mapping(ms[1], user_id="cm-01")
    assert ok.reviewed_by == "cm-01" and ok.needs_review is False and ok.confidence == 0.55
    assert ms[1].needs_review is True                      # 원본 불변
    assert mappings_needing_review([ok], project_id="p1") == []

    re = confirm_mapping(ms[2], user_id="cm-01", global_id="G-OTHER")
    assert re.global_id == "G-OTHER" and re.evidence.extra["auto_global_id"] == "GC" and not re.needs_review
    with pytest.raises(ValueError):
        confirm_mapping(ms[1], user_id="  ")
