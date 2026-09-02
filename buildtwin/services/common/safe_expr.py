"""안전한 식 평가기 (eval/exec 미사용). 작성: progress-engine, knowledge가 재사용·확장.

rules/*.yaml의 `when` 조건식(verification.yaml, risk/*.yaml)을 평가한다.
`ast.parse(expr, mode="eval")`로 파싱한 뒤 허용목록(allow-list) 노드만 직접 걸어서 평가한다.

지원 문법
  - 비교: ==, !=, <, <=, >, >=, in, not in, is, is not
  - 논리: and, or, not (단락 평가)
  - 산술: +, -, *, / (단항 -)
  - 리터럴: 숫자, 문자열, True/False/None, 리스트/튜플 리터럴(원소도 허용 노드)
  - 이름·속성 접근: report.claimed_state, scan.evidence.offset_vector (dict 키 또는 객체 속성; 없으면 None)
    · dict/pydantic 모델에 키가 없고 `extra`(dict)가 있으면 그 안에서도 찾는다(Evidence.extra 단축 참조)
    · 리스트/튜플의 `.norm`은 유클리드 길이
  - 상수 키 인덱싱: scan['state'], vec[0]
  - 함수 호출: len, abs, min, max, norm 만
그 외(lambda, comprehension, f-string, `__import__`, 임의 함수 호출, dunder/private 속성 등)는
`UnsafeExpressionError`. 규칙 값 누락 시 조용히 불일치가 되도록:
  - None 과의 크기 비교(<, <= …)는 False, None 산술은 None, 없는 속성/키는 None.
"""
from __future__ import annotations

import ast
import math
from collections.abc import Callable, Mapping, Sequence
from enum import Enum
from typing import Any

__all__ = [
    "SafeExprError",
    "UnsafeExpressionError",
    "UnknownNameError",
    "ExpressionEvalError",
    "compile_expr",
    "evaluate",
    "validate",
    "referenced_names",
    "norm",
]

MAX_EXPR_LENGTH = 2000


class SafeExprError(ValueError):
    """식 문법 오류 또는 평가 중 오류(공통 베이스)."""


class UnsafeExpressionError(SafeExprError):
    """허용되지 않은 문법/토큰이 포함된 표현식."""


class UnknownNameError(UnsafeExpressionError):
    """컨텍스트에 없는 이름을 참조했다."""


class ExpressionEvalError(SafeExprError):
    """문법은 허용되지만 값 때문에 평가에 실패했다(0 나누기, 타입 불일치 등)."""


_BOOL_OPS = (ast.And, ast.Or)
_UNARY_OPS = (ast.Not, ast.USub)
_CMP_OPS = (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Is, ast.IsNot)
_ORDER_OPS = (ast.Lt, ast.LtE, ast.Gt, ast.GtE)
_BIN_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div)
_CONST_TYPES = (str, int, float, bool, type(None))


def norm(vector: Any) -> float | None:
    """리스트/튜플의 유클리드 길이. None이면 None."""
    if vector is None:
        return None
    if isinstance(vector, (str, bytes)) or not isinstance(vector, Sequence):
        raise ExpressionEvalError(f"norm() expects a list/tuple, got {type(vector).__name__}")
    try:
        return math.sqrt(sum(float(x) ** 2 for x in vector))
    except (TypeError, ValueError) as e:
        raise ExpressionEvalError(f"norm() on non-numeric vector: {e}") from e


_ALLOWED_CALLS: dict[str, Callable[..., Any]] = {"len": len, "abs": abs, "min": min, "max": max, "norm": norm}


# --------------------------------------------------------------------------- 파싱·검증

def _parse(expr: str) -> ast.expr:
    if not isinstance(expr, str) or not expr.strip():
        raise UnsafeExpressionError("empty expression")
    if len(expr) > MAX_EXPR_LENGTH:
        raise UnsafeExpressionError(f"expression too long (> {MAX_EXPR_LENGTH})")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise UnsafeExpressionError(f"syntax error: {e.msg}") from e
    return tree.body


def _check(node: ast.AST) -> None:
    """허용목록 검사. 허용되지 않은 노드는 즉시 예외."""
    if isinstance(node, ast.BoolOp):
        if not isinstance(node.op, _BOOL_OPS):
            raise UnsafeExpressionError(f"bool op not allowed: {type(node.op).__name__}")
        for v in node.values:
            _check(v)
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, _UNARY_OPS):
            raise UnsafeExpressionError(f"unary op not allowed: {type(node.op).__name__}")
        _check(node.operand)
    elif isinstance(node, ast.Compare):
        for op in node.ops:
            if not isinstance(op, _CMP_OPS):
                raise UnsafeExpressionError(f"comparison not allowed: {type(op).__name__}")
        _check(node.left)
        for c in node.comparators:
            _check(c)
    elif isinstance(node, ast.BinOp):
        if not isinstance(node.op, _BIN_OPS):
            raise UnsafeExpressionError(f"binary op not allowed: {type(node.op).__name__}")
        _check(node.left)
        _check(node.right)
    elif isinstance(node, ast.Constant):
        if not isinstance(node.value, _CONST_TYPES):
            raise UnsafeExpressionError(f"constant type not allowed: {type(node.value).__name__}")
    elif isinstance(node, (ast.List, ast.Tuple)):
        for elt in node.elts:
            _check(elt)
    elif isinstance(node, ast.Name):
        if node.id.startswith("_"):
            raise UnsafeExpressionError(f"private/dunder name not allowed: {node.id}")
    elif isinstance(node, ast.Attribute):
        if node.attr.startswith("_"):
            raise UnsafeExpressionError(f"private/dunder attribute not allowed: {node.attr}")
        _check(node.value)
    elif isinstance(node, ast.Subscript):
        if not isinstance(node.slice, ast.Constant) or not isinstance(node.slice.value, (str, int)):
            raise UnsafeExpressionError("subscript key must be a str/int constant")
        _check(node.value)
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_CALLS:
            raise UnsafeExpressionError("only len/abs/min/max/norm calls are allowed")
        if node.keywords:
            raise UnsafeExpressionError("keyword arguments not allowed")
        for a in node.args:
            if isinstance(a, ast.Starred):
                raise UnsafeExpressionError("starred arguments not allowed")
            _check(a)
    else:
        raise UnsafeExpressionError(f"node not allowed: {type(node).__name__}")


def validate(expr: str) -> None:
    """문법·허용목록만 검사한다(컨텍스트 불필요). 실패 시 UnsafeExpressionError."""
    _check(_parse(expr))


def referenced_names(expr: str) -> list[str]:
    """표현식이 참조하는 최상위 이름(컨텍스트 키) 목록. 호출 함수명은 제외, 등장 순서 유지."""
    node = _parse(expr)
    names: list[str] = []
    for n in ast.walk(node):
        if isinstance(n, ast.Name) and n.id not in _ALLOWED_CALLS and n.id not in names:
            names.append(n.id)
    return names


# --------------------------------------------------------------------------- 평가

def _unwrap(value: Any) -> Any:
    """Enum 값은 문자열 비교가 되도록 .value 로 풀어준다."""
    return value.value if isinstance(value, Enum) else value


def _lookup_attr(value: Any, attr: str) -> Any:
    if value is None:
        return None
    if attr == "norm" and isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return norm(value)
    if isinstance(value, Mapping):
        if attr in value:
            return _unwrap(value[attr])
        extra = value.get("extra")
        return _unwrap(extra.get(attr)) if isinstance(extra, Mapping) else None
    result = getattr(value, attr, None)
    if callable(result):
        raise UnsafeExpressionError(f"callable attribute not allowed: {attr}")
    fields = getattr(type(value), "model_fields", None)   # pydantic 모델: 필드가 아니면 extra에서 찾는다
    if isinstance(fields, Mapping) and attr not in fields:
        extra = getattr(value, "extra", None)
        return _unwrap(extra.get(attr)) if isinstance(extra, Mapping) else None
    return _unwrap(result)


def _lookup_key(value: Any, key: Any) -> Any:
    if value is None:
        return None
    try:
        return _unwrap(value[key])
    except (KeyError, IndexError, TypeError):
        return None


def _compare(op: ast.cmpop, left: Any, right: Any) -> bool:
    left, right = _unwrap(left), _unwrap(right)
    if isinstance(op, ast.Eq):
        return left == right
    if isinstance(op, ast.NotEq):
        return left != right
    if isinstance(op, ast.Is):
        return left is right
    if isinstance(op, ast.IsNot):
        return left is not right
    if isinstance(op, ast.In):
        return right is not None and left in right
    if isinstance(op, ast.NotIn):
        return right is None or left not in right
    if left is None or right is None:      # None 과의 크기 비교는 불일치
        return False
    try:
        if isinstance(op, ast.Lt):
            return left < right
        if isinstance(op, ast.LtE):
            return left <= right
        if isinstance(op, ast.Gt):
            return left > right
        return left >= right
    except TypeError as e:
        raise ExpressionEvalError(f"cannot compare {type(left).__name__} and {type(right).__name__}") from e


def _arith(op: ast.operator, left: Any, right: Any) -> Any:
    if left is None or right is None:
        return None
    if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
        raise ExpressionEvalError(f"arithmetic on non-numeric operands: {left!r} {right!r}")
    if isinstance(op, ast.Add):
        return left + right
    if isinstance(op, ast.Sub):
        return left - right
    if isinstance(op, ast.Mult):
        return left * right
    if right == 0:
        raise ExpressionEvalError("division by zero")
    return left / right


def _eval(node: ast.AST, ctx: Mapping[str, Any]) -> Any:
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            result: Any = True
            for v in node.values:
                result = _eval(v, ctx)
                if not result:
                    return result
            return result
        result = False
        for v in node.values:
            result = _eval(v, ctx)
            if result:
                return result
        return result
    if isinstance(node, ast.UnaryOp):
        operand = _eval(node.operand, ctx)
        if isinstance(node.op, ast.Not):
            return not operand
        if operand is None:
            return None
        if not isinstance(operand, (int, float)):
            raise ExpressionEvalError("unary minus on non-numeric operand")
        return -operand
    if isinstance(node, ast.Compare):
        left = _eval(node.left, ctx)
        for op, comp in zip(node.ops, node.comparators, strict=True):
            right = _eval(comp, ctx)
            if not _compare(op, left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.BinOp):
        return _arith(node.op, _eval(node.left, ctx), _eval(node.right, ctx))
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.List):
        return [_eval(e, ctx) for e in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_eval(e, ctx) for e in node.elts)
    if isinstance(node, ast.Name):
        if node.id not in ctx:
            raise UnknownNameError(f"unknown name {node.id!r}")
        return _unwrap(ctx[node.id])
    if isinstance(node, ast.Attribute):
        return _lookup_attr(_eval(node.value, ctx), node.attr)
    if isinstance(node, ast.Subscript):
        assert isinstance(node.slice, ast.Constant)
        return _lookup_key(_eval(node.value, ctx), node.slice.value)
    if isinstance(node, ast.Call):
        assert isinstance(node.func, ast.Name)
        fn = _ALLOWED_CALLS[node.func.id]
        try:
            return fn(*[_eval(a, ctx) for a in node.args])
        except SafeExprError:
            raise
        except (TypeError, ValueError) as e:
            raise ExpressionEvalError(f"{node.func.id}(): {e}") from e
    raise UnsafeExpressionError(f"node not allowed: {type(node).__name__}")  # pragma: no cover (validate가 먼저 거름)


def compile_expr(expr: str) -> Callable[[Mapping[str, Any]], Any]:
    """식을 한 번 파싱·검증해 두고 여러 컨텍스트에 재사용할 평가 함수를 돌려준다."""
    tree = _parse(expr)
    _check(tree)

    def _run(context: Mapping[str, Any]) -> Any:
        return _eval(tree, context)

    _run.__name__ = f"safe_expr<{expr}>"
    return _run


def evaluate(expr: str, context: Mapping[str, Any]) -> Any:
    """식을 컨텍스트로 평가한다. 조건식 용도면 bool(evaluate(...))로 쓴다.

    - 허용되지 않은 문법/이름: UnsafeExpressionError(UnknownNameError 포함)
    - 값 때문에 실패(0 나누기, 타입 불일치): ExpressionEvalError
    """
    return compile_expr(expr)(context)
