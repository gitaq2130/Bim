r"""워크플로의 어느 스텝도 · `Makefile` 의 어느 레시피도 **rc 를 성공으로 바꾸지 않는다** — 담당: qa (계획 0018 작업 1).

## 왜 있는가

사이클 0017 이 이미지를 짓는 rc 를 **읽는 주체**(`image` 잡)를 세웠고, 이웃
`test_ci_builds_the_image.py` 가 그 잡의 선언을 붙든다. **그런데 그 관측자 자신에 재현된 구멍이
있었다** — 그 파일 머리의 변이 C7: 짓는 스텝의 `run` 을 `set +e` + 빌드 + `exit 0` 로 바꾸면
**4 passed**(= 무변화). qa 가 심었고 리뷰어가 재현했다(계획 0017 §N-6 ㄱ).

**그 구멍의 이름은 「워크플로 `run:` 축」이다.** 잡·스텝의 **열쇠**(`continue-on-error`)와 **배선**
(`if:` · `needs`)은 이웃 파일이 `image` 잡에 대해 보는데, **셸 안에서 rc 를 0 으로 만드는 편집**은
아무 게이트도 읽지 않았다. `Makefile` 의 `-` 접두도 같은 축의 두 번째 자리이고 역시 게이트가 없었다
(계획 0018 §1-c 의 곱 표에서 「붙드는 게이트: 없다」인 칸 셋 — ④⑤⑥).

**오늘 이 저장소에 그 표기가 실행되는 자리로 하나도 없다**(계획 0018 §1-b 의 전수). 그러므로 이 파일이
만드는 것은 「고치는 게이트」가 아니라 **「그 상태가 조용히 바뀌지 못하게 하는 게이트」**다. 그 필요의
근거는 이 저장소가 이미 값으로 갖고 있다 — 아래 「이 파일이 서기 전」 표에서 두 변이가 모두
**무변화**로 지나간다.

## 무엇을 보는가 — 넷이고, **넷 다 YAML·Makefile 을 읽을 뿐 docker 도 make 도 부르지 않는다**

1. **ⓟ `run:` 축.** `.github/workflows/` **아래 모든 워크플로**의 **모든 잡의 모든 스텝**의 `run:` 에
   rc 를 성공으로 바꾸는 표기가 없다 — `set +e`(및 `set +o errexit`) · 셸 OR 로 이은 무조건 성공
   (`|| true` · `|| :` · `|| echo` · `|| printf`) · `exit 0`.
2. **ⓠ 삼키는 열쇠.** 어느 잡·스텝에도 `continue-on-error` 가 **`false` 아닌 값**으로 걸려 있지 않다.
   **`continue-on-error: false` 는 산다** — 그 값은 기본 동작을 적어 두는 것이지 삼키는 것이 아니다.
3. **ⓡ Makefile.** 어느 레시피도 `-` 접두를 갖지 않는다. `@` 접두는 산다(출력만 끈다).
4. **ⓢ 탐침 자신**(CLAUDE.md §6-2 5). 읽는 경로·파싱이 틀리면 **초록으로 지나가지 않는다.** 기준은
   **이 사이클이 만들지 않은 자리** 둘이다: 디렉터리 훑기로 도달한 `unit` 잡의 `pytest` 스텝과
   `Makefile` 의 `test-unit` 레시피. 둘 중 하나라도 안 보이면 위 셋은 「위반이 없다」가 아니라
   「아무것도 읽지 못했다」를 보고하고 있는 것이다.

**워크플로 목록은 디렉터리를 훑어 만든다** — 파일 이름을 하나 박지 않는다(선례:
`test_postgres_floor_recitation.py` 의 `SCANNED_ROOTS`). 워크플로가 하나 더 생기면 그것도 이 게이트
안이고, 손으로 고칠 목록이 없다. **개수를 세지 않는다**(CLAUDE.md §6-1 9회차) — 잡이 몇이고 워크플로가
몇인지 이 파일은 적지 않고, **무엇이 없는가**만 단언한다.

## 어떻게 읽는가 — **문자열 부분일치가 아니다**

`set +e` 가 **주석 안**에 있는 것과 **셸이 실행하는 자리**에 있는 것은 다른 일이다. 그래서 `run:` 을
훑지 않고 **편다**: 따옴표 상태를 지나며 이음(`&&` · `||` · `;` · `|` · `&`)으로 끊고, 낱말의 처음에
오는 `#` 부터는 주석으로 버리고, 각 조각을 `shlex` 로 낱말로 편 뒤 **첫 낱말**과 **그 조각 앞의
이음**으로 판정한다(0017 작업 2 가 짓는 명령을 첫 낱말로 편 것과 같은 층).

그래서 `echo "|| true 는 금지 표기다"` 와 `# set +e 를 두지 않는다` 는 **걸리지 않는다**(변이 M8).
이 확인이 없으면 자기 파일과 이웃 불변식의 산문이 먼저 빨개진다 — 계획 0016 작업 1 초안이 정확히 그렇게
걸렸다(주석에 셸 OR 를 적었더니 `grep -c` 가 히트를 냈다). **이 파일은 `tests/` 를 읽지 않는다** —
읽는 것은 `.github/workflows/` 와 `Makefile` 뿐이므로 이 머리말이 표기를 글자 그대로 쓰는 것이
자기 검사에 걸리지 않는다.

## 이 파일이 **보지 못하는** 것 (CLAUDE.md §6-1 ②) — 이름으로 적고, 셋에는 값을 붙였다

- **ⓐ `Makefile` 레시피 **안**의 셸 삼킴.** 이 파일이 `Makefile` 에 대해 보는 것은 **`-` 접두 하나**다.
  레시피 줄 안의 `|| true` · `; true` · `$(MAKE) -k` 는 전부 지나간다 — **태운 값: 변이 B1 = 4 passed**.
  같은 표기를 워크플로에서는 잡고 `Makefile` 에서는 못 잡는다는 뜻이고, 그 비대칭이 이 게이트의 모양이다
  (계획 0018 §확인하지 않은 것 104).
- **ⓑ 파이프라인이 rc 를 가리는 것.** `docker compose build | tee build.log` 의 rc 는 `tee` 의 것이다
  (`pipefail` 이 없으면). 이 파일은 이음 `|` 로 끊기만 하고 그 뒤 절을 「무조건 성공」으로 보지 않는다 —
  **태운 값: 변이 B2 = 4 passed**.
- **ⓒ `shell:` 이 `-e` 를 빼는 것.** 스텝이 `shell: bash --noprofile --norc {0}` 처럼 기본 셸을 덮으면
  다중행 스크립트의 중간 실패가 rc 에 오르지 않는다. 이 파일은 `shell:` 키를 읽지 않는다 —
  **태운 값: 변이 B3 = 4 passed**.
- **ⓗ `Dockerfile` 의 셸.** 이 파일이 읽는 자리는 `.github/workflows/` 와 `Makefile` 뿐이다 —
  `Dockerfile` 의 `RUN` 은 이 축 **밖**이고, 그 자리의 셸 OR 는 이웃
  `test_the_image_installs_from_one_source.py` 가 진다. **태운 값**: 설치 `RUN` 앞에 `set +e;` 를
  두면 `pytest tests/invariants -q` 가 **130 passed**(무변화)이고, 같은 자리에 셸 OR 로 `true` 를
  이으면 그 이웃이 **1 failed, 2 passed** 로 죽는다(각 N=1) — **두 파일의 경계가 그 값이다.**
- **ⓓ 표기가 아니라 기전으로 삼키는 자리.** 실패해도 rc 0 을 내는 **래퍼 스크립트**(`run: bash
  scripts/x.sh`), 파이썬의 `except Exception: pass`, `on:`/`paths:` 축소(잡을 아예 안 부른다).
  이 파일은 **표기 축만** 닫는다(계획 0018 §1-b ⓐ 의 ⑦ · §확인하지 않은 것 102).
- **ⓔ `uses:` 액션 안.** 판정은 `run:` 스크립트에만 걸린다 — 액션 안에서 rc 가 어떻게 다뤄지는지는
  이 축 밖이다(계획 0018 §확인하지 않은 것 101).
- **ⓕ `if:` 는 이 파일이 보지 않는다.** 스텝의 `if:` 가 거짓이면 그 스텝은 건너뛰어지고, 도는 스텝의
  rc 는 여전히 잡의 rc 다 — 오늘의 `if: ${{ !cancelled() }}` 와 `if: always()` 는 **정당한 자리**이고
  게이트가 그것을 잡으면 거짓 양성이다(아래 음성 대조군 표). **다만 「짓는 스텝을 끄는 `if:`」는 다른
  실패**이고 그것은 이웃 `test_ci_builds_the_image.py` 의 ⓚ 가 `image` 잡에 대해 진다.
- **ⓖ 러너에서 무엇이 실제로 일어나는가.** 이 파일이 읽는 것은 **선언**이다. 그 잡이 초록인지 빨간지는
  잡 로그가 답하고, 이 환경에는 데몬이 없다(`docker info` rc 1 · `/proc/sys/net/ipv4/ip_forward` 가 0,
  각 N=1). **그것이 이 게이트가 데몬을 요구하지 않는 이유이자 한계다.**

## 결함 있는 상태에서 실제로 죽는가 (CLAUDE.md §6-2 1 — 변이 실측)

변이는 **한 자리씩** 심고 **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 그 사본으로
원복하고 **저장소 루트에서** `git status --porcelain` 을 확인했다. 값은 2026-09-08 한 세션 안
(21:06~21:10 UTC, `date -u` 로 앞뒤를 찍었다)에 잰 것이고 **각 N=1**, 서로 몇 초~몇 분 간격이다.
명령은 매번 `pytest tests/invariants/test_no_step_swallows_its_own_failure.py -q`.

| 변이 | 무엇을 심었나 | 실행값(죽는 단언) |
|---|---|---|
| 음성 대조군 | 없음(이 커밋의 트리) | **4 passed** |
| M1 | **C7 재현** — `image` 잡의 짓는 스텝을 `set +e` + 빌드 + `exit 0` 로 | **1 failed, 3 passed** — ⓟ(`set +e` 와 `exit 0` 를 함께 이름으로 낸다) |
| M2 | **`image` 가 아닌 잡** — `lint` 잡 `ruff` 스텝에 `set +e` | **1 failed, 3 passed** — ⓟ |
| M3 | **두 번째 워크플로** — `deploy-pages.yml` 의 `npm run build` 에 셸 OR 로 `true` | **1 failed, 3 passed** — ⓟ |
| M4 | `lint` 잡 `ruff` 스텝에 `continue-on-error: true` | **1 failed, 3 passed** — ⓠ |
| M5 | `Makefile` 의 `test-unit` 레시피에 `-` 접두 | **1 failed, 3 passed** — ⓡ |
| M6 | `image` 잡에 `continue-on-error: false` 를 **더한다** | **4 passed** — 거짓 양성이 아니다(`: false` 는 산다) |
| M7 | **탐침 변이** — 읽는 디렉터리를 없는 이름으로 | **3 failed, 1 passed** — ⓟⓠⓢ 가 함께 죽고 `Makefile` 축(ⓡ)만 산다 |
| M8 | 짓는 스텝의 `run` 에 주석 `# set +e …` 와 `echo "|| true …"` 를 넣는다 | **4 passed** — 주석·인용은 실행되는 자리가 아니다 |
| M9 | `lint` 잡 `mypy` 스텝에 셸 OR 로 `:` | **1 failed, 3 passed** — ⓟ |

**M1 이 이 파일의 요점이다** — 아래 「C7 의 전후」가 그 대비를 값으로 싣는다.
**M7 은 탐침 자신에 대한 변이다**(§6-2 5): 읽는 자리가 틀리면 「삼키는 자리가 없다」가 아니라
「아무것도 읽지 못했다」가 보고돼야 하고, 초록이어서는 안 된다.

***`git diff` 로는 이 변이들을 가를 수 없는 칸이 있다*** (§6-2 규칙 5 · 계획 0018 §후속 96).
저장소 루트에서 잰 `git diff | grep -c '^-[^-]'` 는 **M4 · M6 · M7 에서 전부 0** 인데 **기전이 다르다**:
M4·M6 은 **순수 삽입**이라 지운 줄이 없고, M7 은 **이 커밋이 처음 넣는(추적 밖) 파일**을 고쳐서
기준선이 그 줄을 담지 않는다. 세 0 이 같은 값이라 구별되지 않으므로 **판정은 사본 `diff`** 로 했다.
그리고 `git diff` 를 쓸 때는 **저장소 루트에서** 돌렸다 — `buildtwin/` 에서 `-- .` 으로 돌리면
저장소 루트의 `.github/` 를 통째로 놓치고 그 침묵이 위 0 들과 같은 값이 된다.

## 거짓 양성 음성 대조군 — **오늘의 트리에서 살아야 하는 자리** (계획 0018 §리스크 1)

음성 대조군 행(4 passed)이 아래를 **전부** 지난다. 이 게이트가 처음 빨개진다면 회귀가 아니라
**파싱 오류**일 가능성이 크고, 그 판정의 근거가 이 표다.

| 살아야 하는 자리 | 어디 | 왜 안 걸리는가 |
|---|---|---|
| `continue-on-error: false` | `buildtwin-ci.yml` 의 `integration` 잡 | ⓠ 는 `false` 를 통과시킨다(변이 M6 이 그 축을 태운다) |
| `if: ${{ !cancelled() }}` · `if: always()` | `unit` · `integration` 잡의 스텝들 | 이 파일은 `if:` 를 읽지 않는다(위 ⓕ) |
| `continue-on-error` 를 적은 **YAML 주석** | `image` 잡 머리 | 파싱이 YAML 을 지나므로 주석은 문서에 없다 |
| `&&` 로 이은 명령 | `apt-get update && apt-get install …` · `pip install … && pip install …` | 이음이 `&&` 면 앞 절의 실패가 그대로 rc 가 된다 |
| `@` 접두 레시피 | `Makefile` 의 `env` · `dev` · `seed` … | ⓡ 이 보는 접두는 `-` 하나다 |
| `; exit 1` 과 `if … then … fi` | `Makefile` 의 `env` 레시피 | `exit 0` 이 아니고, `Makefile` 축은 접두만 본다 |
| `${{ runner.temp }}` 가 낱말을 가르는 `run:` | `integration` 잡의 junit 스텝 | `shlex` 가 깨지면 낱말 목록이 비고 ⓢ 가 먼저 죽는다 |

## C7 의 전후 — **이 파일이 서기 전과 후, 같은 변이** (이 작업의 핵심 값)

M1(= 0017 의 C7)을 심은 **같은 트리**에서 같은 세션에, 명령만 바꿔 쟀다(각 N=1, 21:09 UTC).

| 무엇을 돌렸나 | M1 을 심은 트리에서의 값 |
|---|---|
| `pytest tests/invariants/test_ci_builds_the_image.py -q`(옛 게이트 단독) | **4 passed** — 0017 의 값이 그대로 재현된다 |
| `pytest tests/invariants/test_no_step_swallows_its_own_failure.py -q`(이 파일 단독) | **1 failed, 3 passed** |
| `pytest tests/invariants -q`(둘이 함께 도는 자리) | **1 failed, 129 passed** |

**옛 게이트가 여전히 4 passed 라는 것이 이 표의 절반이다** — 이 파일은 이웃을 **대체하지 않고 넓힌다**.

## 이 파일이 서기 전 그 트리에서 잰 값 (§6-2 1 — 이 게이트가 없을 때)

이 파일을 작업 트리 밖으로 옮기고 같은 변이를 심어 쟀다(각 N=1, 21:08~21:09 UTC).
명령은 매번 `pytest tests/invariants tests/regression -q`.

| 변이(이 파일이 **서기 전**) | 실행값 |
|---|---|
| 없음 | **134 passed** |
| C7 재현(`image` 잡의 짓는 스텝을 `set +e` + 빌드 + `exit 0` 로) | **134 passed**(무변화) |
| `Makefile` 의 `test-unit` 레시피에 `-` 접두 | **134 passed**(무변화) |

같은 명령을 **이 파일이 있는 트리**에서 돌린 값은 **138 passed** 다(변이 없음, 같은 세션 N=1).

## 이웃 게이트와 **겹치는 자리** (계획 0018 §1-d · §리스크 2)

`image` 잡의 `continue-on-error` 는 **이 파일의 ⓠ 와 이웃 `test_ci_builds_the_image.py` 의 ⓚ 가 함께**
본다. **그 겹침은 중복이 아니라 정답이다**(CLAUDE.md §6-2 4) — ⓚ 는 그 잡에 대해 **존재 · 짓는 명령 ·
열쇠 부재** 셋을 함께 보고, 이 파일은 **모든 잡에 대해 rc 조작 하나**만 본다. **한쪽을 「저쪽이 본다」며
지우면 지운 쪽의 나머지 축이 무주공산이 된다.**

## 이 파일이 postgres 축에 무엇을 하는가

**아무것도 하지 않는다.** 이 파일의 어느 단언도 DB 엔진을 만들지 않는다 — `tests/postgres.floor.json`
과 `tests/metrics.json` 은 이 커밋에서 움직이지 않는다.
"""
from __future__ import annotations

import shlex
from pathlib import Path
from typing import NamedTuple

import yaml

#: `tests/invariants/이 파일` → tests → buildtwin → 저장소 루트. **워크플로는 `buildtwin/` 밑이 아니라
#: 저장소 루트**에 있다(이웃 `test_ci_builds_the_image.py` 가 같은 사실을 적는다).
BUILDTWIN = Path(__file__).resolve().parents[2]
REPO_ROOT = BUILDTWIN.parent

#: 훑는 자리. **파일 이름을 하나 박지 않는다** — 디렉터리를 훑어 목록을 만든다(선례:
#: `test_postgres_floor_recitation.py` 의 `SCANNED_ROOTS`). 워크플로가 하나 더 생기면 그것도 이 게이트
#: 안이고, 목록을 손으로 고칠 자리가 없다.
WORKFLOW_DIR = REPO_ROOT / ".github" / "workflows"
WORKFLOW_SUFFIXES = (".yml", ".yaml")
MAKEFILE = BUILDTWIN / "Makefile"

#: 잡·스텝을 실패해도 성공으로 보고하게 만드는 열쇠. **`false` 는 산다** — 그 값은 기본 동작을 적어
#: 두는 것이지 삼키는 것이 아니다(`buildtwin-ci.yml` 의 `integration` 잡이 그렇게 적는다).
SWALLOWING_KEY = "continue-on-error"

#: 셸이 앞 절의 실패를 성공으로 바꾸는 이음(ADR 0020 §2-1 항 1 이 이름으로 드는 그 모양).
SHELL_OR = "||"

#: 셸 줄을 명령으로 끊는 이음. 두 글자짜리를 먼저 본다 — `&&` 를 `&` 로 끊으면 앞 절이 사라진다.
OPERATORS = ("&&", SHELL_OR, ";;", ";", "|", "&")

#: 셸 OR 뒤에 오면 **앞 절의 실패를 덮는** 명령. 이 낱말들은 실질적으로 rc 0 만 낸다.
ALWAYS_SUCCEEDS = ("true", ":", "echo", "printf")

#: 레시피 줄의 접두 문자(make 가 명령에서 떼어 읽는다). 그중 `-` 가 **그 줄의 rc 를 버린다**.
RECIPE_PREFIXES = "@-+"
SWALLOWING_RECIPE_PREFIX = "-"

#: 탐침이 자기를 태울 때 쓰는 기준 자리(§6-2 5). 셋 다 **이 사이클이 만든 것이 아니라 이미 있던**
#: 자리라, 읽는 기구가 성하면 반드시 보인다. 안 보이면 그것은 「위반이 없다」가 아니라 「아무것도
#: 읽지 못했다」이고, 그때 위 셋은 전부 공허하게 참이 된다.
REFERENCE_JOB = "unit"
REFERENCE_COMMAND = "pytest"
REFERENCE_RECIPE_TARGET = "test-unit"


class Step(NamedTuple):
    """워크플로 한 스텝의 `run:` 하나."""

    path: Path
    job: str
    label: str
    run: str


class Recipe(NamedTuple):
    """Makefile 레시피 한 줄(논리적 줄 — 줄 이음의 뒷줄은 접두를 갖지 못한다)."""

    lineno: int
    target: str
    prefix: str
    command: str


def _workflow_paths() -> list[Path]:
    """`.github/workflows/` 아래의 워크플로 전부. **읽지 못하면 그 자리에서 죽는다.**"""
    assert WORKFLOW_DIR.is_dir(), (
        f"워크플로 디렉터리를 읽지 못했다: {WORKFLOW_DIR} — 이 파일의 모든 단언이 공허해진다. "
        "디렉터리가 옮겨졌으면 WORKFLOW_DIR 을 함께 고친다."
    )
    paths = sorted(p for p in WORKFLOW_DIR.iterdir() if p.is_file() and p.suffix in WORKFLOW_SUFFIXES)
    assert paths, (
        f"{WORKFLOW_DIR} 에서 워크플로를 하나도 찾지 못했다(찾는 확장자: {WORKFLOW_SUFFIXES}) — "
        "「위반이 없다」가 아니라 「아무것도 읽지 못했다」이다."
    )
    return paths


def _parsed(path: Path) -> dict:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(doc, dict) and isinstance(doc.get("jobs"), dict), (
        f"{path} 가 `jobs` 매핑을 갖지 않는다 — 파싱이 틀렸거나 구조가 바뀌었다."
    )
    return doc


def _jobs() -> list[tuple[Path, str, dict]]:
    """(워크플로 파일, 잡 id, 잡) 전부 — **어느 워크플로의 어느 잡도 빼지 않는다.**"""
    out: list[tuple[Path, str, dict]] = []
    for path in _workflow_paths():
        for job_id, job in _parsed(path)["jobs"].items():
            if isinstance(job, dict):
                out.append((path, str(job_id), job))
    return out


def _steps_of(job: dict) -> list[dict]:
    steps = job.get("steps") or []
    return [s for s in steps if isinstance(s, dict)]


def _run_steps() -> list[Step]:
    """`run:` 스크립트를 가진 스텝 전부. `uses:` 스텝은 이 축 밖이다(파일 머리 「보지 못하는 것」)."""
    out: list[Step] = []
    for path, job_id, job in _jobs():
        for index, step in enumerate(_steps_of(job)):
            run = step.get("run")
            if isinstance(run, str):
                label = str(step.get("name") or f"#{index}")
                out.append(Step(path=path, job=job_id, label=label, run=run))
    return out


def _split_commands(line: str) -> list[tuple[str, str]]:
    """셸 한 줄을 `(앞선 이음, 명령 문자열)` 로 끊는다 — **따옴표와 주석을 지나서.**

    문자열 부분일치로 읽으면 **주석 안의 표기**와 **셸이 실행하는 자리**가 갈리지 않는다.
    여기서 `#` 은 낱말의 처음일 때만 주석이고(`http://x#y` 는 아니다), 따옴표 안의 이음은
    이음이 아니다(`echo "a || b"` 는 명령 하나다).
    """
    out: list[tuple[str, str]] = []
    op = ""
    buf: list[str] = []
    quote = ""
    i = 0
    while i < len(line):
        ch = line[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(line):
                buf.append(line[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = ""
            i += 1
            continue
        if ch in "'\"":
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "\\" and i + 1 < len(line):
            buf.append(ch)
            buf.append(line[i + 1])
            i += 2
            continue
        if ch == "#" and (not buf or buf[-1].isspace()):
            break
        for token in OPERATORS:
            if line.startswith(token, i):
                out.append((op, "".join(buf)))
                op = ";" if token == ";;" else token
                buf = []
                i += len(token)
                break
        else:
            buf.append(ch)
            i += 1
    out.append((op, "".join(buf)))
    return [(o, c.strip()) for o, c in out if c.strip()]


def _commands(run: str) -> list[tuple[str, list[str]]]:
    """`run:` 블록을 `(앞선 이음, 셸이 부르는 낱말)` 의 목록으로 편다."""
    out: list[tuple[str, list[str]]] = []
    for raw in run.replace("\\\n", " ").splitlines():
        line = raw.strip()
        if not line:
            continue
        for op, piece in _split_commands(line):
            try:
                tokens = shlex.split(piece)
            except ValueError:
                tokens = piece.split()
            if tokens:
                out.append((op, tokens))
    return out


def _turns_failure_into_success(op: str, tokens: list[str]) -> str:
    """이 명령이 **rc 를 성공으로 바꾸는가** — 바꾸면 그 이유를 한 줄로 돌려준다."""
    head = tokens[0]
    rest = tokens[1:]
    if head == "set":
        if any(t.startswith("+") and "e" in t for t in rest):
            return "`set +e` — 뒤따르는 명령이 실패해도 셸이 멈추지 않고, 잡의 rc 는 마지막 명령의 것이 된다"
        for index, token in enumerate(rest):
            if token == "+o" and rest[index + 1 : index + 2] == ["errexit"]:
                return "`set +o errexit` — `set +e` 와 같은 것을 긴 이름으로 적은 것이다"
    if head == "exit" and rest[:1] == ["0"]:
        return "`exit 0` — 앞에서 무엇이 죽었든 이 스텝은 성공으로 끝난다"
    if op == SHELL_OR and head in ALWAYS_SUCCEEDS:
        return f"`{SHELL_OR} {head}` — 앞 절이 실패해도 뒤 절이 rc 0 을 내어 그 실패가 사라진다"
    return ""


def _makefile_recipes() -> list[Recipe]:
    """Makefile 의 레시피 줄 전부. **읽지 못하면 그 자리에서 죽는다.**"""
    assert MAKEFILE.is_file(), (
        f"Makefile 을 읽지 못했다: {MAKEFILE} — 아래 단언이 공허해진다. 옮겨졌으면 MAKEFILE 을 함께 고친다."
    )
    out: list[Recipe] = []
    target = ""
    continued = False
    for lineno, raw in enumerate(MAKEFILE.read_text(encoding="utf-8").splitlines(), 1):
        if raw.startswith("\t"):
            body = raw[1:]
            if not continued:
                cut = 0
                while cut < len(body) and body[cut] in RECIPE_PREFIXES:
                    cut += 1
                out.append(Recipe(lineno=lineno, target=target, prefix=body[:cut], command=body[cut:].strip()))
            continued = raw.rstrip().endswith("\\")
            continue
        continued = False
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        head = stripped.split(":", 1)[0]
        if "=" in head or stripped.startswith(":"):
            continue
        target = head.strip()
    return out


def test_no_run_step_in_any_workflow_turns_a_failure_into_success() -> None:
    """ⓟ — `.github/workflows/` 아래 **모든 워크플로의 모든 잡의 모든 스텝**의 `run:` 을 본다."""
    found = [
        f"{step.path.name} · 잡 `{step.job}` · 스텝 `{step.label}`: {reason} (그 명령: {' '.join(tokens)})"
        for step in _run_steps()
        for op, tokens in _commands(step.run)
        if (reason := _turns_failure_into_success(op, tokens))
    ]
    assert not found, (
        "워크플로의 `run:` 이 실패를 성공으로 바꾼다:\n  " + "\n  ".join(found) + "\n"
        "그 스텝이 무엇을 하든 잡은 초록으로 보고되고, 그 초록은 **아무도 그것을 돌리지 않은 실행과 "
        "값이 같다**. 짓는 잡에 대해서는 이 모양이 이미 값으로 났다 — 이웃 "
        "`test_ci_builds_the_image.py` 머리의 변이 C7 이 그 자리다."
    )


def test_no_job_or_step_in_any_workflow_carries_the_swallowing_key() -> None:
    """ⓠ — 어느 잡·스텝에도 `continue-on-error: true` 가 없다. **`: false` 는 산다.**"""
    found: list[str] = []
    for path, job_id, job in _jobs():
        if SWALLOWING_KEY in job and job[SWALLOWING_KEY] is not False:
            found.append(f"{path.name} · 잡 `{job_id}` 가 `{SWALLOWING_KEY}: {job[SWALLOWING_KEY]!r}`")
        for index, step in enumerate(_steps_of(job)):
            if SWALLOWING_KEY in step and step[SWALLOWING_KEY] is not False:
                label = str(step.get("name") or f"#{index}")
                found.append(
                    f"{path.name} · 잡 `{job_id}` · 스텝 `{label}` 이 "
                    f"`{SWALLOWING_KEY}: {step[SWALLOWING_KEY]!r}`"
                )
    assert not found, (
        f"`{SWALLOWING_KEY}` 가 실패를 삼키는 값으로 걸려 있다:\n  " + "\n  ".join(found) + "\n"
        "그 잡·스텝의 rc 는 워크플로의 rc 가 되지 못한다. 기본 동작을 적어 두는 "
        f"`{SWALLOWING_KEY}: false` 는 이 단언에 걸리지 않는다 — 걸렸다면 값이 `false` 가 아니다."
    )


def test_no_makefile_recipe_ignores_its_own_failure() -> None:
    """ⓡ — `Makefile` 의 어느 레시피도 `-` 접두를 갖지 않는다."""
    found = [
        f"{MAKEFILE.name}:{recipe.lineno} 의 `{recipe.target}` 레시피(`{recipe.prefix}{recipe.command}`)"
        for recipe in _makefile_recipes()
        if SWALLOWING_RECIPE_PREFIX in recipe.prefix
    ]
    assert not found, (
        f"레시피가 `{SWALLOWING_RECIPE_PREFIX}` 접두로 자기 rc 를 버린다:\n  " + "\n  ".join(found) + "\n"
        "make 는 그 줄이 죽어도 다음 줄로 가고 타깃은 성공으로 끝난다 — `make test` 의 초록이 "
        "「전부 통과했다」를 뜻하지 않게 된다(CLAUDE.md §3-1)."
    )


def test_this_probe_reads_the_workflows_and_the_makefile_and_dies_when_that_reading_is_wrong() -> None:
    """ⓢ 탐침 자신(§6-2 5) — 읽는 경로·파싱이 틀리면 **초록으로 지나가지 않는다.**"""
    steps = _run_steps()
    assert steps, (
        f"{WORKFLOW_DIR} 아래에서 `run:` 을 가진 스텝을 하나도 펴지 못했다 — 위 ⓟⓠ 는 지금 "
        "「삼키는 자리가 없다」가 아니라 「아무것도 읽지 못했다」를 보고하고 있다."
    )
    anchored = [
        step
        for step in steps
        if step.job == REFERENCE_JOB and any(tokens[0] == REFERENCE_COMMAND for _, tokens in _commands(step.run))
    ]
    assert anchored, (
        f"기준 잡 `{REFERENCE_JOB}` 의 `{REFERENCE_COMMAND}` 스텝을 디렉터리 훑기로 찾지 못했다 — "
        "워크플로를 읽는 경로나 셸 줄을 펴는 기구가 틀렸다. 그 자리가 사라진 것이라면 이 상수를 "
        "**살아 있는 다른 자리로** 옮긴다(비우지 않는다)."
    )
    recipes = _makefile_recipes()
    anchored_recipes = [
        recipe
        for recipe in recipes
        if recipe.target == REFERENCE_RECIPE_TARGET and REFERENCE_COMMAND in recipe.command
    ]
    assert anchored_recipes, (
        f"기준 레시피 `{REFERENCE_RECIPE_TARGET}`(그 안의 `{REFERENCE_COMMAND}`)를 찾지 못했다 — "
        f"{MAKEFILE} 를 읽는 기구가 틀렸다는 뜻이고, 그러면 ⓡ 은 공허하게 참이다."
    )
