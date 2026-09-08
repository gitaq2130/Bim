"""이미지의 설치가 **정본 하나**(`pyproject.toml`)에서 나오고 실패를 성공으로 바꾸지 않는다 — 담당: qa.

## 왜 있는가 (계획 0016 작업 4-1, ADR 0020 §2-1 항 1)

계획 0016 §1-d 의 곱 표에서 **네 관측자 축이 모두 ✘ 인 행은 문 3(빌드) 하나**였다. 그 자리의 기전은
`Dockerfile` 의 `RUN pip install … <셸 OR> pip install <이름들>` 이었다 — 앞 절이 실패해도 뒤 절이
이미지를 완성하고 **빌드는 rc 0 으로 끝난다**. 그 결과가 두 목록의 차이만큼 다른 이미지이고, 차이 나던
그 이름(`openpyxl`)을 운영 경로가 모듈 최상단에서 import 한다
(그 자리에서 도는 참조: `grep -n "^import openpyxl" services/progress/importers/document_register.py`).
`c82cf47` 이 그 폴백을 지웠고, **이 파일이 그것이 다시 서지 못하게 붙든다.**

## 무엇을 보는가 — 아래 셋이고, **셋 다 파일 둘을 읽을 뿐 아무것도 실행하지 않는다**

(이 머리 주석의 `grep`·`pytest` 는 전부 `buildtwin/` 에서 돈다.)

1. **모양.** `Dockerfile` 의 **셸 명령**(`RUN`·`CMD`·`ENTRYPOINT`)에 실패를 잇는 셸 OR 가 없다.
2. **대조.** `pyproject.toml` 이 소유한 배포 이름이 `Dockerfile` 의 명령 어디에도 **열거되지 않는다.**
   개수를 세지 않는다(CLAUDE.md §6-1 9회차 — 그 자리에서 도는 참조:
   `grep -n "열거는 길이가 곧 개수다" CLAUDE.md`). 세는 대신 **부재**를 단언한다.
3. **정본.** `pip install` 이 **프로젝트 자신만** 설치한다(`-e .`). 지워진 폴백의 손해는 이름 하나가
   빠진 것만이 아니라 **`-e .` 를 버린 것**이었다 — 그 이미지는 프로젝트를 설치하지 않는다.

## 「토큰이 아니라 모양」 — 이 파일이 고른 쪽과 그 대가 (값은 아래 변이 표 M-A)

ADR 0020 §5 셋째 행이 *"금지되는 것은 토큰이 아니라 「실패를 성공으로 바꾸는 모양」이다"* 라고 적는다
(**인용 · 발췌**). 그래서 1 은 **주석을 걷어 낸 뒤 셸 명령만** 본다 — 파일 전체에서 그 토큰의 부재를
단언하면 **그 파일은 주석에서도 그 토큰을 쓸 수 없다.**

그 대가는 값으로 보인다. `c82cf47` 이 남긴 주석은 폴백을 이름할 때 그 토큰을 쓰지 않고 *"셸 OR"* 라는
말로 적는다(그 자리에서 도는 참조: `grep -n "셸 OR" Dockerfile` · `grep -c '||' Dockerfile` → **0**,
각 N=1). **그 우회가 왜 필요했는지는 이 저장소가 답하지 않는다** —
「초안이 토큰 세기에 걸렸다」는 인계는 **저장소 밖의 값**이고 여기서는 근거로 쓰지 않는다(계획 0015
§후속 62). 근거로 쓰는 것은 **두 기준이 같은 트리에서 다른 답을 낸다**는 실측 하나이고, 그것이 M-A 다:
그 트리에서 이 파일은 **초록**이고 토큰 세기는 **1** 이다. 계획 0016 작업 1 의 완료 조건 1 은
`grep -c '||' Dockerfile` → 0 을 그 커밋의 확인으로 적었지만(**기록물이라 뒤늦게 갱신하지 않는다**),
**이 저장소에 남는 게이트는 이 파일**이므로 ADR 이 못박은 축을 따라 모양 쪽에 세웠다.

## 이 파일이 **보지 못하는** 것 (CLAUDE.md §6-1 ②)

- **주석.** 1·2 는 주석을 걷어 낸다(위 문단). 주석이 의존성을 열거해 낡는 것은 이 파일 밖이다.
- **다른 모양의 삼킴.** 잡는 모양은 셸 OR 하나다. `;` 로 이은 명령, `set +e`, `<명령> || true`,
  `SHELL` 교체는 **전부 이 단언을 지나간다** — 그 블라인드 스팟을 값으로 태운 것이 **M-C** 다.
- **이미지가 실제로 담게 되는 것.** 이 파일이 읽는 것은 `Dockerfile` 의 **글자**다. 그 명령이 도는
  이미지 안에 무엇이 들어가는지는 **빌드를 돌려야** 알고, 이 사이클은 그것을 재지 못했다
  (계획 0016 §확인하지 않은 것 72).
- **다른 설치 자리.** 보는 것은 `Dockerfile` 하나다 — CI 워크플로·`Makefile` 이 무엇을 설치하는지는
  이 대조 밖이다.

## 결함 있는 상태에서 실제로 죽는가 (CLAUDE.md §6-2 1 — 변이 실측, 각 N=1)

변이는 **한 자리씩** 심고, **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 그 사본으로
원복하고 루트 `git status --porcelain` 을 확인했다(§6-2 규칙 5 — 이 커밋이 처음 넣는 줄을 지우는 변이가
아니어도 같은 사본으로 다룬다). 명령은 매번
`pytest tests/invariants/test_the_image_installs_from_one_source.py -q`, 그리고 M-A 는 두 기준의 답이
갈리므로 `grep -c '||' Dockerfile` 을 **별도 호출**로 함께 적는다.

| 변이 | 무엇을 심었나 | 실행값(죽는 단언) | `grep -c` |
|---|---|---|---|
| 음성 대조군 | 없음(이 커밋의 트리) | **3 passed** | **0** |
| M-A | `Dockerfile` **주석 한 줄**에 그 토큰을 되살린다(`# 폴백(||)을 두지 않는다.`) | **3 passed** — 아무것도 죽지 않는다(주석은 셸이 실행하지 않는다) | **1** |
| M-B | `c82cf47` 이전의 `RUN … <셸 OR> pip install <이름들>` 줄을 그대로 되살린다 | **3 failed** — 1(모양)·2(대조)에 더해 **3(정본)까지** 죽는다: 그 줄은 `.` 말고 `psycopg[binary]` 도 설치한다 | **1** |
| M-C | `RUN pip install --no-cache-dir -e . ; true`(셸 OR 가 아닌 삼킴) | **3 passed** — 위 「보지 못하는 것」 둘째의 값 | 0 |
| M-D | `pyproject.toml` 의 이름 하나를 다시 적는다(`RUN pip install --no-cache-dir openpyxl` 한 줄 추가) | **2 failed, 1 passed** — 2(대조)와 3(정본)이 죽고 1(모양)은 산다 | 0 |
| M-E | `-e` 를 지운다(`RUN pip install --no-cache-dir .`) | **1 failed, 2 passed** — 3 만 죽는다 | 0 |

**M-B 의 값은 예측과 갈렸다**(예측 「2 failed」 ↔ 실측 **3 failed**) — 그래서 이 표의 칸은 생각이 아니라
실행값이다(CLAUDE.md §6-1 3회차: *"반증 목록을 실측 없이 생각으로"*).

**M-A 가 이 파일의 판정을 값으로 만든다**: 같은 트리에서 이 파일은 **초록**이고 토큰 세기는 **1** 이다.
두 기준은 여기서 다른 답을 낸다 — 이 파일은 ADR 0020 §5 셋째 행을 따라 **모양** 쪽에 선다.

**M-B ↔ M-D 가 이 표의 값이다**: 둘 다 「정본이 둘이 된다」인데 **모양으로는 갈리지 않는다**(M-D 에는
셸 OR 가 없다). 그래서 2 가 1 과 따로 서고, M-E 가 3 을 따로 태운다 — 세 단언이 서로를 가려 주지 않는다
(CLAUDE.md §6-2 3).
"""
from __future__ import annotations

import re
import shlex
import tomllib
from pathlib import Path

BUILDTWIN = Path(__file__).resolve().parents[2]
DOCKERFILE = BUILDTWIN / "Dockerfile"
PYPROJECT = BUILDTWIN / "pyproject.toml"

#: 셸이 **앞 절의 실패를 성공으로 바꾸는** 자리. ADR 0020 §2-1 항 1 이 이름으로 드는 그 모양이다.
#: 이 파일은 토큰을 우회 표기로 적지 않는다 — 금지되는 것이 토큰이 아니라는 것이 이 파일의 판정이고,
#: 그 판정을 자기 소스에서 뒤집으면 머리 주석이 거짓이 된다.
SHELL_OR = "||"

#: 그 안이 셸로 실행되는 명령. 나머지(`FROM`·`COPY`·`ENV` …)에는 셸 OR 라는 모양이 없다.
SHELL_INSTRUCTIONS = ("RUN", "CMD", "ENTRYPOINT")


def _instructions(text: str) -> list[tuple[str, str]]:
    """`Dockerfile` 을 (명령어, 인자) 로 편다 — **주석을 걷어 내고 줄 이음을 잇는다.**

    주석을 걷어 내는 것이 이 파일의 판정이다(머리 주석 「토큰이 아니라 모양」).
    """
    joined: list[str] = []
    current = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith("\\"):
            current += line[:-1].strip() + " "
            continue
        joined.append(current + line)
        current = ""
    if current:
        joined.append(current)
    out: list[tuple[str, str]] = []
    for line in joined:
        head, _, rest = line.partition(" ")
        out.append((head.upper(), rest.strip()))
    return out


def _shell_commands() -> list[str]:
    return [arg for kw, arg in _instructions(DOCKERFILE.read_text()) if kw in SHELL_INSTRUCTIONS]


def _distribution_names() -> set[str]:
    """`pyproject.toml` 이 소유한 배포 이름 — 버전 한정어·extras·마커를 벗긴다."""
    project = tomllib.loads(PYPROJECT.read_text())["project"]
    requirements = list(project.get("dependencies", []))
    for extra in project.get("optional-dependencies", {}).values():
        requirements.extend(extra)
    names = set()
    for req in requirements:
        name = re.split(r"[<>=!~;\[\s]", req.strip(), maxsplit=1)[0].strip()
        if name:
            names.add(name.lower())
    return names


def _name_pattern(name: str) -> str:
    """배포 이름의 표기 변종(`-` ↔ `_`)까지 한 패턴으로 — 이름 하나가 두 표기를 갖는다."""
    body = "".join("[-_]" if ch in "-_" else re.escape(ch) for ch in name)
    return rf"(?<![\w.-]){body}(?![\w-])"


def _pip_install_arguments(command: str) -> list[list[str]]:
    """한 셸 명령 안의 `pip install` 각각에 대해 **플래그가 아닌 인자**의 목록을 낸다."""
    runs: list[list[str]] = []
    tokens = shlex.split(command)
    i = 0
    while i < len(tokens) - 1:
        if tokens[i].endswith("pip") and tokens[i + 1] == "install":
            args: list[str] = []
            j = i + 2
            while j < len(tokens) and tokens[j] not in ("&&", ";", SHELL_OR):
                if not tokens[j].startswith("-"):
                    args.append(tokens[j])
                j += 1
            runs.append(args)
            i = j
            continue
        i += 1
    return runs


def test_the_image_build_has_no_shell_or_that_turns_a_failed_install_into_success() -> None:
    """1. 모양 — 셸 명령이 앞 절의 실패를 뒤 절로 덮지 않는다(ADR 0020 §2-1 항 1)."""
    offenders = [cmd for cmd in _shell_commands() if SHELL_OR in cmd]
    assert not offenders, (
        f"Dockerfile 의 셸 명령이 실패를 성공으로 바꾸는 셸 OR 를 갖는다: {offenders}. "
        "앞 절이 실패해도 뒤 절이 이미지를 완성하고 빌드는 rc 0 으로 끝난다 — "
        "그 침묵이 계획 0016 문 3 이다(ADR 0020 §2-1 항 1). 폴백을 지우고 실패를 rc 로 돌려 줘라."
    )


def test_the_image_does_not_enumerate_dependency_names_that_pyproject_owns() -> None:
    """2. 대조 — 설치 목록을 손으로 두 번 적지 않는다. **개수가 아니라 부재를 단언한다.**"""
    owned = _distribution_names()
    found: dict[str, str] = {}
    for _, argument in _instructions(DOCKERFILE.read_text()):
        lowered = argument.lower()
        for name in owned:
            if re.search(_name_pattern(name), lowered):
                found.setdefault(name, argument)
    assert not found, (
        f"pyproject.toml 이 소유한 이름이 Dockerfile 의 명령에 다시 적혀 있다: {found}. "
        "설치의 정본은 pyproject.toml 하나다 — 두 자리에 적으면 두 목록이 조용히 갈리고, "
        "그 차이가 이미지에만 남는다(계획 0016 §1-c 문 3)."
    )


def test_the_image_installs_the_project_itself_so_pyproject_stays_the_one_source() -> None:
    """3. 정본 — `pip install` 이 프로젝트 자신만 설치한다. 지워진 폴백은 `-e .` 도 버렸다."""
    installs = [args for cmd in _shell_commands() for args in _pip_install_arguments(cmd)]
    assert installs, "Dockerfile 에 pip install 이 없다 — 이 이미지는 프로젝트를 설치하지 않는다."
    assert all(args == ["."] for args in installs), (
        f"pip install 이 프로젝트 자신(`.`) 말고 다른 것을 설치한다: {installs}. "
        "설치의 정본은 pyproject.toml 하나이고, 여기 이름을 적으면 그 자리가 둘째 정본이 된다."
    )
    editable = [cmd for cmd in _shell_commands() if "pip install" in cmd and "-e" in shlex.split(cmd)]
    assert editable, (
        "Dockerfile 의 pip install 이 `-e .` 로 프로젝트를 설치하지 않는다 — "
        "지워진 폴백이 정확히 그것을 버렸고, 그 이미지는 프로젝트 자신 없이 완성된다."
    )
