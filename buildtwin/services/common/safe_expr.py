"""안전한 식 평가기 (eval 미사용). 작성: progress-engine, knowledge가 재사용.

rules/*.yaml의 `when` 조건식을 평가한다. 지원 문법:
  - 비교: ==, !=, <, <=, >, >=, `is None`, `is not None`
  - 논리: and, or, not (단락 평가)
  - 산술: +, -, *, / (단항 -)
  - 리터럴: 숫자, 문자열('..' / ".."), True/False/None
  - 이름·속성 접근: report.claimed_state, logic.bim_quantity (dict 키 또는 객체 속성; 없으면 None)
함수 호출·인덱싱·대입·임포트는 지원하지 않는다(의도적).
None 과의 크기 비교(<, <= …)는 예외 대신 False 를 돌려준다(규칙 데이터 누락 시 조용히 불일치로 처리).
"""
from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

__all__ = ["SafeExprError", "compile_expr", "evaluate"]


class SafeExprError(ValueError):
    """식 문법 오류 또는 평가 중 오류."""


_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<number>\d+(?:\.\d+)?)
  | (?P<string>'[^']*'|"[^"]*")
  | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<op>==|!=|<=|>=|<|>|\+|-|\*|/|\(|\)|\.)
    """,
    re.VERBOSE,
)

_KEYWORDS = {"and", "or", "not", "is", "None", "True", "False"}
_COMPARISON_OPS = {"==", "!=", "<", "<=", ">", ">="}


def _tokenize(expr: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    pos = 0
    while pos < len(expr):
        m = _TOKEN_RE.match(expr, pos)
        if m is None:
            raise SafeExprError(f"unexpected character {expr[pos]!r} at {pos}")
        pos = m.end()
        kind = m.lastgroup
        if kind == "ws":
            continue
        text = m.group()
        if kind == "name" and text in _KEYWORDS:
            kind = "kw"
        assert kind is not None
        tokens.append((kind, text))
    tokens.append(("eof", ""))
    return tokens


# AST 노드는 튜플로 표현: ("lit", value) / ("name", [parts]) / ("not", node) / ("and", l, r) / ("or", l, r)
# ("cmp", op, l, r) / ("is", negate, node) / ("bin", op, l, r) / ("neg", node)
Node = tuple


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]):
        self.tokens = tokens
        self.i = 0

    def peek(self) -> tuple[str, str]:
        return self.tokens[self.i]

    def advance(self) -> tuple[str, str]:
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def accept(self, kind: str, text: str | None = None) -> bool:
        k, t = self.peek()
        if k == kind and (text is None or t == text):
            self.i += 1
            return True
        return False

    def expect(self, kind: str, text: str | None = None) -> tuple[str, str]:
        k, t = self.peek()
        if k != kind or (text is not None and t != text):
            raise SafeExprError(f"expected {text or kind!r} but found {t!r}")
        return self.advance()

    def parse(self) -> Node:
        node = self.parse_or()
        if self.peek()[0] != "eof":
            raise SafeExprError(f"unexpected token {self.peek()[1]!r}")
        return node

    def parse_or(self) -> Node:
        node = self.parse_and()
        while self.accept("kw", "or"):
            node = ("or", node, self.parse_and())
        return node

    def parse_and(self) -> Node:
        node = self.parse_not()
        while self.accept("kw", "and"):
            node = ("and", node, self.parse_not())
        return node

    def parse_not(self) -> Node:
        if self.accept("kw", "not"):
            return ("not", self.parse_not())
        return self.parse_comparison()

    def parse_comparison(self) -> Node:
        node = self.parse_additive()
        while True:
            k, t = self.peek()
            if k == "op" and t in _COMPARISON_OPS:
                self.advance()
                node = ("cmp", t, node, self.parse_additive())
            elif k == "kw" and t == "is":
                self.advance()
                negate = self.accept("kw", "not")
                self.expect("kw", "None")
                node = ("is", negate, node)
            else:
                return node

    def parse_additive(self) -> Node:
        node = self.parse_multiplicative()
        while True:
            k, t = self.peek()
            if k == "op" and t in ("+", "-"):
                self.advance()
                node = ("bin", t, node, self.parse_multiplicative())
            else:
                return node

    def parse_multiplicative(self) -> Node:
        node = self.parse_unary()
        while True:
            k, t = self.peek()
            if k == "op" and t in ("*", "/"):
                self.advance()
                node = ("bin", t, node, self.parse_unary())
            else:
                return node

    def parse_unary(self) -> Node:
        if self.accept("op", "-"):
            return ("neg", self.parse_unary())
        if self.accept("op", "+"):
            return self.parse_unary()
        return self.parse_primary()

    def parse_primary(self) -> Node:
        k, t = self.advance()
        if k == "number":
            return ("lit", float(t) if "." in t else int(t))
        if k == "string":
            return ("lit", t[1:-1])
        if k == "kw" and t in ("None", "True", "False"):
            return ("lit", {"None": None, "True": True, "False": False}[t])
        if k == "name":
            parts = [t]
            while self.accept("op", "."):
                parts.append(self.expect("name")[1])
            return ("name", parts)
        if k == "op" and t == "(":
            node = self.parse_or()
            self.expect("op", ")")
            return node
        raise SafeExprError(f"unexpected token {t!r}")


def _lookup(context: Mapping[str, Any], parts: list[str]) -> Any:
    if parts[0] not in context:
        raise SafeExprError(f"unknown name {parts[0]!r}")
    value: Any = context[parts[0]]
    for attr in parts[1:]:
        if value is None:
            return None
        if isinstance(value, Mapping):
            value = value.get(attr)
        elif attr.startswith("_"):
            raise SafeExprError(f"private attribute access not allowed: {attr}")
        else:
            value = getattr(value, attr, None)
            if callable(value):
                raise SafeExprError(f"callable attribute not allowed: {attr}")
    # Enum 값은 문자열 비교가 되도록 .value 로 풀어준다
    if hasattr(value, "value") and not isinstance(value, (int, float, str, bool)):
        value = value.value
    return value


def _compare(op: str, left: Any, right: Any) -> bool:
    if hasattr(left, "value") and not isinstance(left, (int, float, str, bool)):
        left = left.value
    if hasattr(right, "value") and not isinstance(right, (int, float, str, bool)):
        right = right.value
    if op == "==":
        return left == right
    if op == "!=":
        return left != right
    if left is None or right is None:
        return False
    try:
        if op == "<":
            return left < right
        if op == "<=":
            return left <= right
        if op == ">":
            return left > right
        if op == ">=":
            return left >= right
    except TypeError as exc:
        raise SafeExprError(f"cannot compare {type(left).__name__} {op} {type(right).__name__}") from exc
    raise SafeExprError(f"unknown comparison {op}")


def _arith(op: str, left: Any, right: Any) -> Any:
    if left is None or right is None:
        return None
    if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
        raise SafeExprError(f"arithmetic on non-numeric operands: {left!r} {op} {right!r}")
    if op == "+":
        return left + right
    if op == "-":
        return left - right
    if op == "*":
        return left * right
    if op == "/":
        if right == 0:
            raise SafeExprError("division by zero")
        return left / right
    raise SafeExprError(f"unknown operator {op}")


def _eval(node: Node, context: Mapping[str, Any]) -> Any:
    tag = node[0]
    if tag == "lit":
        return node[1]
    if tag == "name":
        return _lookup(context, node[1])
    if tag == "not":
        return not _eval(node[1], context)
    if tag == "and":
        left = _eval(node[1], context)
        return left if not left else _eval(node[2], context)
    if tag == "or":
        left = _eval(node[1], context)
        return left if left else _eval(node[2], context)
    if tag == "cmp":
        return _compare(node[1], _eval(node[2], context), _eval(node[3], context))
    if tag == "is":
        value = _eval(node[2], context)
        return (value is not None) if node[1] else (value is None)
    if tag == "bin":
        return _arith(node[1], _eval(node[2], context), _eval(node[3], context))
    if tag == "neg":
        value = _eval(node[1], context)
        if value is None:
            return None
        if not isinstance(value, (int, float)):
            raise SafeExprError("unary minus on non-numeric operand")
        return -value
    raise SafeExprError(f"unknown node {tag}")


def compile_expr(expr: str) -> Callable[[Mapping[str, Any]], Any]:
    """식을 한 번 파싱해 두고 여러 컨텍스트에 재사용할 평가 함수를 돌려준다."""
    if not isinstance(expr, str) or not expr.strip():
        raise SafeExprError("empty expression")
    tree = _Parser(_tokenize(expr)).parse()

    def _run(context: Mapping[str, Any]) -> Any:
        return _eval(tree, context)

    _run.__name__ = f"safe_expr<{expr}>"
    return _run


def evaluate(expr: str, context: Mapping[str, Any]) -> Any:
    """식을 컨텍스트로 평가한다. 조건식 용도면 bool(evaluate(...))로 쓴다."""
    return compile_expr(expr)(context)
