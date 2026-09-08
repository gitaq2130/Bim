from __future__ import annotations

import pytest

from packages.core.models.evidence import Evidence
from services.common import safe_expr
from services.common.safe_expr import (
    ExpressionEvalError,
    UnknownNameError,
    UnsafeExpressionError,
    evaluate,
    referenced_names,
    validate,
)

CTX = {
    "scan": {"state": "MISMATCH", "confidence": 0.8, "evidence": {"extra": {"offset_vector": [0.03, 0.04, 0.0]}}},
    "object": {"ifc_type": "IfcColumn", "level": "B1F"},
    "readiness": {"score": 0.4, "blockers": [1, 2]},
    "logic": {"days": 3, "ratio": None},
    "report": None,
}


@pytest.mark.parametrize(
    "expr, expected",
    [
        ("scan.state == 'MISMATCH'", True),
        ("scan.state != 'MISMATCH'", False),
        ("scan.evidence.offset_vector.norm > 0.049", True),          # 3-4-5 → 0.05 (extra 폴백)
        ("norm(scan.evidence.extra.offset_vector) == 0.05", True),
        ("scan['state'] == 'MISMATCH'", True),
        ("object.ifc_type in ['IfcColumn', 'IfcBeam']", True),
        ("object.ifc_type not in ('IfcSlab',)", True),
        ("readiness.score < 0.5 and logic.days <= 7", True),
        ("not (readiness.score < 0.5) or logic.days > 7", False),
        ("len(readiness.blockers) == 2", True),
        ("abs(-1.5) == 1.5 and min(1, 2) == 1 and max(1, 2) == 2", True),
        ("logic.ratio is None", True),
        ("logic.missing is None", True),                             # 없는 키 → None
        ("report.claimed_state is None", True),                      # None 위의 속성 → None
        ("scan.confidence * 2 - 0.6 >= 1.0", True),
        ("(readiness.score + 0.1) / 2 == 0.25", True),
        ("-logic.days == -3", True),
    ],
)
def test_allowed_expressions(expr, expected):
    validate(expr)
    assert evaluate(expr, CTX) is expected


@pytest.mark.parametrize(
    "expr",
    [
        "__import__('os').system('ls')",
        "open('/etc/passwd')",
        "(lambda: 1)()",
        "scan.__class__",
        "scan.__class__.__mro__",
        "object._private",
        "[x for x in scan]",
        "scan.state.upper()",
        "f'{scan.state}'",
        "scan.state if True else 1",
        "scan ** 2",
        "scan.state % 2",
        "len(scan, key=1)",
        "scan[object.ifc_type]",
        "x := 1",
        "import os",
        "",
    ],
)
def test_rejected_expressions(expr):
    with pytest.raises(UnsafeExpressionError):
        validate(expr)
    with pytest.raises(UnsafeExpressionError):
        evaluate(expr, CTX)


def test_unknown_name_is_unsafe():
    with pytest.raises(UnknownNameError):
        evaluate("nope == 1", CTX)


def test_none_semantics_and_eval_errors():
    # None 과의 크기 비교는 False, None 산술은 None (규칙 값 누락 → 조용히 불일치)
    assert evaluate("logic.ratio > 0.5", CTX) is False
    assert evaluate("logic.ratio * 2 is None", CTX) is True
    assert evaluate("'a' in logic.ratio", CTX) is False
    with pytest.raises(ExpressionEvalError):
        evaluate("1 / (logic.days - 3)", CTX)
    with pytest.raises(ExpressionEvalError):
        evaluate("scan.state + 1", CTX)


def test_pydantic_attribute_and_extra_fallback():
    ev = Evidence(source_type="scan", source_id="s1", extra={"offset_vector": (3.0, 4.0)})
    ctx = {"ev": ev}
    assert evaluate("ev.source_id == 's1'", ctx)
    assert evaluate("ev.offset_vector.norm == 5.0", ctx)
    assert evaluate("ev.file_uri is None", ctx)
    # 메서드(호출 가능 속성)는 값으로 노출하지 않는다
    with pytest.raises(UnsafeExpressionError):
        evaluate("ev.model_dump is None", ctx)


def test_referenced_names_excludes_calls():
    assert referenced_names("scan.state == 'X' and len(readiness.blockers) > norm(logic.v)") == [
        "scan",
        "readiness",
        "logic",
    ]


def test_module_has_no_eval_or_exec():
    import inspect

    src = inspect.getsource(safe_expr)
    assert "eval(" not in src.replace("_eval(", "").replace("evaluate(", "")
    assert "exec(" not in src
