"""문서관리대장 파서(services/progress/importers/document_register.py) 함정 회귀 — 담당: qa (ADR 0007 §2·§3).

`tests/fixtures/document_register.xlsx`에는 실제 현장 대장에서 관찰된 8개 함정이 의도적으로 심어져
있다(`document_register.expected.json`의 `cases` 키). 이 파일은 각각을 고정한다 — 정규화 규칙이나
컬럼 탐색 로직이 바뀌어 조용히 깨지면 여기서 잡혀야 한다.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.progress.importers.document_register import import_document_register

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PROJECT_ID = "P-DOC-PARSE"


@pytest.fixture(scope="module")
def expected() -> dict:
    return json.loads((FIXTURES / "document_register.expected.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def import_result():
    return import_document_register(FIXTURES / "document_register.xlsx", PROJECT_ID, "f-doc-parse")


@pytest.fixture(scope="module")
def by_doc_number(import_result):
    """doc_number 는 유니크 제약이 없지만(§2-1 규칙 3) 이 픽스처 안에서는 전부 유일하다."""
    return {d.doc_number: d for d in import_result.documents}


# ── 시트별 컬럼 위치(TFA 제목 H/처리결과 I, TFR 제목 G/처리결과 H) ──────────────────────────
def test_sheet_counts_match_layout(import_result, expected):
    """시트마다 제목/처리결과 열 위치가 다른데도(ADR §2-5) 올바른 문서 수를 읽는다."""
    assert import_result.sheet_counts.get("TFA") == expected["sheets"]["TFA"]
    assert import_result.sheet_counts.get("TFR") == expected["sheets"]["TFR"]


def test_tfr_title_and_result_read_from_correct_columns(by_doc_number):
    """TFR 시트는 제목 G열·처리결과 H열이다 — TFA(H/I)와 다른 위치를 정확히 찾아야 한다."""
    d = by_doc_number["동부-HG-TFR-구조-26-007"]
    assert d.title == "1F 기둥 콘크리트 배합설계서 제출"
    assert d.result_raw == "접수"
    assert d.approval_status.value == "IN_REVIEW"


# ── 함정 1: 처리결과 공란 → UNKNOWN (confidence 1.0, needs_review False) ───────────────────
def test_blank_result_is_unknown_with_full_confidence(by_doc_number, expected):
    doc_number = expected["cases"]["blank_result_is_unknown"]
    d = by_doc_number[doc_number]
    assert d.result_raw is None
    assert d.approval_status.value == "UNKNOWN"
    assert d.approval_confidence == 1.0
    assert d.needs_review is False
    assert d.approval_evidence.method == "register_status_blank"


# ── 함정 2: doc_number 의 공종 토큰과 실제 공종 열 값 불일치 → 컬럼 값을 신뢰 ────────────────
def test_discipline_token_conflict_trusts_column_not_doc_number(by_doc_number, import_result, expected):
    case = expected["cases"]["discipline_token_conflicts_with_column"]
    d = by_doc_number[case["doc_no"]]
    assert d.discipline_raw == case["column"]          # 컬럼 값(건축)을 신뢰
    assert d.discipline_raw != case["token"]            # doc_number 안의 토큰(토목)은 채택하지 않는다
    assert case["token"] in (d.doc_number or "")         # doc_number 원문에는 그대로 남아 있다(되파싱하지 않을 뿐)
    warnings = "\n".join(import_result.warning_messages)
    assert "doc_number_mismatch" in warnings and case["doc_no"] in warnings


# ── 함정 3: 처리결과 값에 앞뒤 공백(strip 후 규칙 매칭) ────────────────────────────────────
def test_result_with_padding_whitespace_is_stripped_before_matching(by_doc_number, expected):
    doc_number = expected["cases"]["result_needs_strip"]
    d = by_doc_number[doc_number]
    assert d.result_raw != d.result_raw.strip()          # 원문은 패딩을 보존한다(evidence.note 재료)
    assert d.result_raw.strip() == "검토중"
    assert d.approval_status.value == "IN_REVIEW"
    assert d.approval_evidence.rule_id == "DOCST-004"


# ── 함정 4: ZONE 만 다른 근접 중복 제목 — 정규화가 괄호를 지우지 않고 구분자로 살려야 한다 ───
def test_near_duplicate_titles_keep_distinct_zone_signal(by_doc_number, expected):
    doc_a, doc_b = expected["cases"]["near_duplicate_title_different_zone"]
    a, b = by_doc_number[doc_a], by_doc_number[doc_b]
    assert a.title_normalized != b.title_normalized
    # 괄호가 strip_chars 에서 구분자로 처리되어 "(z1)"/"(z2)" 가 독립 토큰으로 남아야 한다.
    assert " z1" in a.title_normalized.replace("(", " ").replace(")", " ") or "z1" in a.title_normalized.split()
    assert "z2" in b.title_normalized.split()
    assert "z1" in a.title_normalized.split()


# ── 함정 5: 공종 두 토큰(통신-품질) + 번호에 이미 숫자만 있는 경우 — doc_number 를 되파싱하지 않는다 ──
def test_two_token_discipline_and_prefilled_numeric_seq(by_doc_number, expected):
    case = expected["cases"]["two_token_discipline_and_date_number"]
    d = by_doc_number[case["doc_no"]]
    assert d.discipline_raw == "통신"                    # 컬럼 값 그대로. doc_number 의 "통신-품질" 을 합치지 않는다
    assert d.seq_raw == "260709" and d.seq_normalized == "260709"   # 자릿수를 재해석하지 않는다(§2-3)
    assert d.seq_normalized == case["number"]


# ── 함정 6: 날짜 셀 타입 혼재(문자열 vs datetime) ──────────────────────────────────────────
def test_date_cell_types_mixed_normalize_to_same_iso_format(by_doc_number):
    string_cell = by_doc_number["동부-HG-TFA-구조-26-049"]     # issued_on 원본이 문자열 "26-09-01"
    datetime_cell = by_doc_number["동부-HG-TFA-구조-26-052"]   # issued_on 원본이 엑셀 datetime 셀
    assert string_cell.issued_on == "2026-09-01"
    assert datetime_cell.issued_on == "2026-09-12"
    # 두 표현 모두 ISO date 문자열로 수렴해야 뒤섞인 셀 타입 때문에 date_window 매핑이 깨지지 않는다.
    for iso in (string_cell.issued_on, datetime_cell.issued_on):
        assert len(iso) == 10 and iso[4] == "-" and iso[7] == "-"


# ── 함정 7: 서식만 있는 빈 행(trailing) — 문서로 만들어지지 않는다 ─────────────────────────
def test_trailing_formatted_blank_rows_produce_no_documents(import_result, expected):
    assert import_result.sheet_counts["TFA"] == expected["sheets"]["TFA"]
    assert all(d.title.strip() for d in import_result.documents)   # 빈 제목 문서가 하나도 없다


# ── 함정 8: 데이터 없는 시트(NCR) — 헤더를 못 찾고 건너뛴다 ────────────────────────────────
def test_sheet_without_header_row_is_skipped_not_crashed(import_result, expected):
    assert expected["sheets"]["NCR"] == 0
    assert "NCR" not in import_result.sheet_counts
    assert not any(d.sheet_name == "NCR" for d in import_result.documents)
    warnings = "\n".join(import_result.warning_messages)
    assert "header_row_not_found" in warnings and "NCR" in warnings


# ── doc_id 결정성: 공종은 산출식에 관여하지 않는다(ADR §2-1 규칙 1) ────────────────────────
def test_doc_id_is_deterministic_and_ignores_discipline(tmp_path: Path):
    """협력사가 대장에 공종을 다르게 적어도(구조 vs 건축) 같은 문서로 남아야 한다.

    같은 발신·번호·제목을 가진 두 행을 공종만 다르게 만들어 실제 파서 경로로 확인한다
    (private 함수를 직접 부르지 않고 end-to-end 로 증명한다).
    """
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "TFA"
    ws.append(["No", "문서발생일", "발신", "공종", "번호", "문서번호", "제목", "처리결과", "처리완료일"])
    ws.append([1, "26-09-01", "동부", "구조", "9001", "동부-HG-TFA-구조-9001", "동일 문서 판정용 제목 (Z1)", "승인", "26-09-03"])
    ws.append([2, "26-09-01", "동부", "건축", "9001", "동부-HG-TFA-건축-9001", "동일 문서 판정용 제목 (Z1)", "승인", "26-09-03"])
    path = tmp_path / "discipline_variants.xlsx"
    wb.save(path)

    result = import_document_register(path, "P-DOCID", "f-docid-test")
    assert len(result.documents) == 2
    a, b = result.documents
    assert a.discipline_raw != b.discipline_raw   # 전제: 공종이 실제로 다르다
    assert a.doc_id == b.doc_id                    # 그런데도 doc_id 는 같다 — 공종은 정체성에 관여하지 않는다
