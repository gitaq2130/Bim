"""ADR 0007 문서관리대장 테스트 공용 픽스처(qa 담당).

`Document`/`ActivityDocumentMapping` 을 xlsx 파싱을 거치지 않고 DB 행으로 직접 만들어, readiness·
verification 불변식 테스트가 원하는 조합(승인/반려/공란, 확정/미확정)을 짧게 구성할 수 있게 한다.
실제 파서 경로는 tests/unit/progress/test_document_register_parser.py 가 별도로 고정한다.
"""
from __future__ import annotations

from datetime import UTC, datetime

from packages.core.models.evidence import Evidence
from packages.core.models.orm import ActivityDocumentMappingRow, DocumentRow, FileRow

_DOC_FILE_KIND = "xlsx"


def ensure_document_file(session, project_id: str, file_id: str = "FILE-DOC-REG") -> FileRow:
    """DocumentRow.file_id FK 를 만족시키는 자리표시 FileRow. 이미 있으면 재사용."""
    row = session.get(FileRow, file_id)
    if row is not None:
        return row
    row = FileRow(file_id=file_id, project_id=project_id, kind=_DOC_FILE_KIND, filename="document_register.xlsx",
                 uri=f"mem://{file_id}", sha256="0" * 64, size=1)
    session.add(row)
    session.flush()
    return row


def make_document(
    session, project_id: str, doc_id: str, *, doc_type: str = "TFA", title: str = "테스트 문서",
    result_raw: str | None = "승인", approval_status: str = "APPROVED", approval_confidence: float = 0.95,
    needs_review: bool = False, is_orphaned: bool = False, file_id: str = "FILE-DOC-REG",
    sheet_name: str = "TFA", source_row: int = 4, doc_number: str | None = None,
) -> DocumentRow:
    """`DocumentRow`를 직접 만든다(파서를 거치지 않는다) — readiness/verification 불변식 테스트 전용."""
    ensure_document_file(session, project_id, file_id)
    row = DocumentRow(
        project_id=project_id, doc_id=doc_id, doc_type=doc_type, sender="동부", sender_normalized="동부건설",
        discipline_raw=None, discipline_normalized=None, seq_raw=None, seq_normalized=None,
        doc_number=doc_number or doc_id, title=title, title_normalized=title.lower(), issued_on=None,
        result_raw=result_raw, approval_status=approval_status, approval_confidence=approval_confidence,
        approval_evidence=Evidence(source_type="document", source_id=file_id, method="register_status_rule",
                                   extra={"sheet": sheet_name, "row": source_row}).model_dump(mode="json"),
        completed_on=None, file_id=file_id, sheet_name=sheet_name, source_row=source_row,
        needs_review=needs_review, is_orphaned=is_orphaned, imported_at=datetime.now(UTC),
    )
    session.add(row)
    session.flush()
    return row


def make_mapping(
    session, project_id: str, activity_id: str, doc_id: str, *, confidence: float = 0.9,
    needs_review: bool = True, reviewed_by: str | None = None,
) -> ActivityDocumentMappingRow:
    """`ActivityDocumentMappingRow`를 직접 만든다. `needs_review`/`reviewed_by`는 호출자가 명시적으로 준다 —
    이 헬퍼는 DB 행 빌더일 뿐이라 ADR §4 규칙 5(모델 검증기)를 우회할 수 있다는 점에 주의(그래서
    `test_document_mapper_invariants.py` 가 모델 검증기 자체를 별도로 고정한다)."""
    row = ActivityDocumentMappingRow(
        activity_id=activity_id, doc_id=doc_id, project_id=project_id, confidence=confidence,
        evidence=Evidence(source_type="document", source_id=doc_id, method="document_title_match").model_dump(mode="json"),
        needs_review=needs_review, reviewed_by=reviewed_by,
    )
    session.add(row)
    session.flush()
    return row


__all__ = ["ensure_document_file", "make_document", "make_mapping"]
