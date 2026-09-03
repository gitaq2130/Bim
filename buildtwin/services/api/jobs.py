"""비동기 작업 본체(동기 함수). Celery 태스크(tasks.py)가 감싼다. 서비스 함수를 호출하고 JobRow 를 갱신한다.

작업 종류(JobRow.kind, glossary "작업 종류"):
- ingest      : IFC → services.ingest.persistence.persist_ingest_result (재업로드·orphan 규칙은 ingest 소유)
                DXF/DWG → persist_drawing → 최신 모델과 2D↔3D 매핑(sync.run_build_mapping) → sync.rebuild_mappings
                RVT → APS 변환 시도, 불가 시 result.status = needs_ifc_export
- scan_upload : E57/LAS/PLY → ScanRow(정합 입력 대기). 판정은 /scans/{sid}/alignment → verdict 작업
- schedule    : CSV/XML/XER → progress.import_schedule + save_schedule + map_activities_to_objects
- mapping     : 도면 재정합 후 매핑 재구성(usecases.realign_drawing 가 동기 실행하며 기록)
- verdict     : scan.run_scan_pipeline → Registration/ScanVerdictRow 저장 → 상태기계 apply_scan_verdict → 3중 검증
- document_register : xlsx → progress.importers.document_register.import_document_register(파싱)
                → ingest.persistence.persist_document_register_import(적재·재업로드·orphan 규칙)
                → progress.document_mapper.map_project_documents(문서↔Activity 매핑 후보, 항상 needs_review=True)
                (ADR 0007 §2·§4). 헤더/필수 컬럼을 못 찾아 **어떤 시트도** 읽지 못하는 경우(422
                `document_register_invalid`)는 이 잡 실행 전에 업로드 라우트가 동기적으로 걸러낸다
                (routers/files.py — 이 코드는 HTTP 응답이라 비동기 잡 결과로는 표현할 수 없다). 이 러너는
                그 가드를 통과한 뒤에만 실행되므로 같은 파일을 여기서 다시 파싱해도 항상 문서가 나온다.
"""
from __future__ import annotations

import logging
import traceback
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from packages.core.db import session_scope
from packages.core.models.identity import BimObjectDraft, DrawingEntityDraft
from packages.core.models.ingest import FileKind
from packages.core.models.mapping import EntityObjectMapping
from packages.core.models.orm import DrawingEntityRow, DrawingRow, FileRow, JobRow, ScanRow, ScanVerdictRow
from packages.core.models.scan import AlignmentInput, Registration
from services.progress import infer_level
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
DOCUMENT_REGISTER_KINDS: frozenset[str] = frozenset({"xlsx"})
JOB_KINDS: tuple[str, ...] = ("ingest", "scan_upload", "schedule", "mapping", "verdict", "document_register")


class JobError(Exception):
    pass


def job_kind_for(file_kind: FileKind | str) -> str:
    if file_kind in INGEST_KINDS:
        return "ingest"
    if file_kind in SCAN_KINDS:
        return "scan_upload"
    if file_kind in SCHEDULE_KINDS:
        return "schedule"
    if file_kind in DOCUMENT_REGISTER_KINDS:
        return "document_register"
    raise JobError(f"unsupported file kind: {file_kind}")


def _warning(code: str, message: str, **context: Any) -> dict[str, Any]:
    return {"code": code, "message": message, "context": context}


def _set_job(job_id: str, **fields: Any) -> None:
    """짧은 세션으로 JobRow 를 갱신(작업 세션이 열리기 전/후에만 사용 — SQLite 쓰기 잠금 충돌 방지)."""
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


# ------------------------------------------------------------------ drawing entities (읽기)
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
    """sync.run_build_mapping → sync.save_alignment → sync.rebuild_mappings(매핑 생명주기·검토요청은 sync 소유).
    실패해도 예외 대신 결과 dict(status=failed)."""
    from services.sync.persistence import rebuild_mappings, save_alignment
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
    save_alignment(session, drawing.drawing_id, DrawingAlignment.model_validate(res["alignment"]))
    mappings = [EntityObjectMapping.model_validate(m) for m in res["mappings"]]
    rebuilt = rebuild_mappings(session, drawing.drawing_id, drawing.project_id, mappings, keep_confirmed=keep_confirmed)
    return {"status": "done", "alignment": res["alignment"], "grid_source": res.get("grid_source"), "level": drawing.level,
            "mapping_count": rebuilt.saved, "review_count": rebuilt.review_requests_created, "entity_count": len(entities),
            "object_count": len(objects), "warnings": list(res.get("warnings") or []), **rebuilt.model_dump()}


# ------------------------------------------------------------------ job runners
def run_ingest(session: Session, job: JobRow, file_row: FileRow, options: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict]]:
    from services.ingest import ingest_file, persist_drawing, persist_ingest_result

    path = _file_path(file_row)
    kind: FileKind = file_row.kind  # type: ignore[assignment]
    result = ingest_file(path, kind=kind, out_dir=path.parent)
    warnings = [w.model_dump(mode="json") for w in result.warnings]
    if result.status == "needs_ifc_export":
        msg = next((w.message for w in result.warnings), "RVT 는 IFC 내보내기가 필요합니다.")
        return "done", {"status": "needs_ifc_export", "source_kind": result.source_kind, "message": msg}, warnings
    if result.objects:
        persisted = persist_ingest_result(session, job.project_id, file_row.file_id, result)
        model = session.get(type(queries.latest_model(session, job.project_id)), persisted.model_id)
        summary = {"status": result.status, "source_kind": result.source_kind, **persisted.model_dump(),
                   "levels": list(result.levels), "stats": dict(result.stats), "mesh_uri": result.mesh_uri,
                   "coordinate_system": model.coordinate_system if model else result.coordinate_system.model_dump(mode="json")}
        return "done", summary, warnings
    if result.entities:
        level = options.get("level") or infer_level(file_row.filename)
        drawing_id = persist_drawing(session, job.project_id, file_row.file_id, result, level)
        drawing = session.get(DrawingRow, drawing_id)
        assert drawing is not None
        entities = drawing_entities(session, drawing_id)
        mapping = build_and_persist_mappings(session, job.job_id, drawing, entities, None)
        if mapping["status"] != "done":
            warnings.append(_warning("MAPPING_NOT_BUILT", str(mapping.get("reason")), drawing_id=drawing_id))
        for w in mapping.get("warnings") or []:
            warnings.append(_warning("MAPPING_WARNING", str(w), drawing_id=drawing_id))
        summary = {"status": result.status, "source_kind": result.source_kind, "drawing_id": drawing_id, "level": level,
                   "entity_count": len(result.entities), "stats": dict(result.stats),
                   "coordinate_system": drawing.coordinate_system, "mapping": mapping}
        return "done", summary, warnings
    msg = "; ".join(w.message for w in result.warnings) or "ingest produced no objects/entities"
    return "failed", {"status": result.status, "source_kind": result.source_kind, "message": msg}, warnings


def run_scan_upload(session: Session, job: JobRow, file_row: FileRow, options: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict]]:
    """스캔 파일 등록. 정합은 사용자 기준점 입력 후(/scans/{sid}/alignment → verdict 작업)."""
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


def run_document_register(session: Session, job: JobRow, file_row: FileRow, options: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict]]:
    """대장 xlsx → Document 적재 → 문서↔Activity 매핑 후보(ADR 0007 §2·§4). 세 서비스 함수를 순서대로 호출만
    한다(CLAUDE.md §3 규칙 11) — 정규화·재업로드/orphan 규칙·매핑 판정은 모두 그 함수들이 소유.
    "어떤 시트도 못 읽음"(422 document_register_invalid) 가드는 업로드 라우트가 이미 통과시켰으므로 여기서는
    다시 검사하지 않는다(재업로드 경쟁을 생각해도, 그 사이 파일이 바뀔 수 없다 — file_id 는 불변 저장 파일이다)."""
    from services.ingest.persistence import persist_document_register_import
    from services.progress.document_mapper import map_project_documents
    from services.progress.importers.document_register import import_document_register

    path = _file_path(file_row)
    import_result = import_document_register(path, job.project_id, file_row.file_id, file_uri=file_row.uri)
    persisted = persist_document_register_import(session, job.project_id, file_row.file_id, import_result)
    mappings = map_project_documents(session, job.project_id)
    warnings = [_warning("DOCUMENT_REGISTER_WARNING", w) for w in persisted.warnings]
    summary = {"status": "ok", "source_kind": file_row.kind, **persisted.model_dump(exclude={"warnings"}),
               "mapping_count": len(mappings), "mapping_needs_review_count": sum(1 for m in mappings if m.needs_review)}
    return "done", summary, warnings


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
    previous = queries.previous_verdicts(session, job.project_id, [r.global_id for r in rows], exclude_scan_id=scan_id)
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
        # ADR 0005: project_id 는 스캔(부모)의 프로젝트에서 유도한다.
        session.add(ScanVerdictRow(scan_id=scan_id, global_id=v.global_id, project_id=scan.project_id, state=v.state.value,
                                   confidence=v.confidence, evidence=v.evidence.model_dump(mode="json"),
                                   diff_from_previous=v.diff_from_previous.model_dump(mode="json") if v.diff_from_previous else None,
                                   created_at=now))
    session.flush()
    sm = ObjectStateMachine()
    transitions = 0
    reviews = 0
    for v in batch.verdicts:
        if sm.apply_scan_verdict(session, job.project_id, v) is not None:
            transitions += 1
        item = queries.latest_report_item(session, job.project_id, v.global_id)
        logic = build_logic_context(session, job.project_id, v.global_id, quantity_unit=item.quantity_unit if item else None)
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
            if job.kind == "verdict":
                status, result, warnings = run_verdict(session, job, options)
            elif job.kind in ("ingest", "scan_upload", "schedule", "document_register"):
                if file_row is None:
                    raise JobError(f"{job.kind} job has no file")
                runner = {"ingest": run_ingest, "scan_upload": run_scan_upload, "schedule": run_schedule,
                         "document_register": run_document_register}[job.kind]
                status, result, warnings = runner(session, job, file_row, options)
            else:
                raise JobError(f"unknown job kind: {job.kind} (expected one of {JOB_KINDS})")
            job.status, job.progress, job.result, job.warnings = status, 1.0, result, warnings
            job.result_ref = result.get("model_id") or result.get("drawing_id") or result.get("scan_id") or result.get("schedule_id") or job.result_ref
            job.error = result.get("message") if status == "failed" else None
            job.updated_at = datetime.now(UTC)
            return {"job_id": job_id, "status": status, "result": result, "warnings": warnings}
    except Exception as exc:  # noqa: BLE001 — 실패도 job 결과로 남긴다
        log.error("job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        _set_job(job_id, status="failed", error=f"{type(exc).__name__}: {exc}", progress=1.0)
        return {"job_id": job_id, "status": "failed", "error": str(exc)}
