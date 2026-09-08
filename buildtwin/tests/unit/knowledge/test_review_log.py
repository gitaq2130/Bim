from __future__ import annotations

import pytest
from sqlalchemy import select

from packages.core.models.knowledge import ExpertReviewLog
from packages.core.models.orm import ExpertReviewLogRow
from services.knowledge import expert_review_recorder, json_diff, record_expert_review


def test_json_diff_nested():
    before = {"state": "ESTIMATED_DONE", "mapping": {"global_id": "A", "confidence": 0.7, "keep": 1}, "tags": ["x", "y"]}
    after = {"state": "CONFIRMED", "mapping": {"global_id": "B", "keep": 1, "note": "수정"}, "tags": ["x"], "extra": True}
    diff = json_diff(before, after)
    assert {d["path"]: d for d in diff} == {
        "extra": {"path": "extra", "op": "add", "before": None, "after": True},
        "mapping.confidence": {"path": "mapping.confidence", "op": "remove", "before": 0.7, "after": None},
        "mapping.global_id": {"path": "mapping.global_id", "op": "change", "before": "A", "after": "B"},
        "mapping.note": {"path": "mapping.note", "op": "add", "before": None, "after": "수정"},
        "state": {"path": "state", "op": "change", "before": "ESTIMATED_DONE", "after": "CONFIRMED"},
        "tags[1]": {"path": "tags[1]", "op": "remove", "before": "y", "after": None},
    }
    assert json_diff(before, before) == []


def test_record_expert_review_persists(db_session):
    proposal = {"global_id": "G1", "activity_id": "A1", "confidence": 0.6, "meta": {"method": "name_match"}}
    final = {"global_id": "G1", "activity_id": "A2", "confidence": 1.0, "meta": {"method": "name_match", "by": "cm"}}
    log = record_expert_review(db_session, "activity_object_mapping", "A1:G1", proposal, final, reviewer="cm-kim")
    db_session.commit()
    assert isinstance(log, ExpertReviewLog)
    assert {d["path"] for d in log.diff} == {"activity_id", "confidence", "meta.by"}
    row = db_session.execute(select(ExpertReviewLogRow)).scalar_one()
    assert row.log_id == log.log_id and row.reviewer == "cm-kim" and row.diff == log.diff
    assert row.proposal == proposal and row.final == final


def test_recorder_and_no_session():
    rec = expert_review_recorder("review_request")
    log = rec(None, "rr-1", {"status": "open"}, {"status": "resolved"}, "cm")
    assert log.entity_type == "review_request" and log.diff[0]["op"] == "change"
    with pytest.raises(ValueError):
        rec(None, "rr-1", {"a": 1}, {"a": 2}, "")


def test_middleware_records_final_from_body(db_session):
    pytest.importorskip("httpx")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from services.knowledge import ExpertReviewLogMiddleware

    proposals = {"p-1": {"entity_type": "review_request", "entity_id": "rr-9", "proposal": {"status": "open", "note": None}}}
    recorded: list[ExpertReviewLog] = []
    app = FastAPI()
    app.add_middleware(
        ExpertReviewLogMiddleware, proposal_lookup=proposals.get, session_factory=None, on_record=recorded.append
    )

    @app.post("/resolve")
    def resolve(body: dict) -> dict:
        return {"ok": True, "got": body}

    client = TestClient(app)
    final = {"status": "resolved", "note": "현장 확인 완료"}
    r = client.post("/resolve", json=final, headers={"X-Proposal-Id": "p-1", "X-Reviewer": "cm-park"})
    assert r.status_code == 200 and r.json()["got"] == final      # 본문은 그대로 엔드포인트에 도달
    assert len(recorded) == 1
    log = recorded[0]
    assert log.entity_id == "rr-9" and log.reviewer == "cm-park" and log.final == final
    assert {d["path"] for d in log.diff} == {"status", "note"}
    # 헤더 없음 / 미등록 proposal → 기록 없음
    client.post("/resolve", json=final)
    client.post("/resolve", json=final, headers={"X-Proposal-Id": "nope"})
    assert len(recorded) == 1
