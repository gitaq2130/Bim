"""오염 경위(`lost_decisions[].cause`) 값 집합의 **언어를 가로지르는** 계약 감사 (계획 0005 작업 8).

## 왜 이 파일이 있는가

작업 7 이 파이썬 세 자리(생산 `services/ingest/persistence` · 소비 `services/progress/document_mapper` ·
정의 `packages/core/models/review`)를 한 정의로 묶었다. 그 정의가 **닫지 못하는 것**이 이 파일의 대상이다:
`apps/web/src/api/types.ts` · `apps/web/src/domain/identityDrift.ts` · `apps/web/src/pages/ReviewsPage.tsx` ·
`config/document_register.yaml` 은 같은 문자열을 **따로** 적고, **TS 는 파이썬 상수를 import 할 수 없다.**

실측(2026-09-05, 작업 트리): `row_absorbed` → `row_relocated` 를 파이썬 전 계층(생산·소비·파이썬 테스트)에
일관 적용하고 TS·yaml 을 그대로 두면 **`pytest -q` 738 passed · `vitest run` 262 passed** — 전원 통과다.
그 상태의 제품은 서버가 `row_relocated` 를 실어 보내고, `classifyIdentityDriftCause` 가
`SERVER_CAUSE_TO_LOCAL` 에서 찾지 못해 **모든 항목을 `unspecified`("경위 미상")** 로 떨어뜨리고,
`config/document_register.yaml` 의 경고 문구가 **존재하지 않는 이름**을 CM 에게 읽어 준다.
예외 없음·테스트 전원 통과·화면 정상 — 이 저장소의 지배적 실패 모드 그대로다(CLAUDE.md §6).

## 이 감사의 두 규율

1. **추출이 공집합이면 그 칸은 아무것도 단언하지 않는다.** 그래서 모든 칸의 비교 상대는 **비어 있지 않은
   정본**이고(공집합 == 정본은 성립할 수 없다), 부분집합(⊆)으로만 비교하는 칸에는 **비어 있지 않음**을
   따로 단언한다. 계획 0005 §2-c 표의 두 칸(`document_mapper._CAUSE_ROW_*` 정규식 == 정본 /
   `IdentityDriftCause = Literal[…]` 정규식 == 정본)이 정확히 이 함정이었다 — 작업 7 이 그 파일에서
   리터럴을 없앴으므로 그 정규식의 추출 결과는 지금 **공집합**이고, 계획대로 짰으면 감사가 조용히
   통과하는 장식이 됐을 것이다. 그 두 칸을 **"주석 밖에 리터럴 선언이 0건"** + **"별칭의 우변이 정본
   심볼"** 로 바꾼다(아래 `test_python_alias_sites_declare_no_literal_of_their_own`).
2. **자기검증**(`test_every_extractor_is_sensitive_to_a_seeded_divergence`). 각 추출기에 그 칸이 실제로 보는 정본 값 하나를 →
   `row_relocated` 를 심은 입력을 먹여 **결과가 달라지는지** 본다. 추출기가 입력과 무관하게 정본을
   돌려주거나 늘 공집합이면 이 테스트가 죽는다.

## 이 감사가 놓치는 것 (CLAUDE.md §6-1 ②)

① **값 집합만 비교하고 의미는 비교하지 않는다** — 두 이름을 서로 맞바꾸는 개명은 모든 칸을 통과한다.
② `config` 스캔의 축이 `row_` **접두사**라, `row_` 로 시작하지 않는 새 경위 이름은 그 칸에서 보이지 않는다.
③ 옛 이름 유출은 **구조적으로 추출한 집합 안에서만** 본다. 저장소 전체 grep 으로 넓힐 수 없다 —
   `orphaned` 는 살아 있는 **무관한** 개념이다(`is_orphaned`, `orphaned_global_ids`, `DocumentsPage.tsx`).
④ `docs/`(ADR·계획·glossary)는 대상이 아니다. 그 문서들은 옛 이름을 **의도적으로 보존**하며
   (ADR 0009 §5-2 (마) 개명 표, glossary "옛 이름 셋 … 번역하지 않는다"), 개명이 일어나도 그 문장들은
   참인 채로 남아야 한다. 감사에 넣으면 감사가 정본을 거짓으로 만든다.
⑤ **아직 존재하지 않는 네 번째 경위 이름**은 원리상 이 축 밖이다.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final, get_args, get_type_hints

import pytest

from packages.core.models.review import (
    IDENTITY_DRIFT_CAUSE_UNSPECIFIED,
    IDENTITY_DRIFT_CAUSES,
    IdentityDriftCause,
)

ROOT = Path(__file__).resolve().parents[2]          # buildtwin/

# ── 정본. 이 파일은 값을 **다시 적지 않는다** — 값을 여기 적으면 감사 자신이 두 번째 정본이 된다. ──
CANON: Final[frozenset[str]] = frozenset(IDENTITY_DRIFT_CAUSES)
UNSPECIFIED: Final[str] = IDENTITY_DRIFT_CAUSE_UNSPECIFIED
CANON_WITH_UNSPECIFIED: Final[frozenset[str]] = CANON | {UNSPECIFIED}

# 개정 2 이전 이름 셋(ADR 0009 §5-2 (마)). **정본에도 소비 집합에도 별칭으로 들어와서는 안 된다** —
# 들어오면 `SERVER_CAUSE_TO_LOCAL` 이 옛 이름을 새 갈래로 번역하게 되고, §5-3-a 가 금지한
# "고아가 아닌 것을 고아라 부르기"가 되살아난다(계획 0005 §2-d 위험 ②).
LEGACY_CAUSE_NAMES: Final[frozenset[str]] = frozenset({"orphaned", "merge_overwritten", "merge_absorbed"})

# 자기검증용 씨앗. 정본에 **없는** 이름이어야 한다(있으면 seeded divergence 가 divergence 가 아니다).
# 심을 **원본** 값은 상수로 적지 않는다 — 정본이 개명되면 그 상수가 낡아 자기검증이 조용히 무력해진다.
# 대신 각 칸이 실제로 본 정본 값 중 하나를 골라 심는다(아래 `victim`).
SEED_TO: Final[str] = "row_relocated"

# ── 감사 대상 파일. 경로는 저장소 루트 기준으로 적고, 존재 여부를 먼저 단언한다(파일이 옮겨지면
#    추출이 공집합이 되는 것이 아니라 테스트가 그 자리에서 죽어야 한다). ──────────────────────────
PY_CANON = ROOT / "packages/core/models/review.py"
PY_CONSUMER = ROOT / "services/progress/document_mapper.py"
PY_PRODUCER = ROOT / "services/ingest/persistence.py"
TS_TYPES = ROOT / "apps/web/src/api/types.ts"
TS_DOMAIN = ROOT / "apps/web/src/domain/identityDrift.ts"
TS_PAGE = ROOT / "apps/web/src/pages/ReviewsPage.tsx"
YAML_CONFIG = ROOT / "config/document_register.yaml"

PY_ALIAS_SITES = (PY_CONSUMER, PY_PRODUCER)
# 화면에서 `cause` 값을 **런타임 리터럴로 비교**하는 자리 전수(비-테스트). 아래
# `test_web_source_tree_has_no_unaudited_cause_literal` 이 이 목록이 트리와 어긋나면 실패한다.
TS_COMPARISON_SITES = (TS_DOMAIN, TS_PAGE)


def _read(path: Path) -> str:
    assert path.is_file(), f"감사 대상 파일이 없다: {path.relative_to(ROOT)}"
    return path.read_text(encoding="utf-8")


# =============================================================================== 추출기 (순수 함수)
# 전부 `text -> set[str] | list[str]` 이다. 순수해야 아래 자기검증이 **같은 함수**에 씨앗을 먹일 수 있다.

_HEAD_COMMENT_CAUSE = re.compile(r"^#\s+`(row_[a-z_]+)`\s+—", re.MULTILINE)


def head_comment_causes(text: str) -> set[str]:
    """`packages/core/models/review.py` 머리 주석이 **뜻을 적어 둔** 경위 이름 전수.

    축은 "주석 안의 `row_` 토큰 전부"가 **아니다**. 그 축이면 이 파일 안의 서술용 언급
    (예: 실측 서사가 인용하는 `row_relocated`)까지 들어와 등호가 성립하지 않는다 — 계획 0005 §2-c 표의
    마지막 칸이 그렇게 적혀 있었고, 지금 트리에서 이미 거짓이다(실측: 이 파일의 `row_` 토큰 집합은
    `{row_absorbed, row_moved, row_relocated, row_replaced}`).
    축은 **열거 항목의 모양**(`#   \\`이름\\`      — 설명`)이다. 그래서 이 칸은 "각 정본 값에 설명이 붙어
    있고, 설명이 붙은 이름 중 정본이 아닌 것이 없다"를 단언한다.
    """
    return set(_HEAD_COMMENT_CAUSE.findall(text))


def python_string_literals_outside_docstrings(text: str) -> dict[str, list[int]]:
    """실행 코드의 문자열 리터럴 → 줄번호. **주석은 AST 에 없고, docstring 은 제외한다.**

    `_CAUSE_ROW_ABSORBED = "row_absorbed"` 같은 **정본에서 뗀 재선언**을 잡는 자리다. 런타임 `is` 비교로는
    잡히지 않는다 — CPython 이 같은 리터럴을 인터닝하므로 재선언해도 `is` 가 참이다(실측).
    """
    tree = ast.parse(text)
    docstring_nodes: set[int] = set()
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and body:
            first = body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docstring_nodes.add(id(first.value))
    out: dict[str, list[int]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstring_nodes:
            out.setdefault(node.value, []).append(node.lineno)
    return out


def python_alias_assignments(text: str) -> dict[str, str]:
    """모듈 최상위 `_CAUSE_…= …` 전수 → 우변의 **분류**.

    - 우변이 이름이면 그 심볼 이름(`"IDENTITY_DRIFT_CAUSE_ROW_MOVED"`) — 정본을 가리키는 별칭.
    - 우변이 문자열 리터럴이면 `"<literal>"` — **정본을 두 자리로 만드는 재선언**.
    - 그 밖(튜플·호출 등)은 `"<other>"`. `_CAUSE_ORDER = (_CAUSE_ROW_REPLACED, …)` 가 여기 온다 —
      순서표는 별칭이 아니므로 "우변이 정본 심볼" 요구에서 빼되, 리터럴 검사(①)는 그 안까지 본다.
    """
    out: dict[str, str] = {}
    for node in ast.parse(text).body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name) or not target.id.startswith("_CAUSE_"):
            continue
        value = node.value
        if isinstance(value, ast.Name):
            out[target.id] = value.id
        elif isinstance(value, ast.Constant) and isinstance(value.value, str):
            out[target.id] = "<literal>"
        else:
            out[target.id] = "<other>"
    return out


def python_imported_names(text: str, module_suffix: str) -> set[str]:
    """`from ... <module_suffix> import a, b` 로 들어온 이름 전수."""
    out: set[str] = set()
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.ImportFrom) and (node.module or "").endswith(module_suffix):
            out.update(alias.name for alias in node.names)
    return out


def python_literal_type_declarations(text: str) -> set[str]:
    """모듈 최상위에서 `NAME = Literal[…]` 로 **직접 선언된** 타입 별칭 이름 전수."""
    out: set[str] = set()
    for node in ast.parse(text).body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target, value = node.targets[0], node.value
        if not isinstance(target, ast.Name) or not isinstance(value, ast.Subscript):
            continue
        base = value.value
        if isinstance(base, ast.Name) and base.id == "Literal":
            out.add(target.id)
        elif isinstance(base, ast.Attribute) and base.attr == "Literal":
            out.add(target.id)
    return out


def ts_union_members(text: str, type_name: str) -> set[str]:
    """`export type <type_name> = "a" | "b" | …;` 의 문자열 멤버 전수."""
    m = re.search(rf"\btype\s+{re.escape(type_name)}\s*=\s*([^;]+);", text)
    if m is None:
        return set()
    return set(re.findall(r'"([^"]*)"', m.group(1)))


def _balanced_block(text: str, decl_name: str, opener: str, closer: str) -> str:
    """`const <decl_name>… = <opener> … <closer>` 의 괄호 균형 블록 원문. 없으면 빈 문자열.

    **여는 괄호는 `=` 다음에서 찾는다.** 선언 이름 바로 뒤부터 찾으면 타입 주석의 괄호를 집는다 —
    `const IDENTITY_DRIFT_CAUSE_ORDER: readonly IdentityDriftCauseKind[] = [ … ]` 에서 첫 `[` 는
    `IdentityDriftCauseKind[]` 의 것이고, 그것을 집으면 블록이 **공집합**이 되어 이 칸이 조용히
    아무것도 단언하지 않게 된다(초판 실측: `IDENTITY_DRIFT_CAUSE_ORDER` 추출 `[]`).
    """
    m = re.search(rf"\b(?:const|let|var)\s+{re.escape(decl_name)}\b", text)
    if m is None:
        return ""
    eq = re.search(r"=(?!=)", text[m.end() :])
    if eq is None:
        return ""
    start = text.find(opener, m.end() + eq.end())
    if start == -1:
        return ""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                return text[start + 1 : i]
    return ""


def ts_record_keys(text: str, decl_name: str) -> set[str]:
    """객체 리터럴의 **키** 전수(줄머리 식별자 + 콜론). 값이 여러 줄로 이어지는 표(`…_NOTES`)에서도
    값 줄은 `"` 로 시작하므로 키로 오인되지 않는다."""
    block = _balanced_block(text, decl_name, "{", "}")
    return set(re.findall(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", block, re.MULTILINE))


def ts_record_values(text: str, decl_name: str) -> set[str]:
    """객체 리터럴에서 `키: "값"` 모양의 **값** 전수(한 줄 문자열 값만 — 매핑표용)."""
    block = _balanced_block(text, decl_name, "{", "}")
    return set(re.findall(r"^\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*\"([^\"]*)\"", block, re.MULTILINE))


def ts_array_strings(text: str, decl_name: str) -> list[str]:
    """배열 리터럴의 문자열 원소를 **순서 그대로**. 순서를 보는 칸이 있으므로 set 이 아니다."""
    return re.findall(r'"([^"]*)"', _balanced_block(text, decl_name, "[", "]"))


_CAUSE_COMPARISON = re.compile(r"(?<![A-Za-z0-9_])cause\s*[!=]==\s*\"([^\"]*)\"")
# `typeof cause !== "string"` 은 **타입 검사**이지 경위 값 비교가 아니다. 이 제외를 빼면 추출 집합에
# `"string"` 이 들어와 아래 ⊆ 단언이 늘 실패한다(초판 실측: identityDrift.ts:52 에서 그렇게 됐다).
# 접근 경로도 함께 먹는다 — `typeof item.cause === "string"`(identityDrift.ts:240)이 그 모양이고,
# `typeof\s+$` 만으로는 그 줄을 놓친다(초판 실측: `{'string'}` 이 남아 이 칸이 실패했다).
_TYPEOF_BEFORE = re.compile(r"typeof\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)*$")


def ts_cause_comparison_literals(text: str) -> set[str]:
    """`… .cause === "row_replaced"` 처럼 **런타임 분기가 값을 직접 비교**하는 리터럴 전수.

    이 칸은 계획 0005 §2-c 표에 **없다**. §6-1 대로 저장소 루트에서 축을 넓혀(값 셋 + 정본 심볼 이름)
    목록을 다시 만들자 `apps/web/src/pages/ReviewsPage.tsx` 가 나왔고, 그 파일은 계획의 "정본 자리
    다섯"에 들어 있지 않다. 거기서 값이 하는 일은 타입 선언이 아니라 **화면 강조**다 —
    `g.cause === "row_replaced"` 가 "가장 먼저 확인" 배지와 `notice strong` 을 켠다. 개명이 여기까지
    오지 않으면 **가장 위험한 경위의 강조가 조용히 꺼진다**.
    """
    return {
        m.group(1)
        for m in _CAUSE_COMPARISON.finditer(text)
        if not _TYPEOF_BEFORE.search(text[max(0, m.start() - 60) : m.start()])
    }


_YAML_ROW_TOKEN = re.compile(r"\brow_[a-z_]+\b")


def yaml_row_tokens(text: str) -> set[str]:
    """config 의 `row_…` 토큰 전수. **단어 경계가 필수다** — `\\b` 가 없으면
    `header_row_search_range`·`blank_row_stop_streak`·`header_row_not_found`(실측 3종)까지 끌려온다."""
    return set(_YAML_ROW_TOKEN.findall(text))


# =============================================================================== 정본 자신 (음성 단언)


def test_canon_is_nonempty_and_excludes_unspecified_and_legacy_names():
    """정본 집합 자신의 세 가지 **부재**(계획 0005 §2-d 위험 ②③).

    - 비어 있지 않다: 아래 모든 칸이 "== 정본"으로 비어 있음을 배제하므로, 정본이 비면 감사 전체가
      장식이 된다. 여기가 그 바닥이다.
    - `unspecified` 가 **없다**: 있으면 생산자가 "모른다"를 값으로 실어 보낼 수 있게 되고, 소비자가
      모르는 값을 가장 흔한 경위로 떨어뜨리지 않으려고 만든 자리표시자가 무의미해진다.
    - 옛 이름 셋이 **없다**: "호환을 위해" 별칭으로 넣으면 `SERVER_CAUSE_TO_LOCAL` 이 옛 이름을 새
      갈래로 번역하게 되고, ADR 0009 §5-3-a 가 금지한 거짓이 되살아난다.
    """
    assert CANON, "IDENTITY_DRIFT_CAUSES 가 비었다 — 이 파일의 모든 칸이 무의미해진다"
    assert UNSPECIFIED not in CANON, f"{UNSPECIFIED!r} 는 소비 전용 자리표시자다(생산자가 실어 보내면 안 된다)"
    assert not (CANON & LEGACY_CAUSE_NAMES), f"옛 이름이 정본에 별칭으로 들어왔다: {sorted(CANON & LEGACY_CAUSE_NAMES)}"
    assert len(IDENTITY_DRIFT_CAUSES) == len(CANON), f"정본에 중복이 있다: {IDENTITY_DRIFT_CAUSES}"


def test_canon_literal_type_agrees_with_canon_tuple():
    """같은 파일 안의 두 선언(`IDENTITY_DRIFT_CAUSES` 튜플 ↔ `IdentityDriftCause` Literal)이 어긋나지 않는다."""
    assert set(get_args(IdentityDriftCause)) == CANON


def test_lost_decision_cause_stays_str_not_narrowed_to_literal():
    """계획 0005 §2-d 위험 ① — `LostDecision.cause` 를 `IdentityDriftCause` 로 **좁히지 않는다.**

    `LostDecision` 은 pydantic 모델이 아니라 **TypedDict** 다. 좁히면 저장된 과거 기록(옛 이름
    `orphaned`·`merge_overwritten`·`merge_absorbed` 를 실은 항목)이 검증에서 통째로 튕겨,
    적재 job 이 실패하거나 사건이 삼켜진다. 지금까지 이것을 지키던 것은 **코드 주석뿐**이었다.
    """
    from services.progress.document_mapper import LostDecision

    hints = get_type_hints(LostDecision)
    assert "cause" in hints, f"LostDecision 에 cause 가 없다: {sorted(hints)}"
    assert hints["cause"] is str, f"LostDecision.cause 가 str 이 아니다: {hints['cause']!r}"


# =============================================================================== 파이썬 쪽 칸


def test_canon_head_comment_documents_exactly_the_canonical_causes():
    """정본 옆 머리 주석의 **열거 항목**이 정본과 정확히 같다.

    역사적 결함을 실제로 잡는 칸이다 — ADR 0009 개정 2 의 개명 커밋 `71fc0de` 에서
    `packages/core/models/review.py` 의 경위 토큰 집합은 **공집합**이었고 코드는 셋이었다.
    그때 그것을 잡은 테스트는 하나도 없었다(주석이라 CI 가 침묵).
    """
    got = head_comment_causes(_read(PY_CANON))
    assert got == CANON, f"머리 주석의 경위 열거 {sorted(got)} != 정본 {sorted(CANON)}"


@pytest.mark.parametrize("path", PY_ALIAS_SITES, ids=lambda p: p.name)
def test_python_alias_sites_declare_no_literal_of_their_own(path: Path):
    """**계획 0005 §2-c 표의 두 칸을 바꾼 자리.**

    그 표는 `_CAUSE_ROW_*` 와 `IdentityDriftCause = Literal[…]` 을 **정규식으로 추출해 정본과 비교**하라고
    적었는데, 작업 7 이 두 파일에서 리터럴을 없앴으므로 그 추출은 지금 **공집합**이다 — 공집합은 정본과
    같을 수 없으니 그대로 짜면 감사가 늘 실패하거나(등호), 혹은 ⊆ 로 완화해 **늘 통과하는 장식**이 된다.
    실제로 지켜야 하는 성질은 값의 일치가 아니라 **"정본이 한 자리"** 이므로, 세 가지를 단언한다:

    ① 실행 코드에 경위 값의 **문자열 리터럴이 0건**이다. `_CAUSE_ROW_ABSORBED = "row_absorbed"` 처럼
       정본에서 뗀 **같은 값** 재선언이 여기서 죽는다. 런타임 `is` 비교로는 못 잡는다 — CPython 이
       같은 리터럴을 인터닝하므로 재선언해도 `is` 가 참이다.
    ② `_CAUSE_*` 별칭의 **우변이 정본 심볼 이름**이다(`<literal>` 이면 ①에 걸린다).
    ③ 그 심볼들이 실제로 `packages/core/models/review` 에서 **import** 됐다.

    ①~③ 중 어느 것도 공집합으로 참이 되지 않는다: ②는 별칭이 **하나 이상** 있어야 하고,
    ③은 import 집합이 정본 심볼 전부를 덮어야 한다.
    """
    text = _read(path)
    rel = path.relative_to(ROOT)

    # ① 리터럴 재선언 0건
    literals = python_string_literals_outside_docstrings(text)
    leaked = {v: lines for v, lines in literals.items() if v in CANON_WITH_UNSPECIFIED}
    assert not leaked, f"{rel}: 경위 값이 실행 코드에 리터럴로 다시 적혔다(정본이 두 자리가 된다): {leaked}"

    # ② 별칭의 우변이 정본 심볼
    assignments = python_alias_assignments(text)
    assert "<literal>" not in assignments.values(), (
        f"{rel}: `_CAUSE_*` 가 문자열 리터럴로 선언됐다: "
        f"{sorted(k for k, v in assignments.items() if v == '<literal>')}"
    )
    aliases = {k: v for k, v in assignments.items() if v not in ("<literal>", "<other>")}
    assert aliases, f"{rel}: 정본을 가리키는 `_CAUSE_*` 별칭이 하나도 없다 — 추출이 공집합이면 아무것도 단언하지 못한다"
    bad = {k: v for k, v in aliases.items() if not v.startswith("IDENTITY_DRIFT_CAUSE")}
    assert not bad, f"{rel}: `_CAUSE_*` 의 우변이 정본 심볼이 아니다: {bad}"

    # ③ 그 심볼이 정본 모듈에서 왔다
    imported = python_imported_names(text, "models.review")
    missing = set(aliases.values()) - imported
    assert not missing, f"{rel}: `_CAUSE_*` 가 가리키는 심볼이 packages/core/models/review import 에 없다: {sorted(missing)}"


@pytest.mark.parametrize("path", PY_ALIAS_SITES, ids=lambda p: p.name)
def test_python_alias_sites_do_not_redeclare_the_literal_type(path: Path):
    """`IdentityDriftCause = Literal[…]` 를 이 파일들이 **다시 선언하지 않는다**(정본에서 import·재수출)."""
    declared = python_literal_type_declarations(_read(path))
    assert "IdentityDriftCause" not in declared, (
        f"{path.relative_to(ROOT)}: IdentityDriftCause 를 Literal 로 다시 선언했다 — 정본은 "
        f"packages/core/models/review 하나다"
    )


def test_python_alias_values_equal_canon_at_runtime():
    """구조 검사(위 두 칸)와 **다른 축**: 실제로 import 된 값이 정본과 같은가.

    구조만 보면 "정본에서 import 했지만 다른 심볼을 가리키는" 오배선을 못 본다. 값만 보면 재선언을
    못 본다(인터닝). 둘 다 필요하다.
    """
    from services.ingest import persistence as producer
    from services.progress import document_mapper as consumer

    # 별칭 **이름**은 하드코딩하지 않는다 — 이름을 적으면 정당한 개명이 `AttributeError` 로 죽어
    # "값이 어긋났다"와 "이름이 바뀌었다"를 구별할 수 없게 된다. 이름은 소스에서 읽고 값만 비교한다.
    for module, path in ((consumer, PY_CONSUMER), (producer, PY_PRODUCER)):
        names = [n for n, rhs in python_alias_assignments(_read(path)).items()
                 if rhs.startswith("IDENTITY_DRIFT_CAUSE_ROW_")]
        assert names, f"{path.relative_to(ROOT)}: 정본 경위를 가리키는 별칭이 없다"
        assert {getattr(module, n) for n in names} == CANON, (path.relative_to(ROOT), names)
    assert consumer._CAUSE_UNSPECIFIED == UNSPECIFIED
    assert set(get_args(consumer.IdentityDriftCause)) == CANON
    # 소비 순서표는 정본 전수를 덮는다(빠진 경위는 화면에서 뒤로 밀린다 — 값이 아니라 **누락**이 결함)
    assert set(consumer._CAUSE_ORDER) == CANON


# =============================================================================== 화면(TS) 쪽 칸


def test_ts_api_type_union_equals_canon():
    """`apps/web/src/api/types.ts` 의 `IdentityDriftCause` 유니온 == 정본. (ADR 0009 §Deferred 5 목록에
    **없던** 자리 — 계획 0005 §2-a 가 다섯으로 고쳤다.)"""
    got = ts_union_members(_read(TS_TYPES), "IdentityDriftCause")
    assert got == CANON, f"api/types.ts IdentityDriftCause {sorted(got)} != 정본 {sorted(CANON)}"


def test_ts_domain_kind_union_equals_canon_plus_unspecified():
    """화면 갈래는 정본 + 소비 전용 자리표시자 하나다."""
    got = ts_union_members(_read(TS_DOMAIN), "IdentityDriftCauseKind")
    assert got == CANON_WITH_UNSPECIFIED, f"IdentityDriftCauseKind {sorted(got)} != {sorted(CANON_WITH_UNSPECIFIED)}"


def test_ts_server_cause_map_keys_equal_canon_and_never_translate_legacy_or_unspecified():
    """`SERVER_CAUSE_TO_LOCAL` 은 **서버가 보낼 수 있는 값**만 키로 갖는다.

    `unspecified` 가 키로 들어오면 "모른다"가 서버 값으로 승격되고(위험 ③), 옛 이름이 키로 들어오면
    화면이 옛 이름을 새 갈래로 조용히 번역한다(위험 ②). 둘 다 여기서 죽는다.
    """
    text = _read(TS_DOMAIN)
    keys = ts_record_keys(text, "SERVER_CAUSE_TO_LOCAL")
    assert keys == CANON, f"SERVER_CAUSE_TO_LOCAL 키 {sorted(keys)} != 정본 {sorted(CANON)}"
    assert UNSPECIFIED not in keys
    assert not (keys & LEGACY_CAUSE_NAMES)
    values = ts_record_values(text, "SERVER_CAUSE_TO_LOCAL")
    assert values, "SERVER_CAUSE_TO_LOCAL 의 값 추출이 공집합이다 — 이 칸이 아무것도 단언하지 못한다"
    assert values <= CANON_WITH_UNSPECIFIED, f"매핑 값이 화면 갈래 밖이다: {sorted(values - CANON_WITH_UNSPECIFIED)}"


def test_ts_cause_order_covers_canon_and_keeps_the_server_risk_order():
    """순서표는 **전수**를 덮고(빠진 경위는 목록 끝으로 밀린다), 실제 경위의 순서는 서버와 같다.

    §6-2 4 — 집합만 단언하면 "위험 순서"라는 이 표의 존재 이유가 사라져도 초록이다. 두 사실을 함께 본다.
    """
    from services.progress import document_mapper as consumer

    order = ts_array_strings(_read(TS_DOMAIN), "IDENTITY_DRIFT_CAUSE_ORDER")
    assert order, "IDENTITY_DRIFT_CAUSE_ORDER 추출이 공집합이다"
    assert set(order) == CANON_WITH_UNSPECIFIED, f"순서표 {order} != {sorted(CANON_WITH_UNSPECIFIED)}"
    assert [c for c in order if c in CANON] == list(consumer._CAUSE_ORDER), (
        f"화면 위험 순서 {order} 가 서버 _CAUSE_ORDER {list(consumer._CAUSE_ORDER)} 와 어긋난다"
    )
    assert order[-1] == UNSPECIFIED, "모르는 경위가 실제 경위보다 앞에 오면 CM 이 가장 먼저 보는 것이 뒤바뀐다"


@pytest.mark.parametrize("decl", ["IDENTITY_DRIFT_CAUSE_LABELS", "IDENTITY_DRIFT_CAUSE_NOTES"])
def test_ts_cause_text_tables_cover_canon_plus_unspecified(decl: str):
    """라벨·안내문 표의 키 == 정본 + `unspecified`. 빠진 경위는 화면에서 **빈 칸**이 된다."""
    keys = ts_record_keys(_read(TS_DOMAIN), decl)
    assert keys == CANON_WITH_UNSPECIFIED, f"{decl} 키 {sorted(keys)} != {sorted(CANON_WITH_UNSPECIFIED)}"


@pytest.mark.parametrize("path", TS_COMPARISON_SITES, ids=lambda p: p.name)
def test_ts_runtime_cause_comparisons_use_only_known_values(path: Path):
    """런타임 분기가 비교하는 리터럴 ⊆ 정본 ∪ {unspecified}. **⊆ 이므로 비어 있지 않음을 따로 단언한다.**

    `ReviewsPage.tsx` 의 `g.cause === "row_replaced"` 는 "가장 먼저 확인" 배지와 `notice strong` 을 켜는
    자리다. 개명이 여기까지 오지 않으면 그 강조가 조용히 꺼진다 — 계획 0005 §2-c 표에 **없던** 칸이다.
    """
    got = ts_cause_comparison_literals(_read(path))
    assert got, f"{path.relative_to(ROOT)}: `cause === \"…\"` 추출이 공집합이다 — 이 칸이 아무것도 단언하지 못한다"
    unknown = got - CANON_WITH_UNSPECIFIED
    assert not unknown, f"{path.relative_to(ROOT)}: 정본에 없는 값과 비교한다(개명이 여기 오지 않았다): {sorted(unknown)}"


def test_web_source_tree_has_no_unaudited_cause_literal():
    """**목록의 생성 기준이 곧 그 목록의 한계다**(CLAUDE.md §6-1).

    위 칸들은 파일 목록을 손으로 적는다. 그 목록이 트리와 어긋나면(새 화면이 `cause` 를 리터럴로 비교하기
    시작하면) 그 자리는 영원히 감사 밖이다. 여기서 `apps/web/src` **전수**를 훑어 비교 자리가
    `TS_COMPARISON_SITES` 와 정확히 같은지 확인한다 — 새 자리가 생기면 이 테스트가 그것을 이름으로 알린다.
    """
    web_src = ROOT / "apps/web/src"
    found: set[Path] = set()
    for path in sorted(web_src.rglob("*")):
        if path.suffix not in (".ts", ".tsx") or ".test." in path.name:
            continue
        if ts_cause_comparison_literals(path.read_text(encoding="utf-8")):
            found.add(path)
    assert found == set(TS_COMPARISON_SITES), (
        "cause 리터럴 비교 자리 전수가 감사 목록과 어긋난다.\n"
        f"  감사 목록에만: {sorted(p.relative_to(ROOT).as_posix() for p in set(TS_COMPARISON_SITES) - found)}\n"
        f"  트리에만(감사 밖): {sorted(p.relative_to(ROOT).as_posix() for p in found - set(TS_COMPARISON_SITES))}"
    )


# =============================================================================== config 쪽 칸


def test_config_warning_text_names_exactly_the_canonical_causes():
    """`config/document_register.yaml` 의 경고 문구가 부르는 경위 이름 == 정본.

    계획 0005 §2-c 는 이 칸을 **⊆** 로 적었다. 등호로 올린다 — ⊆ 는 "새 경위가 생겼는데 문구가 그것을
    말하지 않는" 결함을 통과시키고, 이 문구는 **CM 이 읽는 것**이라 그 침묵이 곧 잘못된 안내다
    (CLAUDE.md §6-4: 문구는 장식이 아니라 CM 이 다음 행동을 고르는 입력이다).
    지금 트리에서 등호가 성립한다(실측: `{row_absorbed, row_moved, row_replaced}`).
    """
    got = yaml_row_tokens(_read(YAML_CONFIG))
    assert got == CANON, f"config 경고 문구의 경위 이름 {sorted(got)} != 정본 {sorted(CANON)}"


def test_config_row_token_axis_excludes_unrelated_row_prefixed_keys():
    """위 칸이 기대는 **부재**를 명시한다: `\\brow_` 단어 경계가 없으면 무관한 config 키가 끌려온다.

    실측으로 그 세 키가 실제로 존재함을 확인한다 — 존재하지 않으면 이 방어는 아무것도 지키지 않는
    장식이고, 그 사실을 알아야 다음 사람이 경계를 지워도 되는지 판단할 수 있다.
    """
    text = _read(YAML_CONFIG)
    for key in ("header_row_search_range", "blank_row_stop_streak", "header_row_not_found"):
        assert key in text, f"config 에 {key} 가 없다 — 이 칸의 전제(무관한 row_ 키가 있다)가 낡았다"
    assert not (yaml_row_tokens(text) & {"header_row_search_range", "blank_row_stop_streak", "header_row_not_found"})


# =============================================================================== 옛 이름 유출


def test_no_legacy_cause_name_leaks_into_any_audited_set():
    """`[LEGACY leak]` — 구조적으로 추출한 **모든 집합** 안에 옛 이름이 없다.

    저장소 전체 grep 으로는 못 한다: `orphaned` 는 살아 있는 무관한 개념이다(`is_orphaned`,
    `orphaned_global_ids`, `DocumentsPage.tsx`). 그래서 축을 "이 감사가 경위 값으로 인정한 집합"으로 좁힌다.
    """
    domain = _read(TS_DOMAIN)
    audited: dict[str, set[str]] = {
        "canon": set(CANON),
        "review.py head comment": head_comment_causes(_read(PY_CANON)),
        "api/types.ts union": ts_union_members(_read(TS_TYPES), "IdentityDriftCause"),
        "identityDrift.ts kind": ts_union_members(domain, "IdentityDriftCauseKind"),
        "SERVER_CAUSE_TO_LOCAL keys": ts_record_keys(domain, "SERVER_CAUSE_TO_LOCAL"),
        "IDENTITY_DRIFT_CAUSE_ORDER": set(ts_array_strings(domain, "IDENTITY_DRIFT_CAUSE_ORDER")),
        "IDENTITY_DRIFT_CAUSE_LABELS": ts_record_keys(domain, "IDENTITY_DRIFT_CAUSE_LABELS"),
        "IDENTITY_DRIFT_CAUSE_NOTES": ts_record_keys(domain, "IDENTITY_DRIFT_CAUSE_NOTES"),
        "config yaml": yaml_row_tokens(_read(YAML_CONFIG)),
    }
    for site in TS_COMPARISON_SITES:
        audited[f"{site.name} comparisons"] = ts_cause_comparison_literals(_read(site))
    empty = [name for name, values in audited.items() if not values]
    assert not empty, f"추출이 공집합인 칸이 있다 — 그 칸은 옛 이름 유출을 볼 수 없다: {empty}"
    leaks = {name: sorted(values & LEGACY_CAUSE_NAMES) for name, values in audited.items() if values & LEGACY_CAUSE_NAMES}
    assert not leaks, f"옛 이름이 살아 있는 집합에 들어왔다: {leaks}"


# =============================================================================== 자기검증 (V14)

# (칸 이름, 그 칸이 읽는 파일, 추출기). 추출기는 `text -> 비교 가능한 값`.
_EXTRACTORS: tuple[tuple[str, Path, object], ...] = (
    ("review.py head comment", PY_CANON, head_comment_causes),
    ("api/types.ts IdentityDriftCause", TS_TYPES, lambda t: ts_union_members(t, "IdentityDriftCause")),
    ("identityDrift.ts IdentityDriftCauseKind", TS_DOMAIN, lambda t: ts_union_members(t, "IdentityDriftCauseKind")),
    ("SERVER_CAUSE_TO_LOCAL keys", TS_DOMAIN, lambda t: ts_record_keys(t, "SERVER_CAUSE_TO_LOCAL")),
    ("SERVER_CAUSE_TO_LOCAL values", TS_DOMAIN, lambda t: ts_record_values(t, "SERVER_CAUSE_TO_LOCAL")),
    ("IDENTITY_DRIFT_CAUSE_ORDER", TS_DOMAIN, lambda t: ts_array_strings(t, "IDENTITY_DRIFT_CAUSE_ORDER")),
    ("IDENTITY_DRIFT_CAUSE_LABELS", TS_DOMAIN, lambda t: ts_record_keys(t, "IDENTITY_DRIFT_CAUSE_LABELS")),
    ("IDENTITY_DRIFT_CAUSE_NOTES", TS_DOMAIN, lambda t: ts_record_keys(t, "IDENTITY_DRIFT_CAUSE_NOTES")),
    ("identityDrift.ts cause comparisons", TS_DOMAIN, ts_cause_comparison_literals),
    ("ReviewsPage.tsx cause comparisons", TS_PAGE, ts_cause_comparison_literals),
    ("config yaml row tokens", YAML_CONFIG, yaml_row_tokens),
)


@pytest.mark.parametrize(("name", "path", "extract"), _EXTRACTORS, ids=[e[0] for e in _EXTRACTORS])
def test_every_extractor_is_sensitive_to_a_seeded_divergence(name: str, path: Path, extract):
    """**감사 자신이 무보호가 되지 않게 한다**(계획 0005 V14, `test_lint_regex_catches_hardcoded_coordinates` 형식).

    각 추출기에 **그 칸이 실제로 보는 정본 값 하나**를 `row_relocated` 로 바꾼 같은 파일의 변형을 먹인다.
    네 가지가 함께 참이어야 한다:
      ① 실제 파일에서 추출이 **비어 있지 않다**(공집합이면 그 칸은 아무것도 단언하지 않는다).
      ② 추출 결과가 정본 값을 **실제로 담고 있다**(= 이 칸이 경위 값을 보고 있다).
      ③ 씨앗을 심으면 추출 결과가 **달라진다**(= 추출기가 입력과 무관하게 정본을 돌려주지 않는다).
      ④ 바뀐 값이 추출된다(= 추출기가 새 이름도 볼 수 있다 — 이름을 하드코딩하지 않았다).

    **씨앗을 칸마다 고르는 이유(초판 설계의 결함).** 처음에는 `row_absorbed` 하나를 전 칸에 썼는데,
    런타임 비교 칸 둘(`identityDrift.ts` · `ReviewsPage.tsx`)에는 그 값이 **애초에 없다**
    (실측: 각각 `{row_replaced}` · `{row_replaced, unspecified}`). 고정 씨앗이면 그 칸의 자기검증은
    "씨앗이 안 닿는다"로 죽거나, 조건을 느슨하게 하면 **자기검증이 그 칸을 건너뛴다.**
    """
    text = _read(path)
    real = extract(text)
    assert real, f"[{name}] 실제 파일에서 추출이 공집합이다"
    seen_canon = sorted(set(real) & CANON)
    assert seen_canon, f"[{name}] 추출 결과에 정본 값이 하나도 없다 — 이 칸은 경위 값을 보고 있지 않다: {real}"
    victim = seen_canon[0]
    seeded = extract(text.replace(victim, SEED_TO))
    assert seeded != real, f"[{name}] {victim!r}→{SEED_TO!r} 를 심었는데 추출이 그대로다 — 이 추출기는 입력을 읽지 않는다"
    assert SEED_TO in set(seeded), f"[{name}] 심은 값이 추출되지 않았다: {seeded}"


def test_python_literal_scanner_catches_a_reintroduced_literal():
    """`_CAUSE_ROW_ABSORBED = "row_absorbed"` 재선언(정본을 두 자리로 만드는 변이)을 실제로 잡는지.

    이 변이는 런타임 값도 `is` 비교도 바꾸지 않는다(인터닝) — 구조 검사만이 볼 수 있고, 그것을 지키던
    것은 지금까지 grep 한 줄뿐이었다.
    """
    canonical_value = sorted(CANON)[0]
    src = f'_CAUSE_ROW_ABSORBED = "{canonical_value}"\n'
    literals = python_string_literals_outside_docstrings(src)
    assert canonical_value in literals, "재선언된 리터럴을 스캐너가 놓쳤다"
    assert python_alias_assignments(src) == {"_CAUSE_ROW_ABSORBED": "<literal>"}


def test_python_literal_scanner_ignores_comments_and_docstrings():
    """반대 방향 — 주석·docstring 의 언급을 리터럴로 오인하지 않는다(오인하면 정본 파일 자신이 위반이 된다)."""
    value = sorted(CANON)[0]
    src = f'"""문서: {value} 는 …"""\n# 주석: {value}\nX = ALIAS\n'
    assert value not in python_string_literals_outside_docstrings(src)


def test_literal_type_declaration_scanner_catches_a_redeclaration():
    """`IdentityDriftCause = Literal[…]` 재선언 스캐너의 자기검증(양성·음성 한 쌍)."""
    assert python_literal_type_declarations('IdentityDriftCause = Literal["a", "b"]\n') == {"IdentityDriftCause"}
    assert python_literal_type_declarations("IdentityDriftCause = canon.IdentityDriftCause\n") == set()
