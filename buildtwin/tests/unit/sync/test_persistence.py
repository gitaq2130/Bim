from __future__ import annotations

import numpy as np
import pytest

from packages.core.models import EntityObjectMapping, Evidence
from services.sync.persistence import load_alignment, load_mappings, save_alignment, save_mappings
from services.sync.transform import DrawingAlignment, alignment_to_transform

from .conftest import make_bim_object

# conftest.session 은 이미 Project(p1)/File(f1)/Drawing(d1) 체인을 만들어 둔다.


def _m(handle, gid, conf, reviewed=None):
    ev = Evidence(source_type="mapping", source_id="d1", method="user_align|bbox_iou", extra={"iou": conf})
    return EntityObjectMapping(drawing_id="d1", entity_handle=handle, global_id=gid, confidence=conf, evidence=ev, reviewed_by=reviewed)


def test_save_and_load_mappings(session):
    make_bim_object(session, "p1", "G1")
    make_bim_object(session, "p1", "G2")
    make_bim_object(session, "p1", "G9")
    session.commit()
    assert save_mappings(session, [_m("3A", "G1", 0.9), _m("3B", "G2", 0.4)]) == 2
    session.commit()
    got = {m.entity_handle: m for m in load_mappings(session, "d1")}
    assert got["3A"].global_id == "G1" and got["3B"].needs_review is True and got["3A"].needs_review is False
    assert got["3B"].evidence.extra["iou"] == 0.4
    assert [m.entity_handle for m in load_mappings(session, "d1", needs_review=True)] == ["3B"]
    # 재저장은 같은 handle 을 교체한다
    save_mappings(session, [_m("3B", "G9", 0.8, reviewed="cm-01")])
    session.commit()
    got = {m.entity_handle: m for m in load_mappings(session, "d1")}
    assert len(got) == 2 and got["3B"].global_id == "G9" and got["3B"].reviewed_by == "cm-01"
    assert load_mappings(session, "nope") == []


def test_save_and_load_alignment(session):
    a = DrawingAlignment(origin=(100.0, 50.0), rotation_deg=15.0, scale=0.001, source="grid_auto_align", rmse=0.001, n_correspondences=6)
    row = save_alignment(session, "d1", a)
    session.commit()
    assert row.alignment["transform"]["matrix"] == alignment_to_transform(a).matrix
    assert row.coordinate_system["source"] == "grid_auto_align" and row.coordinate_system["scale"] == 0.001
    assert np.allclose(row.coordinate_system["rotation_deg"], -15.0)
    b = load_alignment(session, "d1")
    assert b == a
    assert load_alignment(session, "missing") is None
    with pytest.raises(LookupError):
        save_alignment(session, "missing", a)
