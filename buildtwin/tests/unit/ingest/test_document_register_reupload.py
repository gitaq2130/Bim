"""persist_document_register_import 재업로드 규칙 — ADR 0007 §2-2 규칙 2 (doc_type 스코프 orphan).

핵심 회귀: TFA 시트만 재업로드하면 이번 업로드에 없는 TFA 문서만 orphan 되고, 업로드에 아예 등장하지
않은 doc_type(TFR)의 문서는 절대 건드리지 않는다 — "TFA 시트만 올렸다고 TFR 전체가 고아가 되면 안 된다".
"""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import openpyxl
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from packages.core.models.orm import Base, DocumentRow
from services.ingest.persistence import persist_document_register_import
from services.progress.importers.document_register import import_document_register

from .conftest import make_file, make_project

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PROJECT = "p-doc-reupload"


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as s:
        make_project(s, PROJECT, name="doc reupload test")
        for fid in ("f-doc-1", "f-doc-2"):
            make_file(s, fid, PROJECT, kind="xlsx")
        yield s


def _documents(session: Session) -> dict[str, DocumentRow]:
    return {r.doc_id: r for r in session.scalars(select(DocumentRow).where(DocumentRow.project_id == PROJECT))}


def _make_reduced_tfa_only_workbook(path: Path) -> None:
    """원본 대장에서 TFR 시트를 통째로 빼고, TFA 시트도 처음 두 문서(049·050)만 남긴다."""
    wb = openpyxl.load_workbook(FIXTURES / "document_register.xlsx", data_only=True)
    del wb["TFR"]
    ws = wb["TFA"]
    last_row = ws.max_row
    ws.delete_rows(6, last_row - 5)   # 헤더(1-3)+행4·5(049·050)만 남기고 나머지 삭제
    wb.save(path)


def test_first_upload_creates_all_documents_none_orphaned(session: Session) -> None:
    parsed = import_document_register(FIXTURES / "document_register.xlsx", PROJECT, "f-doc-1")
    summary = persist_document_register_import(session, PROJECT, "f-doc-1", parsed)
    assert summary.created == 10 and summary.updated == 0 and summary.orphaned == 0
    rows = _documents(session)
    assert len(rows) == 10
    assert all(not r.is_orphaned for r in rows.values())
    assert sum(1 for r in rows.values() if r.doc_type == "TFA") == 8
    assert sum(1 for r in rows.values() if r.doc_type == "TFR") == 2


def test_tfa_only_reupload_orphans_missing_tfa_but_leaves_tfr_untouched(session: Session, tmp_path: Path) -> None:
    first_parsed = import_document_register(FIXTURES / "document_register.xlsx", PROJECT, "f-doc-1")
    persist_document_register_import(session, PROJECT, "f-doc-1", first_parsed)
    before = _documents(session)
    tfr_ids_before = {doc_id for doc_id, r in before.items() if r.doc_type == "TFR"}
    assert len(tfr_ids_before) == 2 and all(not before[d].is_orphaned for d in tfr_ids_before)

    reduced_path = tmp_path / "tfa_only_reduced.xlsx"
    _make_reduced_tfa_only_workbook(reduced_path)
    second_parsed = import_document_register(reduced_path, PROJECT, "f-doc-2")
    assert {d.doc_type.value for d in second_parsed.documents} == {"TFA"}   # 이번 업로드에는 TFA 만 등장
    assert len(second_parsed.documents) == 2

    summary = persist_document_register_import(session, PROJECT, "f-doc-2", second_parsed)
    assert summary.created == 0 and summary.updated == 2   # 049·050 은 기존 문서를 갱신할 뿐
    assert summary.orphaned == 6                             # TFA 의 나머지 6건만 orphan

    after = _documents(session)
    assert len(after) == 10   # 행 삭제 없음(ADR §2-2 규칙 2)

    tfa_rows = {d: r for d, r in after.items() if r.doc_type == "TFA"}
    orphaned_tfa = {d for d, r in tfa_rows.items() if r.is_orphaned}
    kept_tfa = {d for d, r in tfa_rows.items() if not r.is_orphaned}
    assert len(orphaned_tfa) == 6 and len(kept_tfa) == 2
    kept_doc_numbers = {tfa_rows[d].doc_number for d in kept_tfa}
    assert kept_doc_numbers == {"동부-HG-TFA-구조-26-049", "동부-HG-TFA-구조-26-050"}

    # 핵심 회귀: TFR 문서는 이번 업로드에 doc_type 자체가 등장하지 않았으므로 절대 건드리지 않는다.
    tfr_rows = {d: r for d, r in after.items() if r.doc_type == "TFR"}
    assert set(tfr_rows) == tfr_ids_before
    assert all(not r.is_orphaned for r in tfr_rows.values())
    assert summary.orphaned_doc_ids and all(tfa_rows[d].doc_type == "TFA" for d in summary.orphaned_doc_ids)


def test_reappearing_document_clears_orphan_flag(session: Session, tmp_path: Path) -> None:
    """orphan 은 삭제가 아니라 표시일 뿐이다 — 다시 나타나면 해제된다(ADR §2-2 규칙 2)."""
    first_parsed = import_document_register(FIXTURES / "document_register.xlsx", PROJECT, "f-doc-1")
    persist_document_register_import(session, PROJECT, "f-doc-1", first_parsed)

    reduced_path = tmp_path / "tfa_only_reduced.xlsx"
    _make_reduced_tfa_only_workbook(reduced_path)
    second_parsed = import_document_register(reduced_path, PROJECT, "f-doc-2")
    persist_document_register_import(session, PROJECT, "f-doc-2", second_parsed)
    some_orphaned = next(d for d, r in _documents(session).items() if r.doc_type == "TFA" and r.is_orphaned)
    assert _documents(session)[some_orphaned].is_orphaned is True

    third_parsed = import_document_register(FIXTURES / "document_register.xlsx", PROJECT, "f-doc-1")
    third_summary = persist_document_register_import(session, PROJECT, "f-doc-1", third_parsed)
    assert third_summary.unorphaned >= 1 and some_orphaned in third_summary.unorphaned_doc_ids
    assert _documents(session)[some_orphaned].is_orphaned is False
