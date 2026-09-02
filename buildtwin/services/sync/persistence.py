"""매핑·정합 저장/조회 — EntityObjectMappingRow, DrawingRow.alignment. 담당: sync-2d3d."""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from packages.core.models import EntityObjectMapping, Evidence
from packages.core.models.orm import DrawingRow, EntityObjectMappingRow

from .transform import DrawingAlignment, alignment_to_transform

ALIGNMENT_KEY = "alignment"
TRANSFORM_KEY = "transform"


def mapping_to_row(m: EntityObjectMapping) -> EntityObjectMappingRow:
    return EntityObjectMappingRow(drawing_id=m.drawing_id, entity_handle=m.entity_handle, global_id=m.global_id,
                                  confidence=m.confidence, evidence=m.evidence.model_dump(mode="json"),
                                  needs_review=m.needs_review, reviewed_by=m.reviewed_by)


def row_to_mapping(r: EntityObjectMappingRow) -> EntityObjectMapping:
    return EntityObjectMapping(drawing_id=r.drawing_id, entity_handle=r.entity_handle, global_id=r.global_id,
                               confidence=r.confidence, evidence=Evidence.model_validate(r.evidence),
                               needs_review=r.needs_review, reviewed_by=r.reviewed_by)


def save_mappings(session: Session, mappings: list[EntityObjectMapping], replace: bool = True) -> int:
    """매핑 저장. replace=True 면 같은 (drawing_id, handle)의 기존 행을 지우고 넣는다(사용자 확정 행 포함 — 호출자가 판단)."""
    if replace:
        for m in mappings:
            session.execute(delete(EntityObjectMappingRow).where(
                EntityObjectMappingRow.drawing_id == m.drawing_id,
                EntityObjectMappingRow.entity_handle == m.entity_handle))
    rows = [mapping_to_row(m) for m in mappings]
    session.add_all(rows)
    session.flush()
    return len(rows)


def load_mappings(session: Session, drawing_id: str, needs_review: bool | None = None) -> list[EntityObjectMapping]:
    stmt = select(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == drawing_id)
    if needs_review is not None:
        stmt = stmt.where(EntityObjectMappingRow.needs_review == needs_review)
    return [row_to_mapping(r) for r in session.scalars(stmt).all()]


def save_alignment(session: Session, drawing_id: str, alignment: DrawingAlignment) -> DrawingRow:
    """DrawingRow.alignment = {alignment, transform(4x4 → model)}; coordinate_system 도 정합된 좌표계로 갱신."""
    row = session.get(DrawingRow, drawing_id)
    if row is None:
        raise LookupError(f"drawing not found: {drawing_id}")
    row.alignment = {ALIGNMENT_KEY: alignment.model_dump(mode="json"),
                     TRANSFORM_KEY: alignment_to_transform(alignment).model_dump(mode="json")}
    row.coordinate_system = alignment.to_coordinate_system().model_dump(mode="json")
    session.flush()
    return row


def load_alignment(session: Session, drawing_id: str) -> DrawingAlignment | None:
    row = session.get(DrawingRow, drawing_id)
    if row is None or not row.alignment or ALIGNMENT_KEY not in row.alignment:
        return None
    return DrawingAlignment.model_validate(row.alignment[ALIGNMENT_KEY])
