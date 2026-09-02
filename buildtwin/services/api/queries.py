"""읽기 전용 조회 헬퍼(ORM → 코어 모델). 판정·전이 로직 없음."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.identity import BimObject
from packages.core.models.orm import (
    ActivityRelationRow,
    ActivityRow,
    BimObjectRow,
    DailyReportRow,
    DrawingRow,
    EntityObjectMappingRow,
    FileRow,
    MaterialMovementRow,
    ModelRow,
    ScanRow,
    ScanVerdictRow,
    StateTransitionRow,
)
from packages.core.models.progress import DailyReportItem
from packages.core.models.scan import ObjectDiff, ScanState, ScanVerdict
from packages.core.models.state import ObjectState
from services.progress import persistence as db


def latest_model(session: Session, project_id: str) -> ModelRow | None:
    return session.scalars(select(ModelRow).where(ModelRow.project_id == project_id)
                           .order_by(ModelRow.version.desc())).first()


def project_models(session: Session, project_id: str) -> list[ModelRow]:
    return list(session.scalars(select(ModelRow).where(ModelRow.project_id == project_id).order_by(ModelRow.version.desc())))


def project_objects(session: Session, project_id: str, include_orphaned: bool = False) -> list[BimObjectRow]:
    stmt = select(BimObjectRow).where(BimObjectRow.project_id == project_id)
    if not include_orphaned:
        stmt = stmt.where(BimObjectRow.is_orphaned.is_(False))
    return list(session.scalars(stmt.order_by(BimObjectRow.global_id)))


def model_objects(session: Session, model_id: str) -> list[BimObjectRow]:
    return list(session.scalars(select(BimObjectRow).where(BimObjectRow.model_id == model_id, BimObjectRow.is_orphaned.is_(False))))


def as_models(rows: list[BimObjectRow]) -> list[BimObject]:
    return [db.object_row_to_model(r) for r in rows]


def project_drawings(session: Session, project_id: str) -> list[DrawingRow]:
    return list(session.scalars(select(DrawingRow).where(DrawingRow.project_id == project_id)))


def project_scans(session: Session, project_id: str) -> list[ScanRow]:
    return list(session.scalars(select(ScanRow).where(ScanRow.project_id == project_id).order_by(ScanRow.created_at)))


def project_files(session: Session, project_id: str) -> list[FileRow]:
    return list(session.scalars(select(FileRow).where(FileRow.project_id == project_id)))


def verdict_row_to_model(row: ScanVerdictRow) -> ScanVerdict:
    return ScanVerdict(scan_id=row.scan_id, global_id=row.global_id, state=ScanState(row.state), confidence=row.confidence,
                       evidence=Evidence.model_validate(row.evidence),
                       diff_from_previous=ObjectDiff.model_validate(row.diff_from_previous) if row.diff_from_previous else None)


def latest_scan_verdict(session: Session, global_id: str) -> ScanVerdict | None:
    row = db.latest_scan_verdict(session, global_id)
    return verdict_row_to_model(row) if row else None


def scan_verdicts(session: Session, scan_id: str) -> list[ScanVerdictRow]:
    return list(session.scalars(select(ScanVerdictRow).where(ScanVerdictRow.scan_id == scan_id).order_by(ScanVerdictRow.global_id)))


def previous_verdicts(session: Session, global_ids: list[str], exclude_scan_id: str) -> dict[str, ScanVerdict]:
    """객체별 직전 스캔 판정(이번 스캔 제외) — diff 계산 입력."""
    out: dict[str, ScanVerdict] = {}
    if not global_ids:
        return out
    rows = session.scalars(select(ScanVerdictRow).where(ScanVerdictRow.global_id.in_(global_ids),
                                                        ScanVerdictRow.scan_id != exclude_scan_id)
                           .order_by(ScanVerdictRow.created_at.desc()))
    for r in rows:
        if r.global_id not in out:
            out[r.global_id] = verdict_row_to_model(r)
    return out


def entity_mappings_for_object(session: Session, global_id: str) -> list[EntityObjectMappingRow]:
    return list(session.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.global_id == global_id)))


def entity_mapping(session: Session, drawing_id: str, handle: str) -> EntityObjectMappingRow | None:
    return session.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == drawing_id,
                                                                EntityObjectMappingRow.entity_handle == handle)).first()


def material_ids_for_object(session: Session, global_id: str) -> list[str]:
    rows = session.scalars(select(MaterialMovementRow.material_id).where(MaterialMovementRow.global_id == global_id).distinct())
    return sorted(set(rows))


def latest_report_item(session: Session, project_id: str, global_id: str) -> DailyReportItem | None:
    """가장 최근 작업일보에서 이 객체(직접 global_id 또는 매핑된 Activity)를 가리키는 항목."""
    activity_ids = set(db.activity_ids_for_object(session, global_id))
    reports = session.scalars(select(DailyReportRow).where(DailyReportRow.project_id == project_id)
                              .order_by(DailyReportRow.submitted_at.desc()))
    for report in reports:
        for item in report.items or []:
            if item.get("global_id") == global_id or (item.get("activity_id") and item["activity_id"] in activity_ids):
                try:
                    return DailyReportItem.model_validate(item)
                except ValueError:
                    continue
    return None


def project_activities(session: Session, project_id: str) -> list[ActivityRow]:
    return db.load_activities(session, project_id)


def predecessor_map(session: Session, project_id: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for rel in db.load_relations(session, project_id):
        out.setdefault(rel.successor_id, []).append(rel.predecessor_id)
    return out


def relation_rows(session: Session, project_id: str) -> list[ActivityRelationRow]:
    return db.load_relations(session, project_id)


def confirmed_since(session: Session, global_ids: list[str], since: datetime) -> int:
    if not global_ids:
        return 0
    rows = session.scalars(select(StateTransitionRow).where(StateTransitionRow.global_id.in_(global_ids),
                                                            StateTransitionRow.to_state == ObjectState.CONFIRMED.value))
    n = 0
    for r in rows:
        t = r.occurred_at
        if t is None:
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=UTC)
        if t >= since:
            n += 1
    return n


def week_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.now(UTC)
    return now - timedelta(days=7), now


def object_summary(row: BimObjectRow) -> dict[str, Any]:
    return {"global_id": row.global_id, "ifc_type": row.ifc_type, "name": row.name, "level": row.level, "zone": row.zone,
            "state": row.state, "model_id": row.model_id, "quantity": row.quantity or {}, "material": row.material}
