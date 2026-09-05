from __future__ import annotations

from datetime import UTC
from pathlib import Path

import pytest
import yaml

from packages.core.models.orm import BimObjectRow
from packages.core.models.state import ObjectState
from packages.core.settings import settings
from services.progress import persistence as db
from services.progress.config_loader import load_readiness_config
from services.progress.readiness import compute_readiness

# ADR 0008: Activity 는 (project_id, activity_id) 복합 키다. `seeded` 픽스처가 쓰는 프로젝트.
PROJECT_ID = "P-TEST"


def _set_states(session, project_id: str, gids: list[str], state: ObjectState) -> None:
    for g in gids:
        session.get(BimObjectRow, (project_id, g)).state = state.value
    session.flush()


def test_readiness_without_predecessors_is_startable(session, seeded):
    score = compute_readiness(session, PROJECT_ID, "A100")
    cfg = load_readiness_config()
    assert score.components["predecessor_completion"] == 1.0
    assert score.components["crew_assigned"] == 1.0
    assert score.components["drawing_approval"] == cfg["component_defaults"]["drawing_approval_unknown"]
    assert score.score >= cfg["start_threshold"]
    assert score.weights == cfg["weights"]
    assert score.evidence.source_type == "system_logic"
    assert set(score.evidence.extra["missing_components"]) == {"material_delivery", "drawing_approval"}
    assert score.confidence == pytest.approx(1 - 2 / 6)
    assert {b.component for b in score.blockers} == {"drawing_approval"}


def test_predecessor_blocker_until_objects_confirmed(session, seeded):
    score = compute_readiness(session, PROJECT_ID, "A110")
    assert score.components["predecessor_completion"] == 0.0
    pred_blockers = [b for b in score.blockers if b.component == "predecessor_completion"]
    assert pred_blockers and pred_blockers[0].related_ids == ["A100"] and pred_blockers[0].severity == "high"
    assert score.estimated_completion == 0.0

    a100_objects = seeded["expected"]["A100"]
    _set_states(session, seeded["project_id"], a100_objects, ObjectState.ESTIMATED_DONE)
    score = compute_readiness(session, PROJECT_ID, "A110")
    assert score.components["predecessor_completion"] == 0.0        # ESTIMATED_DONE 은 완료가 아니다
    assert score.estimated_completion == 1.0

    _set_states(session, seeded["project_id"], a100_objects, ObjectState.INSPECTION_REQUESTED)
    score = compute_readiness(session, PROJECT_ID, "A110")
    assert score.components["inspection"] == 0.0

    _set_states(session, seeded["project_id"], a100_objects, ObjectState.CONFIRMED)
    score = compute_readiness(session, PROJECT_ID, "A110")
    assert score.components["predecessor_completion"] == 1.0
    assert score.components["inspection"] == 1.0
    assert not [b for b in score.blockers if b.component == "predecessor_completion"]


def test_weights_file_swap_changes_score(session, seeded, tmp_path: Path, monkeypatch):
    before = compute_readiness(session, PROJECT_ID, "A110")
    cfg = load_readiness_config()
    swapped = dict(cfg)
    swapped["weights"] = {"predecessor_completion": 0.05, "inspection": 0.05, "material_delivery": 0.05,
                          "drawing_approval": 0.05, "open_clashes": 0.05, "crew_assigned": 0.75}
    (tmp_path / "readiness.yaml").write_text(yaml.safe_dump(swapped), encoding="utf-8")
    monkeypatch.setattr(settings, "config_dir", str(tmp_path))
    after = compute_readiness(session, PROJECT_ID, "A110")
    assert after.weights != before.weights
    assert after.score != before.score
    assert after.components == before.components
    # 명시적 가중치 인자도 파일보다 우선한다
    explicit = compute_readiness(session, PROJECT_ID, "A110", weights=cfg["weights"])
    assert explicit.score == pytest.approx(before.score)


def test_material_and_drawing_components(session, seeded):
    from datetime import datetime

    from packages.core.models.progress import MaterialMovement

    row = db.load_activity(session, PROJECT_ID, "A100")
    row.resources = {**row.resources, "material_required": 10.0, "drawing_approved": 1}
    session.flush()
    db.save_material_movement(session, seeded["project_id"], MaterialMovement(
        material_id="rebar", activity_id="A100", kind="in", quantity=4.0, unit="t", occurred_at=datetime.now(UTC)))
    score = compute_readiness(session, PROJECT_ID, "A100")
    assert score.components["material_delivery"] == pytest.approx(0.4)
    assert score.components["drawing_approval"] == 1.0
    assert score.confidence == 1.0
    assert any(b.component == "material_delivery" for b in score.blockers)
