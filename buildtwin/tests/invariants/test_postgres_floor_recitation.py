"""바닥값을 **산문으로 복창하는 자리**가 `tests/postgres.floor.json` 과 갈리지 않는다 — 담당: qa.

## 왜 있는가 (계획 0012 §후속 54)

`min_tests_on_postgres` 는 파일 하나가 정본인데, 그 값을 **숫자로 되읽어 산문에 적는 자리**가 셋 있다
(`.github/workflows/buildtwin-ci.yml` · `tests/helpers/postgres_axis.py` ·
`tests/integration/test_99_db_axis_contract.py`). 그 일치를 **아무 테스트도 보지 않았다.**
실해가 났다: 이 사이클의 `cac4559` 가 바닥값을 181 → 187 로 올렸는데 **네 복창 중 넷 다 안 따라와**
현재형 거짓으로 남았고, 세 라운드의 어느 전수 목록에도 없었다(CLAUDE.md §6-4 1 — *"사실과 다른 문구는
그것을 만든 사이클이 고친다"* · §6-1 7회차 — *"값·개수가 낡은 주장"*).

## 무엇을 보는가 — 둘이다

1. **일치.** 위 세 파일의 산문 비교식 `N <연산자> M` 의 **오른쪽 피연산자**가 전부 현재 바닥값이다.
   그리고 **파일마다 최소 하나**를 요구한다 — 히트가 0이면 「전부 일치한다」가 **공허하게 참**이 되고,
   그러면 이 단언은 결함 코드에서도 초록이다(CLAUDE.md §6-2 1).
2. **전수.** qa 소유 트리(`tests/` · `Makefile` · `.github/workflows/`)를 다시 훑어, 그 모양을 가진
   파일의 집합이 1의 목록과 **정확히 같다**. 이 사이클의 결함은 값이 아니라 **목록**이었다 —
   §6-1(*"전수 목록의 생성 기준이 곧 그 목록의 한계다"*)이 요구하는 것이 이 두 번째 단언이다.

## 이 목록의 생성 기준과 그 기준이 놓치는 것 (§6-1 ①②)

**기준** = 저장소 루트에서 친 `grep -rnP '\\d+\\s*(>=|<=|>|<)\\s*\\d+' .` 의 히트 중 **qa 소유의 살아
있는 산문**. (소유를 먼저 좁히지 않았다 — 목록을 만든 뒤에 나눴다.)

**놓치는 것**(전부 이 파일이 **못** 잡는다):

- **비교식이 아닌 표기.** *"바닥값은 187 이다"* · *"187건"* · 한글 수사. 이 사이클에는 그런 자리가
  없었다(실측: 루트에서 `187`·`181` 을 훑어 각 히트를 읽었다) — **0건이었다는 사실이 기준을 정당화하지
  않는다**(§6-1 역방향 확인). 사각지대 자체는 실재한다: 그 모양을 심으면 **2 passed** 다(변이 B6).
- **보간**(§6-1 ③). `f"…{floor}…"` 로 조립되는 자리는 소스에 그 숫자가 아예 없다. 실측: 이 저장소에서
  그렇게 조립하는 자리는 `postgres_axis.report_line`·`check_contract` 뿐이고, 둘 다 **파일에서 읽은
  값**을 싣는다 — 원리상 갈릴 수 없어 이 감시의 대상이 아니다.
- **줄바꿈 — 여기 처음 적은 예는 틀렸다**(§6-1 ③, 2026-09-07 재측정). 이 자리는 *"연산자에서 줄이
  갈리면(`187 >=` / 다음 줄 `187`) 이 정규식이 못 본다"* 고 적었는데, **그 예는 실제로 잡힌다** —
  `COMPARISON` 의 `\\s*` 가 개행을 먹기 때문이다(변이 B1: `1 failed`, 메시지가 줄바꿈을 그대로 싣고
  `assert 181 == 187`). 못 보는 것은 줄바꿈 자체가 아니라 **연산자와 피연산자 사이에 공백이 아닌 문자가
  끼는 줄바꿈**(주석 접두사 `#` · 인용부호 `` ` `` · 블록인용 `>`)이다. **그마저도 그 파일의 유일한
  복창일 때는 「최소 하나」가 잡는다**(변이 B2·B4: 둘 다 `2 failed`). 그러므로 사각지대가 실재하는
  것은 **같은 파일에 형제 복창이 남아 있어 「최소 하나」가 만족될 때뿐**이고(변이 B3: `2 passed` —
  낡은 181 이 살아남는다), 그 조건은 이 세 파일 중 `postgres_axis.py` 하나만 갖는다(복창 둘).
- **바닥값을 왼쪽에 적은 비교식.** 오른쪽 규칙이 그것을 잘못 읽는다. 그래서 이 세 파일의 규약은
  **바닥값을 오른쪽에 적는다**이고, 어기면 이 테스트가 빨개진다 — **잘못 잡는 쪽(거짓 양성)이라
  안전한 방향**이다.
- **기록물 — 소유 밖에만 있는 것이 아니다**(2026-09-07 재측정). `docs/plans/`·`docs/adr/` 는 §3-13
  첫째 갈래의 **기록물**이라 대상이 아니다. 실측: `docs/plans/0011-*.md` 가 옛 바닥값의 비교식을 갖고
  있고, 그것은 그 계획 §0 이 못박은 트리의 값이다(소급 갱신하지 않는다). **그러나 이 자리는 `docs/` 만
  적어서 틀렸다 — 훑기 안(`tests/`)에도 같은 모양의 기록물이 하나 있다**: 정본 파일 자신인
  `tests/postgres.floor.json` 의 `_comment` 가 옛 실측을 *"그 실행이 `'11건 < 181'` 로 죽는다"* 로
  싣는다. **그것이 지금 안 걸리는 것은 원리가 아니라 우연이다** — 조사 「건」 한 글자가 피연산자와
  연산자 사이에 끼어 `COMPARISON` 이 못 볼 뿐이고, 그 한 글자만 빼면 ②가 **정본 파일을 이름으로
  집어낸다**(변이 B5: `1 failed`, *"목록에 없는데 있는 것: …/tests/postgres.floor.json"*). 그 방향은
  위 「왼쪽에 적은 비교식」과 같은 **거짓 양성**이다(그 문장은 오늘의 바닥값을 복창하는 것이 아니라
  옛 트리의 실측을 적은 것이므로). 즉 **이 훑기의 대상 여부를 가르는 것은 `docs/` 라는 경로가 아니라
  「오늘의 바닥값을 복창하는가」이고, 이 정규식은 그 둘을 구별하지 못한다.**
- **이 파일 자신.** 아래 `SCANNED_ROOTS` 훑기에서 **자기를 뺀다** — 이 docstring 이 예시로 적는 비교식이
  전수 단언을 자기가 깨기 때문이다. 뺄 수 있는 근거는 이 파일의 **코드**가 바닥값을 **복창하지
  않는다**는 것이다: 값은 `axis.read_floor()` 로만 온다(부재 단정 — 이 파일의 코드에 바닥값 리터럴이
  없다. **docstring 에는 있다** — 위 예시와 아래 변이 표가 숫자를 싣는다. 앞서 이 자리는 "이 파일에
  바닥값 리터럴이 없다"고 적었는데 그것은 거짓이었다).

## 결함 있는 상태에서 실제로 죽는가 (§6-2 1 — 변이 실측)

변이는 **한 자리씩** 심고 `git diff` 로 적용을 확인한 뒤 재고 원복했다(무력 변이 방지 — 리뷰어가
실제로 무력 변이 하나를 이 확인으로 걸러냈다: heredoc 이 안 돌아 `git diff` 가 비어 있었다). 명령은
매번 `pytest tests/invariants/test_postgres_floor_recitation.py -q`.

| 변이 | 무엇을 심었나 | 실행값 |
|---|---|---|
| 음성 대조군 | 없음(HEAD + 이 커밋) | **2 passed** |
| M1 | `tests/postgres.floor.json` 만 `187 → 188`(산문 넷은 그대로) | **1 failed, 1 passed** — ①이 죽고 메시지가 `.github/workflows/buildtwin-ci.yml:169` 과 두 수(187 ↔ 188)를 싣는다 |
| M2 | `postgres_axis.py` 의 복창 **둘을 지운다**(값을 바꾸지 않고) | **2 failed** — ①의 「최소 하나」와 ②의 「목록에 있는데 없는 것」이 함께 죽는다 |
| M3 | `tests/integration/conftest.py` 주석에 목록 **밖** 복창을 하나 만든다 | **1 failed, 1 passed** — ②가 그 파일을 이름으로 집어낸다 |

**M2 가 이 감시의 요점이다**: 복창을 지우는 것만으로는 값이 갈리지 않아 ①이 **공허하게 참**이 되는데,
「최소 하나」가 그 갈래를 죽인다. M1 이 **가장 먼저 이름을 부르는 파일이 저장소 루트의 워크플로**라는
것도 값이다 — 이 사이클이 놓쳤던 자리가 정확히 거기다.

## 「못 잡는 것」 목록을 태운 값 (§6-1 ③ — 2026-09-07, 각 N=3)

위 목록은 **생각으로** 적혔다. §6-1 ③("적어 둔 블라인드 스팟을 최소 한 건은 실제로 태워 본다")대로
태우니 **두 줄이 부정확했다** — 위에서 그 둘을 고쳤고, 근거가 이 표다. 심는 법·확인은 위와 같고
(한 자리씩 · `git diff` 로 적용 확인 · 원복 뒤 루트 `git status --porcelain` 이 비었음을 확인),
낡은 값 `181` 을 심어 **놓치면 그것이 살아남도록** 세웠다(§6-2 1: 결함이 있으면 값이 달라지는 상태).

| 변이 | 무엇을 심었나 | 실행값 | 뜻 |
|---|---|---|---|
| B1 | `postgres_axis.py:28` 을 `` `181 >= `` ↵ `` 181` `` (**공백뿐인** 줄바꿈) | **1 failed, 1 passed** ×3 | 「줄바꿈」 불릿이 든 **바로 그 예가 잡힌다** — `\\s*` 가 개행을 먹는다 |
| B2 | 워크플로 주석 `:169` 를 `` 181 >= `` ↵ `` # 181 `` (`#` 개입) | **2 failed** ×3 | 값으로는 못 보지만 그 파일의 **유일한** 복창이라 「최소 하나」가 잡는다 |
| B3 | `postgres_axis.py:28` 을 `` `181 >=` `` ↵ `` `181` `` (역따옴표 개입) + **형제 복창 `:34` 유지** | **2 passed** ×3 | **진짜 사각지대는 여기뿐** — 낡은 181 이 살아남는다 |
| B4 | B3 에 더해 형제 복창 `:34` 도 같은 모양으로 끊는다 | **2 failed** ×3 | 형제가 없어지는 순간 「최소 하나」가 잡는다 — B3 의 사각지대는 **형제에 기대고 있다** |
| B5 | `tests/postgres.floor.json` `_comment` 의 `'11건 < 181'` → `'11 < 181'` | **1 failed, 1 passed** ×3 | ②가 **정본 파일 자신**을 이름으로 집어낸다 — 오늘 안 걸리는 이유는 조사 한 글자다 |
| B6 | `postgres_axis.py:28` 아래에 *"참고: 오늘 바닥값은 181 이다"* | **2 passed** ×3 | 「비교식이 아닌 표기」 사각지대 실재 확인 |

**B1 ↔ B3 이 이 표의 값이다**: 두 변이는 **한 글자(역따옴표) 차이**인데 결과가 정반대다. 즉 이
감시의 경계는 「줄바꿈인가」가 아니라 **「연산자와 피연산자 사이가 공백뿐인가」**이고, 그것을 **문장으로
추측하면 방향까지 틀린다**(처음 적은 불릿이 정확히 그 방향으로 틀렸다). **B4 는 B3 의 한정어를 태운
것이다** — "형제 복창이 남아 있을 때뿐"이라는 새 한정어에 §6-3 의 역방향 확인을 건 값이고,
형제를 지우면 사각지대가 닫힌다.
"""
from __future__ import annotations

import re
from pathlib import Path

from tests.helpers import postgres_axis as axis

#: 산문 비교식. 양쪽 경계로 **소수**를 뺀다 — 안 빼면 `tests/unit/knowledge/test_safe_expr.py` 의
#: 규칙 표현식(`... - 0.6 >= 1.0`)이 히트한다(실측: 그 한 건이 유일한 거짓 양성이었다).
COMPARISON = re.compile(r"(?<![\d.])(\d+)\s*(?:>=|<=|>|<)\s*(\d+)(?![\d.])")

#: `tests/helpers/postgres_axis.py` → helpers → tests → buildtwin → 저장소 루트.
REPO_ROOT = Path(axis.__file__).resolve().parents[3]
BUILDTWIN = REPO_ROOT / "buildtwin"

#: 바닥값을 숫자로 복창하는 자리. **이 목록 자신이 계약이다** — 아래 두 번째 단언이 이 목록의 전수를 본다.
RECITING_FILES = (
    REPO_ROOT / ".github" / "workflows" / "buildtwin-ci.yml",
    BUILDTWIN / "tests" / "helpers" / "postgres_axis.py",
    BUILDTWIN / "tests" / "integration" / "test_99_db_axis_contract.py",
)

#: 전수를 다시 만드는 자리(qa 소유 트리 전부). `fixtures/` 는 샘플 데이터라 뺀다.
SCANNED_ROOTS = (
    BUILDTWIN / "tests",
    BUILDTWIN / "Makefile",
    REPO_ROOT / ".github" / "workflows",
)
SELF = Path(__file__).resolve()


def _comparisons(path: Path) -> list[tuple[int, str, int, int]]:
    """(줄 번호, 비교식, 왼쪽, 오른쪽) 목록."""
    text = path.read_text(encoding="utf-8")
    out = []
    for m in COMPARISON.finditer(text):
        out.append((text[: m.start()].count("\n") + 1, m.group(0), int(m.group(1)), int(m.group(2))))
    return out


def _scan_files() -> list[Path]:
    files: list[Path] = []
    for root in SCANNED_ROOTS:
        candidates = [root] if root.is_file() else sorted(p for p in root.rglob("*") if p.is_file())
        for path in candidates:
            if "__pycache__" in path.parts or "fixtures" in path.parts or path.resolve() == SELF:
                continue
            files.append(path)
    return files


def test_every_recited_floor_equals_the_committed_floor():
    """① 세 파일이 복창하는 수가 `tests/postgres.floor.json` 의 값이다 — 그리고 **공허하지 않다**."""
    floor = axis.read_floor()
    for path in RECITING_FILES:
        assert path.is_file(), f"복창 자리가 없어졌다: {path} — 목록(RECITING_FILES)을 함께 고친다"
        found = _comparisons(path)
        assert found, (
            f"{path} 에 바닥값 비교식이 하나도 없다. 문구를 지웠으면 RECITING_FILES 에서도 뺀다 — "
            "히트가 0 이면 아래 단언이 공허하게 참이 되어 이 감시가 장식이 된다(CLAUDE.md §6-2 1)."
        )
        for lineno, snippet, _left, right in found:
            assert right == floor, (
                f"{path}:{lineno} 가 바닥값을 {right} 로 적는다(`{snippet}`). "
                f"tests/postgres.floor.json 의 {axis.FLOOR_KEY} 는 {floor} 다 — "
                "바닥값을 올린 사이클이 이 산문도 함께 고친다(CLAUDE.md §6-4 1)."
            )


def test_no_floor_recitation_lives_outside_the_declared_list():
    """② 목록이 전수다 — qa 소유 트리에 목록 밖의 복창 자리가 없다(§6-1: 목록의 기준이 곧 한계다)."""
    declared = {p.resolve() for p in RECITING_FILES}
    found = {p.resolve() for p in _scan_files() if _comparisons(p)}
    assert found == declared, (
        "바닥값 복창 자리의 전수가 목록과 다르다.\n"
        f"  목록에 없는데 있는 것: {sorted(str(p) for p in found - declared)}\n"
        f"  목록에 있는데 없는 것: {sorted(str(p) for p in declared - found)}\n"
        "새 자리가 바닥값을 복창한다면 RECITING_FILES 에 넣고, 아니면 그 비교식을 산문에서 없앤다."
    )
