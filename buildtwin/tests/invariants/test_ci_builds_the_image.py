"""CI 에 **이미지를 짓는 잡**이 있고 그 잡이 실패를 삼키지 않는다 — 담당: qa (계획 0017 작업 2).

## 왜 있는가

계획 0017 §1-c 의 곱 표에서 「이미지를 짓는다」 행은 **사용자만 ✔** 였다. 짓는 명령을 실제로 부르는
자리가 `Makefile` 의 `dev` 레시피 하나였고, 워크플로에는 그 표기가 없었다(그 자리에서 도는 참조:
`git grep -nIE 'docker[ -]compose (build|up)' <트리> -- .github` 가 rc 1 을 냈다). 그래서
`c82cf47` 이 `Dockerfile` 의 폴백을 지운 뒤 그 설치의 rc 를 **처음 보는 사람이 사용자**였다.
작업 1 이 그 rc 를 읽는 주체(`image` 잡)를 만들었고, **이 파일이 그 잡이 조용히 사라지거나
무력해지지 못하게 붙든다.**

계약이 있는데 게이트가 없으면 다음 편집이 그것을 조용히 지운다 — 그 실패 모양은 이 저장소가 이미
값으로 갖고 있다(이웃 파일 `test_the_first_run_names_its_doors.py` 머리의 표: 안내를 지워도
`123 passed` 로 무변화였다).

## 무엇을 보는가 — 넷이고, **넷 다 YAML 을 읽을 뿐 docker 를 부르지 않는다**

1. **ⓘ 존재.** 그 이름의 잡이 워크플로에 있다.
2. **ⓙ 짓는다.** 그 잡의 어느 스텝이 **이미지를 짓는 명령**을 부른다. 문자열이 어딘가에 있는 것으로는
   부족하다 — `run:` 을 셸이 부르는 **낱말**로 펴서 **첫 낱말이 `docker`** 인 것만 센다. 그래서
   `echo "docker compose build"` 는 이 단언을 만족하지 못한다(변이 C4).
3. **ⓚ 삼키는 열쇠의 부재.** 그 잡과 그 스텝들에 `continue-on-error` 가 없고, 잡과 **짓는 스텝**에
   `if:` 가 없고, 짓는 스텝의 셸 명령에 실패를 잇는 셸 OR 가 없다.
4. **탐침 자신.** 읽는 경로·파싱이 틀렸을 때 **초록으로 지나가지 않는다**(§6-2 5). 같은 기구로
   기준 잡(`unit`)과 그 잡이 `pytest` 를 돌린다는 사실을 함께 읽는다 — 파일이 옮겨지거나 구조가
   바뀌면 위 셋이 공허해지기 전에 이것이 먼저 죽는다.

**개수를 세지 않는다**(CLAUDE.md §6-1 9회차 — 그 자리에서 도는 참조:
`grep -n "열거는 길이가 곧 개수다" ../../CLAUDE.md`). 「잡이 다섯이다」 같은 문장을 쓰지 않고,
**무엇이 있는가**(잡의 이름 · 짓는 명령)와 **무엇이 없는가**(삼키는 열쇠)만 단언한다.

## 이 파일이 **보지 못하는** 것 (CLAUDE.md §6-1 ②)

- **빌드가 실제로 서는가.** 이 파일이 읽는 것은 **YAML 의 선언**이다. 그 잡이 러너에서 초록인지
  빨간지는 잡 로그가 답하고, 이 사이클은 그것을 재지 못했다 — 이 환경에 데몬이 없다
  (`docker info` rc 1 · `/proc/sys/net/ipv4/ip_forward` 가 0, 각 N=1). **그것이 이 게이트가
  데몬을 요구하지 않는 이유이자 한계다.**
- **`docker compose build` 와 `docker compose up --build` 가 같은 것을 짓는가.** 이 파일은 명령의
  **이름**만 읽는다(계획 0017 §확인하지 않은 것 90).
- **다른 모양의 삼킴 — 문장은 참이고 낡은 것은 그 함의다**(계획 0018 작업 2 가 값으로 갈랐다).
  잡는 열쇠는 위 ⓚ 의 것이고, **짓는 스텝의 `run:` 안에서 rc 를 0 으로 만드는 편집은 여전히 이
  단언을 지나간다** — 변이 C7 = **4 passed** 이고, 이 사이클이 같은 변이를 다시 심어도 이 파일은
  **4 passed** 다(아래 「C7 을 지금은 누가 죽이는가」 표의 **C7 재현** 행).
  **낡은 것은 「그러므로 저장소가 그 편집을 놓친다」는 함의다**: 그 축은 이제 이웃
  `test_no_step_swallows_its_own_failure.py` 가 **모든 워크플로의 모든 잡의 모든 스텝**에 대해
  죽인다(같은 행의 이웃 칸 — **1 failed, 3 passed**).
  **표기가 아닌 기전은 그 이웃도 닫지 않는다** — 실패해도 rc 0 을 내는 래퍼 스크립트, `except: pass`,
  워크플로 자체를 끄는 `paths:` 축소가 그것이고, 이 사이클은 **표기 축만** 닫았다(계획 0018 §1-e 의
  *"닫지 않는다: ⑦(표기 아닌 기전)"*, **인용 · 발췌**; 그 파일 머리의 ⓓ 가 같은 목록을 적는다 —
  이 주석의 `grep` 은 `tests/invariants/` 에서 돈다:
  `grep -n "표기 축만" test_no_step_swallows_its_own_failure.py`).
  **다만 짓는 스텝을 통째로 다른 명령으로 바꾸는 편집은 이 파일이 잡는다** — ⓙ 가 첫 낱말을 보므로
  변이 C4 에서 **2 failed, 2 passed** 다. 이 사이클은 그 자리에 래퍼 스크립트를 심어 보지 **않았다**
  (N=0).
- **잡이 도는가.** `on:`/`paths` 가 이 워크플로를 언제 부르는지는 이 파일 밖이다 — 그 필터는
  워크플로 전체의 것이고 작업 1 이 바꾸지 않았다.
- **이미지 안의 것.** 무엇이 설치된다고 **적히는지**는 이웃 파일
  `test_the_image_installs_from_one_source.py` 가 `pyproject.toml` 과 대조한다. 그 이미지가 실제로
  담게 되는 것은 두 파일 어디에도 없다.

## 결함 있는 상태에서 실제로 죽는가 (CLAUDE.md §6-2 1 — 변이 실측, 각 N=1)

변이는 **한 자리씩** 심고 **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 그 사본으로
원복하고 루트 `git status --porcelain` 을 확인했다(§6-2 규칙 5 — 이 커밋이 처음 넣는 줄을 지우는
변이는 `git diff` 가 침묵한다: 그 잡 전체가 이 사이클이 처음 넣는 줄이다).
명령은 매번 `pytest tests/invariants/test_ci_builds_the_image.py -q`.

| 변이 | 무엇을 심었나 | 실행값(죽는 단언) |
|---|---|---|
| 음성 대조군 | 없음(이 커밋의 트리) | **4 passed** |
| C1 | `image` 잡을 **통째로 지운다** | **3 failed, 1 passed** — ⓘⓙⓚ 가 함께 죽고 탐침(4)만 산다 |
| C2 | 짓는 스텝에 `continue-on-error: true` 를 단다 | **1 failed, 3 passed** — ⓚ |
| C3 | 잡에 `continue-on-error: true` 를 단다 | **1 failed, 3 passed** — ⓚ |
| C4 | 짓는 스텝의 `run` 을 `echo "docker compose build"` 로 바꾼다 | **2 failed, 2 passed** — ⓙ 와 ⓚ(ⓚ 는 짓는 스텝을 못 찾아 죽는다) |
| C5 | 짓는 스텝의 `run` 에 셸 OR 로 `true` 를 잇는다 | **1 failed, 3 passed** — ⓚ |
| C6 | 잡에 `if: false` 를 단다 | **1 failed, 3 passed** — ⓚ |
| C7 | 짓는 스텝의 `run` 을 `set +e` + 빌드 + `exit 0` 로 바꾼다 | **4 passed** — 위 「보지 못하는 것」 셋째의 값(사각지대 실재). **지금 그것을 죽이는 파일은 아래 표에 있다** |
| C8 | 이 파일이 읽는 워크플로 경로를 없는 이름으로 바꾼다 | **4 failed** — 탐침이 **침묵하지 않는다** |

**C1 이 이 감시의 요점이다**: 잡을 지우는 편집은 어떤 테스트도 죽이지 않던 종류의 편집이었고
(이 파일이 서기 전 그 트리에서 잰 값: `pytest tests/invariants tests/regression -q` 가
잡을 지워도 그대로 초록이었다 — 아래 「이 파일이 서기 전」 표), 지금은 셋이 함께 죽는다.

**C4 가 「선언만 본다」의 경계다**(계획 0017 §리스크 3): 잡이 **있는데 아무것도 짓지 않는** 트리는
잡 이름으로는 갈리지 않는다. 첫 낱말을 보는 것이 그 축을 태운다. **그러나 C7 이 그 경계의 끝도
보여 준다** — 셸 안에서 rc 를 0 으로 만드는 모양은 이 파일이 못 본다.

**C8 은 탐침 자신에 대한 변이다**(§6-2 5): 읽는 자리가 틀리면 「그 잡이 있다」가 아니라
「파일을 못 읽었다」가 보고돼야 하고, 초록이어서는 안 된다.

## C7 을 지금은 누가 죽이는가 — **두 게이트의 경계** (계획 0018 작업 2)

**위 표의 C7 행을 지우지 않는다.** 그 값은 그것을 잰 시점의 참이고 이 표는 기록물이다 —
기록물의 값은 트리가 움직였다고 뒤늦게 갱신하지 않는다(CLAUDE.md §3-13 첫째 갈래, **재서술 · 발췌**;
이 주석의 `grep` 은 `tests/invariants/` 에서 돈다: `grep -n "뒤늦게 갱신하지 않는다" ../../CLAUDE.md`).
아래는 **같은 변이를 이 사이클이 다시 심어** 잰 값이다(2026-09-08 21:25~21:39 UTC 한 세션, **각 N=1**,
서로 몇 분 간격). 변이는 **한 자리씩** 심고 **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한
뒤 재고, 그 사본으로 원복하고 **저장소 루트에서** `git status --porcelain` 을 확인했다.

| 심은 것 | 이 파일 | 이웃 `test_no_step_swallows_its_own_failure.py` | `pytest tests/invariants -q` |
|---|---|---|---|
| 없음(음성 대조군) | **4 passed** | **4 passed** | **130 passed** |
| C7 재현 — 짓는 스텝의 `run` 을 `set +e` + 빌드 + `exit 0` 로 | **4 passed**(무변화) | **1 failed, 3 passed** — `test_no_run_step_in_any_workflow_turns_a_failure_into_success` | **1 failed, 129 passed** |
| C2 재현 — 짓는 스텝에 `continue-on-error: true` | **1 failed, 3 passed** — ⓚ | **1 failed, 3 passed** — `test_no_job_or_step_in_any_workflow_carries_the_swallowing_key` | **2 failed, 128 passed** |
| C3 재현 — `image` **잡**에 `continue-on-error: true` | **1 failed, 3 passed** — ⓚ | **1 failed, 3 passed** — 같은 단언(그 이름이 적는 대로 잡과 스텝을 함께 본다) | **2 failed, 128 passed** |
| C1 재현 — `image` 잡을 통째로 지운다 | **3 failed, 1 passed** — ⓘⓙⓚ | **4 passed**(무변화) | **3 failed, 127 passed** |

**경계.** 이 파일은 **`image` 잡의 선언**(ⓘ 존재 · ⓙ 짓는 명령 · ⓚ 열쇠와 배선의 부재)을 보고,
`run:` **안에서** rc 를 0 으로 만드는 편집은 보지 않는다. 그 축은 이웃이 진다 — 그 파일은 워크플로
디렉터리를 훑고 `Makefile` 을 읽는다(그 자리에서 도는 참조, `tests/invariants/` 에서:
`grep -n "^WORKFLOW_DIR\|^MAKEFILE" test_no_step_swallows_its_own_failure.py` ·
`grep -n "def test_no_run_step_in_any_workflow_turns_a_failure_into_success" test_no_step_swallows_its_own_failure.py`,
**인용 · 발췌**). **거꾸로도 값이 있다**: 위 **C1 재현** 행에서 `image` 잡이 통째로 사라져도 이웃은
**4 passed** 다 — 「그 잡이 있는가 · 무엇을 짓는가」를 이웃은 보지 않는다.

**겹치는 칸은 `image` 잡·스텝의 `continue-on-error` 이고, 거기서는 둘 다 죽는 것이 정답이다**
(CLAUDE.md §6-2 4 — *"두 사실이 함께여야 의미가 있으면 함께 단언한다"*, **인용 · 발췌**;
`grep -n "두 사실이 함께여야" ../../CLAUDE.md`). 위 **C2 재현**(스텝) 행과 **C3 재현**(잡) 행이
그 값이고, 그 둘에서 `pytest tests/invariants -q` 는 **2 failed** 다. **그 겹침을
「중복」이라 부르며 한쪽을 지우지 않는다** — 이 파일을 지우면 **C1 재현** 행의 축(존재 · 짓는 명령)을
아무도 보지 않고, 이웃을 지우면 **C7 재현** 행과 `image` 밖 잡·두 번째 워크플로·`Makefile` 을
아무도 보지 않는다(그 축의 값은 이웃 머리의 변이 M2 · M3 · M5, **재서술 · 발췌**).

## 이 파일이 서기 전 그 트리에서 잰 값 (§6-2 1 — 이 게이트가 없을 때의 값)

| 변이(이 파일이 **서기 전**) | `pytest tests/invariants tests/regression -q` |
|---|---|
| `image` 잡을 통째로 지운다 | **126 passed**(무변화) |
| 짓는 스텝에 `continue-on-error: true` 를 단다 | **126 passed**(무변화) |

## 이 파일이 postgres 축에 무엇을 하는가

**아무것도 하지 않는다.** 이 트리에는 축 기구가 없고, 이 파일의 어느 단언도 DB 엔진을 만들지 않는다
— `tests/postgres.floor.json` 의 두 바닥값은 이 커밋에서 움직이지 않는다.
"""
from __future__ import annotations

import re
import shlex
from pathlib import Path

import yaml

#: `tests/invariants/이 파일` → tests → buildtwin → 저장소 루트. 워크플로는 **`buildtwin/` 밑이 아니라
#: 저장소 루트**에 있다(ADR 0014 §2-2 의 표가 같은 사실을 적는다).
BUILDTWIN = Path(__file__).resolve().parents[2]
WORKFLOW = BUILDTWIN.parent / ".github" / "workflows" / "buildtwin-ci.yml"

#: 이미지를 짓는 잡의 id. 이 이름이 바뀌면 여기도 함께 바꾼다 — 그때 죽는 것은 ⓘ 다.
IMAGE_JOB = "image"

#: 탐침이 자기를 태울 때 쓰는 기준 잡과 그 잡이 부르는 명령(§6-2 5). 이 둘은 이 사이클이 만든 것이
#: 아니라 **이미 있던** 자리라, 읽는 기구가 성하면 반드시 보인다.
REFERENCE_JOB = "unit"
REFERENCE_COMMAND = "pytest"

#: 셸이 앞 절의 실패를 성공으로 바꾸는 자리(ADR 0020 §2-1 항 1 이 이름으로 드는 그 모양).
SHELL_OR = "||"

#: 잡·스텝을 실패해도 성공으로 보고하게 만드는 열쇠.
SWALLOWING_KEY = "continue-on-error"

#: 잡·스텝을 조용히 건너뛰게 만드는 열쇠.
SKIPPING_KEY = "if"


def _workflow() -> dict:
    """워크플로를 파싱한다. **읽지 못하면 그 자리에서 죽는다** — 침묵하지 않는다."""
    assert WORKFLOW.is_file(), (
        f"워크플로를 읽지 못했다: {WORKFLOW} — 이 파일의 모든 단언이 공허해진다. "
        "워크플로가 옮겨졌으면 WORKFLOW 를 함께 고친다."
    )
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(doc, dict) and isinstance(doc.get("jobs"), dict), (
        f"{WORKFLOW} 가 `jobs` 매핑을 갖지 않는다 — 파싱이 틀렸거나 구조가 바뀌었다."
    )
    return doc


def _job(job_id: str) -> dict:
    jobs = _workflow()["jobs"]
    assert job_id in jobs, (
        f"워크플로에 `{job_id}` 잡이 없다(있는 이름: {sorted(jobs)}). "
        "이미지를 짓는 잡이 사라지면 그 rc 를 처음 보는 사람이 다시 사용자가 된다(계획 0017 §1-c)."
    )
    job = jobs[job_id]
    assert isinstance(job, dict), f"`{job_id}` 잡이 매핑이 아니다: {type(job)!r}"
    return job


def _steps(job_id: str) -> list[dict]:
    steps = _job(job_id).get("steps") or []
    return [s for s in steps if isinstance(s, dict)]


def _command_words(run: str) -> list[list[str]]:
    """`run:` 블록을 **셸이 실제로 부르는 낱말**의 목록으로 편다.

    주석과 줄 이음을 걷어 내고, 이음 연산자(`&&` · 셸 OR · `;`)로 끊는다. 문자열이 어딘가에 있는
    것과 그것이 명령으로 불리는 것은 다른 일이므로, 판정은 **첫 낱말**로 한다.
    """
    words: list[list[str]] = []
    for raw in run.replace("\\\n", " ").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        for piece in re.split(r"&&|" + re.escape(SHELL_OR) + r"|;", line):
            piece = piece.strip()
            if not piece:
                continue
            try:
                tokens = shlex.split(piece)
            except ValueError:
                tokens = piece.split()
            if tokens:
                words.append(tokens)
    return words


def _builds_an_image(tokens: list[str]) -> bool:
    """이 낱말들이 **이미지를 짓는 명령**인가 — 표기 집합은 계획 0017 §1-b 의 것이다."""
    if not tokens or tokens[0] != "docker":
        return False
    if tokens[1:2] == ["build"]:
        return True
    if tokens[1:2] != ["compose"]:
        return False
    positional = [t for t in tokens[2:] if not t.startswith("-")]
    subcommand = positional[0] if positional else ""
    if subcommand == "build":
        return True
    return subcommand == "up" and "--build" in tokens


def _building_steps(job_id: str) -> list[dict]:
    return [
        step
        for step in _steps(job_id)
        if isinstance(step.get("run"), str)
        and any(_builds_an_image(tokens) for tokens in _command_words(step["run"]))
    ]


def test_the_workflow_declares_a_job_that_builds_the_image() -> None:
    """ⓘ 존재 — 그 이름의 잡이 워크플로에 있고 스텝을 갖는다."""
    steps = _steps(IMAGE_JOB)
    assert steps, (
        f"`{IMAGE_JOB}` 잡에 스텝이 없다 — 잡이 있다는 것만으로는 아무것도 짓지 않는다. "
        "이 단언이 없으면 아래 ⓙ 가 「없는 것에서 못 찾았다」와 구별되지 않는다."
    )


def test_that_job_runs_a_command_that_actually_builds_the_image() -> None:
    """ⓙ 짓는다 — 어느 스텝의 **첫 낱말이 `docker`** 인 짓는 명령이다."""
    found = _building_steps(IMAGE_JOB)
    ran = [step.get("run") for step in _steps(IMAGE_JOB) if isinstance(step.get("run"), str)]
    assert found, (
        f"`{IMAGE_JOB}` 잡의 어느 스텝도 이미지를 짓는 명령을 부르지 않는다(그 잡이 도는 것: {ran}). "
        "문자열이 어딘가에 있는 것으로는 부족하다 — 첫 낱말이 `docker` 여야 한다. "
        "잡은 있는데 아무것도 짓지 않으면 그 잡의 초록은 빌드에 대해 아무 말도 하지 않는다."
    )


def test_that_job_has_no_key_that_swallows_the_build_failure() -> None:
    """ⓚ 삼키는 열쇠의 부재 — 잡·스텝의 `continue-on-error`, 잡·짓는 스텝의 `if:`, 셸 OR."""
    job = _job(IMAGE_JOB)
    building = _building_steps(IMAGE_JOB)
    assert building, (
        f"`{IMAGE_JOB}` 잡에서 짓는 스텝을 찾지 못해 아래 단언들이 공허해진다 — "
        "먼저 ⓙ 를 읽어라(짓는 명령이 없거나 `echo` 로 바뀌었다)."
    )

    assert not job.get(SWALLOWING_KEY), (
        f"`{IMAGE_JOB}` 잡에 `{SWALLOWING_KEY}` 가 걸려 있다 — 빌드가 실패해도 그 잡은 초록으로 보고된다. "
        "계획 0016 이 `Dockerfile` 에서 지운 것이 정확히 그 모양이다(ADR 0020 §2-1 항 1)."
    )
    assert SKIPPING_KEY not in job, (
        f"`{IMAGE_JOB}` 잡에 `{SKIPPING_KEY}:` 가 걸려 있다({job.get(SKIPPING_KEY)!r}) — "
        "조건으로 꺼지는 잡은 조용히 건너뛰어지고, 그 침묵은 초록과 구별되지 않는다."
    )

    swallowing_steps = [
        step.get("name") or step.get("run") for step in _steps(IMAGE_JOB) if step.get(SWALLOWING_KEY)
    ]
    assert not swallowing_steps, (
        f"`{IMAGE_JOB}` 잡의 스텝이 `{SWALLOWING_KEY}` 를 갖는다: {swallowing_steps} — "
        "그 스텝의 rc 는 잡의 rc 가 되지 못한다."
    )

    skipped = [step.get("name") or step.get("run") for step in building if SKIPPING_KEY in step]
    assert not skipped, (
        f"이미지를 짓는 스텝에 `{SKIPPING_KEY}:` 가 걸려 있다: {skipped} — "
        "그 스텝이 건너뛰어져도 잡은 초록이고, 아무도 빌드를 돌리지 않은 실행과 값이 같다."
    )

    ored = [step.get("name") or step.get("run") for step in building if SHELL_OR in step["run"]]
    assert not ored, (
        f"이미지를 짓는 스텝의 셸 명령이 실패를 성공으로 바꾸는 셸 OR 를 갖는다: {ored} — "
        "앞 절이 실패해도 뒤 절이 rc 0 을 내고, 그 빌드의 실패는 다시 아무도 듣지 않는 소리가 된다."
    )


def test_this_probe_reads_the_workflow_and_dies_when_that_reading_is_wrong() -> None:
    """탐침 자신(§6-2 5) — 읽는 기구가 성한지를 **이 사이클이 만들지 않은 자리**로 확인한다."""
    steps = _steps(REFERENCE_JOB)
    assert steps, (
        f"기준 잡 `{REFERENCE_JOB}` 을 읽지 못했다 — 워크플로를 읽는 경로나 파싱이 틀렸다는 뜻이고, "
        "그러면 위 단언들은 「그 잡이 없다」가 아니라 「아무것도 못 읽었다」를 보고하고 있는 것이다."
    )
    commands = [step["run"] for step in steps if isinstance(step.get("run"), str)]
    assert any(REFERENCE_COMMAND in run for run in commands), (
        f"기준 잡 `{REFERENCE_JOB}` 이 `{REFERENCE_COMMAND}` 를 돌리지 않는다(읽은 명령: {commands}) — "
        "이 파일이 읽는 것이 그 워크플로가 맞는지 다시 본다."
    )
