"""비동기 작업 본체(동기 함수). Celery 태스크(tasks.py)가 감싼다. 서비스 함수를 호출하고 결과를 DB 에 저장한다.

작업 종류(JobRow.kind):
- ingest      : IFC → ModelRow + BimObjectRow(PLANNED, 재업로드 시 상태 유지·model_version 증가·누락은 is_orphaned)
                DXF/DWG → DrawingRow + DrawingEntityRow → 최신 모델에 대해 2D↔3D 매핑 자동 실행(+ 검토요청)
                RVT → APS 변환 시도, 불가 시 result.status = needs_ifc_export
- registration: E57/LAS/PLY → ScanRow(정합 입력 대기). 판정은 /scans/{sid}/alignment → verdict 작업
- schedule    : CSV/XML/XER → Schedule/Activity/Relation + Activity↔객체 매핑
- verdict     : run_scan_pipeline → Registration/ScanVerdictRow 저장 → 상태기계 apply_scan_verdict → 3중 검증
"""
from __future__ import annotations

import logging
import re
import traceback
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from packages.core.db import session_scope
from packages.core.models.identity import BimObjectDraft, DrawingEntityDraft
from packages.core.models.ingest import FileKind, IngestResult
from packages.core.models.mapping import EntityObjectMapping
from packages.core.models.orm import (
    BimObjectRow,
    DrawingEntityRow,
    DrawingRow,
    FileRow,
    JobRow,
    ModelRow,
    ScanRow,
    ScanVerdictRow,
)
from packages.core.models.scan import AlignmentInput, Registration, ScanVerdict
from packages.core.models.state import ObjectState
from services.progress import persistence as db
from services.progress.activity_mapper import map_activities_to_objects
from services.progress.importers import import_schedule
from services.progress.state_machine import ObjectStateMachine
from services.progress.verification import build_logic_context, run_verification

from . import queries
from .storage import resolve_local_path

log = logging.getLogger(__name__)

INGEST_KINDS: frozenset[str] = frozenset({"ifc", "dxf", "dwg", "rvt"})
SCAN_KINDS: frozenset[str] = frozenset({"e57", "las", "ply"})
SCHEDULE_KINDS: frozenset[str] = frozenset({"csv", "xml", "xer"})
SCHEDULE_FORMAT: dict[str, str] = {"csv": "csv", "xml": "msproject_xml", "xer": "p6_xer"}
_LEVEL_RE = re.compile(r"(?<![A-Za-z0-9])(B\d{1,2}F?|\d{1,2}F|RF|PH)(?![A-Za-z0-9])", re.IGNORECASE)


class JobError(Exception):
    pass


def job_kind_for(file_kind: FileKind | str) -> str:
    if file_kind in INGEST_KINDS:
        return "ingest"
    if file_kind in SCAN_KINDS:
        return "registration"
    if file_kind in SCHEDULE_KINDS:
        return "schedule"
    raise JobError(f"unsupported file kind: {file_kind}")


def infer_level_from_filename(name: str) -> str | None:
    """'plan_1F.dxf' → '1F', 'B1_전기.dxf' → 'B1'. 없으면 None."""
    m = _LEVEL_RE.search(Path(name).stem)
    return m.group(1).upper() if m else None


def _warning(code: str, message: str, **context: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "context": context}


def _set_job(job_id: str, **fields: Any) -> None:
    """짧은 세션으로 JobRow 를 갱신(진행률이 폴링에 즉시 보이도록)."""
    with session_scope() as s:
        job = s.get(JobRow, job_id)
        if job is None:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        job.updated_at = datetime.now(UTC)


def _file_path(file_row: FileRow) -> Path:
    p = resolve_local_path(file_row.uri)
    if p is None:
        raise JobError(f"stored file not found: {file_row.uri}")
    return p


# ------------------------------------------------------------------ ingest: model
def persist_model(session: Session, project_id: str, file_row: FileRow, result: IngestResult) -> tuple[ModelRow, dict[str, Any]]:
    """ADR 0001 §1: 같은 GlobalId 는 같은 객체(상태·이력 유지, 기하 갱신), 사라진 객체는 is_orphaned."""
    prev = queries.latest_model(session, project_id)
    version = (prev.version + 1) if prev else 1
    model = ModelRow(model_id=f"m-{uuid.uuid4().hex[:12]}", project_id=project_id, file_id=file_row.file_id, version=version,
                     coordinate_system=result.coordinate_system.model_dump(mode="json"), levels=list(result.levels),
                     mesh_uri=result.mesh_uri, stats=dict(result.stats))
    session.add(model)
    session.flush()
    existing = {r.global_id: r for r in queries.project_objects(session, project_id, include_orphaned=True)}
    created = updated = 0
    seen: set[str] = set()
    for d in result.objects:
        seen.add(d.global_id)
        row = existing.get(d.global_id)
        if row is None:
            row = BimObjectRow(global_id=d.global_id, project_id=project_id, model_id=model.model_id, ifc_type=d.ifc_type,
                               state=ObjectState.PLANNED.value)
            session.add(row)
            created += 1
        else:
            updated += 1
        row.model_id, row.model_version, row.ifc_type, row.is_orphaned = model.model_id, version, d.ifc_type, False
        row.name, row.level, row.level_elevation, row.zone = d.name, d.level, d.level_elevation, d.zone
        row.bbox = d.bbox.model_dump(mode="json") if d.bbox is not None else None
        row.mesh_ref, row.psets, row.material, row.quantity, row.express_id = d.mesh_ref, d.psets, d.material, d.quantity, d.express_id
    orphaned = [gid for gid, row in existing.items() if gid not in seen and not row.is_orphaned]
    for gid in orphaned:
        existing[gid].is_orphaned = True
    session.flush()
    summary = {"status": result.status, "source_kind": result.source_kind, "model_id": model.model_id, "version": version,
               "object_count": len(result.objects), "created": created, "updated": updated, "orphaned": len(orphaned),
               "orphaned_global_ids": orphaned[:100], "levels": list(result.levels), "stats": dict(result.stats),
               "mesh_uri": result.mesh_uri, "coordinate_system": model.coordinate_system}
    return model, summary


# ------------------------------------------------------------------ ingest: drawing
def persist_drawing(session: Session, project_id: str, file_row: FileRow, result: IngestResult, level: str | None) -> DrawingRow:
    drawing = DrawingRow(drawing_id=f"d-{uuid.uuid4().hex[:12]}", project_id=project_id, file_id=file_row.file_id, level=level,
                         coordinate_system=result.coordinate_system.model_dump(mode="json"), stats=dict(result.stats))
    session.add(drawing)
    for e in result.entities:
        session.add(DrawingEntityRow(
            drawing_id=drawing.drawing_id, handle=e.handle, layer=e.layer, dxftype=e.dxftype,
            points=[list(p) for p in e.points], bbox=e.bbox.model_dump(mode="json") if e.bbox else None,
            block_name=e.block_name, insert_point=list(e.insert_point) if e.insert_point else None,
            rotation_deg=e.rotation_deg, scale=list(e.scale) if e.scale else None, text=e.text, radius=e.radius,
            attrs=dict(e.attrs),
        ))
    session.flush()
    return drawing


def entity_row_to_draft(r: DrawingEntityRow) -> DrawingEntityDraft:
    return DrawingEntityDraft(
        handle=r.handle, layer=r.layer, dxftype=r.dxftype, points=[tuple(p) for p in (r.points or [])],  # type: ignore[misc]
        bbox=r.bbox, block_name=r.block_name, insert_point=tuple(r.insert_point) if r.insert_point else None,  # type: ignore[arg-type]
        rotation_deg=r.rotation_deg, scale=tuple(r.scale) if r.scale else None, text=r.text, radius=r.radius,  # type: ignore[arg-type]
        attrs=dict(r.attrs or {}),
    )


def drawing_entities(session: Session, drawing_id: str) -> list[DrawingEntityDraft]:
    rows = session.scalars(select(DrawingEntityRow).where(DrawingEntityRow.drawing_id == drawing_id).order_by(DrawingEntityRow.handle))
    return [entity_row_to_draft(r) for r in rows]


def build_and_persist_mappings(session: Session, job_id: str, drawing: DrawingRow, entities: list[DrawingEntityDraft],
                               alignment_json: dict[str, Any] | None, keep_confirmed: bool = True) -> dict[str, Any]:
    """sync.run_build_mapping 호출 → 정합·매핑·검토요청 저장. 실패해도 예외 대신 결과 dict(status=failed)."""
    from services.sync.persistence import save_alignment, save_mappings
    from services.sync.review_queue import mappings_needing_review
    from services.sync.tasks import run_build_mapping
    from services.sync.transform import DrawingAlignment

    model = queries.latest_model(session, drawing.project_id)
    if model is None:
        return {"status": "skipped", "reason": "no model in project; upload an IFC first", "mapping_count": 0, "review_count": 0}
    objects = [o for o in queries.as_models(queries.model_objects(session, model.model_id)) if o.bbox is not None]
    unit_scale = float((drawing.coordinate_system or {}).get("scale") or 1.0)
    res = run_build_mapping(job_id, drawing.drawing_id, [e.model_dump(mode="json") for e in entities],
                            [BimObjectDraft.model_validate(o.model_dump()).model_dump(mode="json") for o in objects],
                            alignment_json, drawing.level, {"project_id": drawing.project_id}, unit_scale, persist=False)
    if res.get("status") != "done":
        return {"status": "failed", "reason": res.get("error"), "mapping_count": 0, "review_count": 0,
                "warnings": list(res.get("warnings") or [])}
    alignment = DrawingAlignment.model_validate(res["alignment"])
    save_alignment(session, drawing.drawing_id, alignment)
    mappings = [EntityObjectMapping.model_validate(m) for m in res["mappings"]]
    from packages.core.models.orm import EntityObjectMappingRow, ReviewRequestRow

    confirmed_handles: set[str] = set()
    if keep_confirmed:
        confirmed_handles = {r.entity_handle for r in session.scalars(select(EntityObjectMappingRow).where(
            EntityObjectMappingRow.drawing_id == drawing.drawing_id, EntityObjectMappingRow.reviewed_by.is_not(None)))}
    session.execute(delete(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == drawing.drawing_id,
                                                          EntityObjectMappingRow.reviewed_by.is_(None)))
    mappings = [m for m in mappings if m.entity_handle not in confirmed_handles]
    save_mappings(session, mappings, replace=False)
    # 이전 자동 생성 매핑 검토요청은 재정합으로 대체됨
    for old in session.scalars(select(ReviewRequestRow).where(ReviewRequestRow.project_id == drawing.project_id,
                                                              ReviewRequestRow.kind == "mapping", ReviewRequestRow.status == "open")):
        if (old.conflicting_sources or {}).get("drawing_id") == drawing.drawing_id:
            old.status, old.resolved_by, old.resolved_at = "rejected", "system", datetime.now(UTC)
            old.resolution_note = f"superseded by mapping rebuild (job {job_id})"
    reviews = mappings_needing_review(mappings, project_id=drawing.project_id)
    for review in reviews:
        db.save_review_request(session, review)
    session.flush()
    return {"status": "done", "alignment": res["alignment"], "grid_source": res.get("grid_source"), "level": drawing.level,
            "mapping_count": len(mappings), "review_count": len(reviews), "entity_count": len(entities),
            "object_count": len(objects), "kept_confirmed": len(confirmed_handles), "warnings": list(res.get("warnings") or [])}


# ------------------------------------------------------------------ job runners
def run_ingest(session: Session, job: JobRow, file_row: FileRow, options: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict]]:
    from services.ingest import ingest_file

    path = _file_path(file_row)
    kind: FileKind = file_row.kind  # type: ignore[assignment]
    result = ingest_file(path, kind=kind, out_dir=path.parent)
    warnings = [w.model_dump(mode="json") for w in result.warnings]
    if result.status == "needs_ifc_export":
        msg = next((w.message for w in result.warnings), "RVT 는 IFC 내보내기가 필요합니다.")
        return "done", {"status": "needs_ifc_export", "source_kind": result.source_kind, "message": msg}, warnings
    if result.objects:
        _, summary = persist_model(session, job.project_id, file_row, result)
        return "done", summary, warnings
    if result.entities:
        level = options.get("level") or infer_level_from_filename(file_row.filename)
        drawing = persist_drawing(session, job.project_id, file_row, result, level)
        entities = drawing_entities(session, drawing.drawing_id)
        mapping = build_and_persist_mappings(session, job.job_id, drawing, entities, None)
        if mapping["status"] != "done":
            warnings.append(_warning("MAPPING_NOT_BUILT", str(mapping.get("reason")), drawing_id=drawing.drawing_id))
        for w in mapping.get("warnings") or []:
            warnings.append(_warning("MAPPING_WARNING", str(w), drawing_id=drawing.drawing_id))
        summary = {"status": result.status, "source_kind": result.source_kind, "drawing_id": drawing.drawing_id, "level": level,
                   "entity_count": len(result.entities), "stats": dict(result.stats),
                   "coordinate_system": drawing.coordinate_system, "mapping": mapping}
        return "done", summary, warnings
    msg = "; ".join(w.message for w in result.warnings) or "ingest produced no objects/entities"
    return "failed", {"status": result.status, "source_kind": result.source_kind, "message": msg}, warnings


def run_registration(session: Session, job: JobRow, file_row: FileRow, options: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict]]:
    """스캔 파일 등록. 정합은 사용자 기준점 입력 후(/scans/{sid}/alignment)."""
    warnings: list[dict] = []
    path = _file_path(file_row)
    model = queries.latest_model(session, job.project_id)
    scan_id = f"s-{uuid.uuid4().hex[:12]}"
    point_count: int | None = None
    try:
        from services.scan.loader import load_point_cloud

        point_count = load_point_cloud(path).point_count
    except Exception as exc:  # noqa: BLE001 — 포맷 오류는 경고로 남기고 등록은 진행
        warnings.append(_warning("POINT_CLOUD_LOAD_FAILED", str(exc), path=str(path)))
    registration = Registration(scan_id=scan_id, status="needs_alignment_input",
                                message="기준점(≥3) 또는 마커(≥3) 좌표를 입력하면 정합·판정을 시작합니다.")
    session.add(ScanRow(scan_id=scan_id, project_id=job.project_id, file_id=file_row.file_id,
                        model_id=model.model_id if model else None, registration=registration.model_dump(mode="json"),
                        point_count=point_count))
    session.flush()
    if model is None:
        warnings.append(_warning("NO_MODEL", "프로젝트에 모델(IFC)이 없어 판정 대상 객체가 없습니다.", project_id=job.project_id))
    return "done", {"status": "needs_alignment_input", "source_kind": file_row.kind, "scan_id": scan_id,
                    "point_count": point_count, "model_id": model.model_id if model else None}, warnings


def run_schedule(session: Session, job: JobRow, file_row: FileRow, options: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict]]:
    path = _file_path(file_row)
    schedule = import_schedule(path, job.project_id, fmt=SCHEDULE_FORMAT.get(file_row.kind))
    db.save_schedule(session, schedule)
    objects = queries.as_models(queries.project_objects(session, job.project_id))
    mappings = map_activities_to_objects(schedule, objects)
    db.save_mappings(session, mappings)
    warnings = [_warning("SCHEDULE_WARNING", w) for w in schedule.warnings]
    if not objects:
        warnings.append(_warning("NO_MODEL", "프로젝트에 객체가 없어 Activity↔객체 매핑이 비어 있습니다."))
    return "done", {"status": "ok", "source_kind": file_row.kind, "schedule_id": schedule.schedule_id,
                    "source_format": schedule.source_format, "activity_count": len(schedule.activities),
                    "relation_count": len(schedule.relations), "mapping_count": len(mappings),
                    "needs_review_count": sum(1 for m in mappings if m.needs_review)}, warnings


def run_verdict(session: Session, job: JobRow, options: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict]]:
    """정합 + 객체 판정 + 상태기계 + 3중 검증. scan 모듈은 지연 import(테스트 격리)."""
    from services.scan.pipeline import run_scan_pipeline

    scan_id = str(options.get("scan_id") or job.result_ref or "")
    scan = session.get(ScanRow, scan_id)
    if scan is None:
        raise JobError(f"scan not found: {scan_id}")
    file_row = session.get(FileRow, scan.file_id)
    if file_row is None:
        raise JobError(f"scan file not found: {scan.file_id}")
    if not scan.alignment_input:
        raise JobError("alignment input missing; POST /scans/{sid}/alignment first")
    alignment = AlignmentInput.model_validate(scan.alignment_input)
    rows = [r for r in queries.project_objects(session, job.project_id) if r.bbox]
    if not rows:
        raise JobError("no objects with geometry in project; upload an IFC first")
    specs = [{"global_id": r.global_id, "bbox": r.bbox, "ifc_type": r.ifc_type} for r in rows]
    previous = queries.previous_verdicts(session, [r.global_id for r in rows], exclude_scan_id=scan_id)
    job.progress = 0.3   # 같은 세션 안에서만 갱신(별도 세션은 SQLite 쓰기 잠금과 충돌)
    batch = run_scan_pipeline(_file_path(file_row), alignment, specs, scan_id, previous=previous or None)
    scan.registration = batch.registration.model_dump(mode="json")
    session.flush()
    warnings: list[dict] = []
    if batch.registration.status != "ok":
        return "failed", {"status": batch.registration.status, "scan_id": scan_id, "message": batch.registration.message,
                          "registration": scan.registration, "stats": batch.stats}, warnings
    job.progress = 0.7
    session.execute(delete(ScanVerdictRow).where(ScanVerdictRow.scan_id == scan_id))
    now = datetime.now(UTC)
    for v in batch.verdicts:
        session.add(ScanVerdictRow(scan_id=scan_id, global_id=v.global_id, state=v.state.value, confidence=v.confidence,
                                   evidence=v.evidence.model_dump(mode="json"),
                                   diff_from_previous=v.diff_from_previous.model_dump(mode="json") if v.diff_from_previous else None,
                                   created_at=now))
    session.flush()
    sm = ObjectStateMachine()
    transitions = 0
    reviews = 0
    for v in batch.verdicts:
        t = sm.apply_scan_verdict(session, v)
        if t is not None:
            transitions += 1
        item = queries.latest_report_item(session, job.project_id, v.global_id)
        logic = build_logic_context(session, v.global_id, quantity_unit=item.quantity_unit if item else None)
        reviews += len(run_verification(session, job.project_id, v.global_id, item, v, logic))
    summary = {"status": "ok", "scan_id": scan_id, "registration": scan.registration, "stats": batch.stats,
               "bbox_margin": batch.bbox_margin, "verdict_count": len(batch.verdicts), "transition_count": transitions,
               "review_request_count": reviews}
    return "done", summary, warnings


def run_job(job_id: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    """JobRow.kind 로 분기. 예외는 job.status=failed 로 기록하고 다시 던지지 않는다."""
    options = dict(options or {})
    _set_job(job_id, status="running", progress=0.05, error=None)
    try:
        with session_scope() as session:
            job = session.get(JobRow, job_id)
            if job is None:
                raise JobError(f"job not found: {job_id}")
            file_row = session.get(FileRow, job.file_id) if job.file_id else None
            if job.kind == "ingest":
                if file_row is None:
                    raise JobError("ingest job has no file")
                status, result, warnings = run_ingest(session, job, file_row, options)
            elif job.kind == "registration":
                if file_row is None:
                    raise JobError("registration job has no file")
                status, result, warnings = run_registration(session, job, file_row, options)
            elif job.kind == "schedule":
                if file_row is None:
                    raise JobError("schedule job has no file")
                status, result, warnings = run_schedule(session, job, file_row, options)
            elif job.kind == "verdict":
                status, result, warnings = run_verdict(session, job, options)
            else:
                raise JobError(f"unknown job kind: {job.kind}")
            job.status, job.progress, job.result, job.warnings = status, 1.0, result, warnings
            job.result_ref = result.get("model_id") or result.get("drawing_id") or result.get("scan_id") or result.get("schedule_id") or job.result_ref
            job.error = result.get("message") if status == "failed" else None
            job.updated_at = datetime.now(UTC)
            return {"job_id": job_id, "status": status, "result": result, "warnings": warnings}
    except Exception as exc:  # noqa: BLE001 — 실패도 job 결과로 남긴다
        log.error("job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        _set_job(job_id, status="failed", error=f"{type(exc).__name__}: {exc}", progress=1.0)
        return {"job_id": job_id, "status": "failed", "error": str(exc)}


def apply_verdict_models(session: Session, project_id: str, verdicts: list[ScanVerdict]) -> int:
    """(테스트·재적용용) 저장된 판정을 상태기계에 다시 적용한다."""
    sm = ObjectStateMachine()
    return sum(1 for v in verdicts if sm.apply_scan_verdict(session, v) is not None)
