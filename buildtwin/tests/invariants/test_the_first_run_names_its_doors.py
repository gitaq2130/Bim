"""`make dev` 의 **선행 안내**가 문의 이름과 다음 명령을 말하는가 — 담당: qa (심사 0016 R2).

## 왜 있는가 — 그 안내를 오늘 아무도 읽지 않는다

계획 0016 §작업 분배 4행과 `ddf6bb9` 의 제목은 그 커밋이 **작업 1·2·3 을 붙든다**고 적는데, 작업 3 이
만든 것은 `Makefile` 의 `dev` 레시피에 있는 **안내 줄**이고 그것을 읽는 단언은 서지 않았다.
이 트리에서 다시 잰 값(각 N=1, 변이는 한 자리 + 심기 직전의 작업 트리 사본과 `diff`, 그 사본으로 원복):

| 변이(이 파일이 **서기 전**) | `pytest tests/invariants tests/regression -q` |
|---|---|
| 데몬 안내 세 줄을 통째로 지운다 | **123 passed**(= 115 + 8, **무변화**) |
| 문 1(`.env`) 안내 한 줄을 지운다 | **123 passed**(**무변화**) |

부재로도 같은 답이 나온다(트리를 명령 안에 못박는다, 각 N=1):
`git grep -n "_recipe(" f3eeeeb -- buildtwin/tests` 가 부르는 타깃은 `"seed-compose"`·`"seed"` 이고
**`"dev"` 는 없다**; `git grep -nI "닿지 못하면" f3eeeeb -- buildtwin/tests buildtwin/apps` 는 **rc 1 = 히트 0**.
`git grep -nI "docker API at unix" f3eeeeb -- buildtwin/tests buildtwin/apps` 는 **히트 1** 인데 그것은
이웃 파일 **머리 주석**의 산문(이 환경에 데몬이 없다는 관측)이고 **단언이 아니다** — 인계된 「단언 0」은
그 뜻이다.

**문 1 안내도 같은 자리다.** 이웃 파일(`test_demo_stack_can_stand.py`)의 ③ 이 붙드는 것은
`docker compose config` 의 **rc** 와 그 config 가 싣는 값이지 **안내 문자열**이 아니다 — 그 줄을
지워도 rc 는 그대로다.

**그래서 세운다.** CLAUDE.md §6-4 는 사용자에게 보이는 문구를 *"장식이 아니라 CM 이 다음 행동을 고르는
유일한 입력"* 이라 적고(그 자리에서 도는 참조: `grep -n "작동하지 않는 안전 장치" ../../CLAUDE.md`),
이 두 문의 안내는 **그 자리의 문자열을 저장소가 쓰지 않기 때문에**(사용자가 보는 것은 compose 와
docker 가 쓴 것이고, 그 문자열은 **다음에 칠 명령**을 말하지 않는다) 저장소가 그 **앞에** 미리 두는
문자열이다(ADR 0020 §2-1 항 3 의 마지막 문장 · §2-2 (다)). 계약이 있는데 게이트가 없으면 다음 편집이
그것을 조용히 지운다 — 위 표가 그 값이다. **그리고 이 게이트는 데몬을 요구하지 않는다**: 안내가
`dev` 레시피에 있는지는 **파일을 읽으면 답이 나온다.**

## 무엇을 보는가 — `Makefile` 을 읽을 뿐 **docker 를 부르지 않는다**

- **선행성**: `dev` 레시피가 실제로 `docker compose up` 을 돌리고(이것이 없으면 아래 둘이 **공허하게
  참**이 된다 — §6-2 1), 두 문의 안내가 그 명령 **앞**에 있다. 뒤에 있는 안내는 영원히 출력되지 않는다.
- **문 1(`.env`)**: 안내가 그 파일 이름(ⓘ)과 사용자가 보게 될 stderr 의 조각을 말하고, **다음에 칠
  명령**(ⓚ)을 이름한다. 그리고 그 명령이 **이 `Makefile` 에 실재하는 타깃**이다.
- **문 2(docker 데몬)**: 안내가 소켓(ⓘ)을 말하고, 확인 명령과 다시 칠 명령(ⓚ)을 이름한다. 그리고
  조건절이 **닿지 못하는 두 갈래**(꺼져 있다 · 소켓 권한이 없다)를 다 담는다 — ADR 0020 §2-2 (다)의
  마감 정정이 「없으면」을 좁다고 판정한 바로 그 자리다(CLAUDE.md §6-3).

**개수를 세지 않는다**(§6-1 9회차): 아래 어느 단언도 줄 수·안내 수를 보지 않고, **무엇이 있는가**와
**무엇이 없는가**만 본다.

## 이 파일이 **보지 못하는** 것 (§6-1 ②)

- **그 조각이 실제로 그 stderr 에 나오는가.** 안내가 그 조각을 담는지만 본다. 문 2 의 조각은 이
  사이클의 누구도 재지 못했고(이 환경에 데몬이 없다 — ADR 0020 §2-2 (다)의 *한정*), 그래서 안내
  자신도 *"같은 조각이 나오면 그 문이다"* 로 적혀 있다. 문 1 의 조각은 `docker compose config` 로
  잴 수 있지만 **이 파일은 docker 를 부르지 않는다** — 이웃 파일의 ③ 이 그 rc 를 진다.
- **사용자가 그 줄을 실제로 보는가.** `make dev` 를 돌리지 않는다(그 명령은 데몬을 요구한다).
  `@echo` 가 `dev` 레시피의 명령 앞에 있다는 것까지가 이 파일의 값이다.
- **다른 레시피의 안내**(`seed` · `seed-compose` · `api` · `env`). 이 파일은 `dev` 하나만 읽는다 —
  그 셋은 첫 실행 경로의 **다른 문**이고 ADR 0020 §2-1 의 적용 범위 안에 있지만, 이 커밋은 그것을
  게이트로 세우지 않는다.
- **문구가 좋은 문구인가.** 이름과 명령이 거기 있는지만 본다.

## 결함 있는 상태에서 실제로 죽는가 (§6-2 1 — 변이 실측, 각 N=1)

변이는 **한 자리씩** 심고 **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 그 사본으로
원복하고 루트 `git status --porcelain` 을 확인했다(§6-2 규칙 5 — `Makefile` 은 이 커밋이 만드는 파일이
아니므로 `git diff` 로도 보이지만, 확인은 사본으로 한다).
명령은 매번 `pytest tests/invariants/test_the_first_run_names_its_doors.py -q`.

| 변이 | 무엇을 심었나 | 실행값(죽는 단언) |
|---|---|---|
| 음성 대조군 | 없음(이 커밋의 트리) | **3 passed** |
| Y1 | 데몬 안내 세 줄을 통째로 지운다(= 작업 3 을 되돌린다) | **1 failed, 2 passed** — 문 2(ⓘ `docker.sock` 이 없다) |
| Y2 | 문 1(`.env`) 안내 한 줄을 지운다 | **1 failed, 2 passed** — 문 1(ⓘ `.env` 가 없다) |
| Y3 | 데몬 안내 세 줄을 `docker compose up --build` **뒤로** 옮긴다(지우지 않는다) | **1 failed, 2 passed** — 문 2. 안내는 파일에 **그대로 있는데** 명령 뒤라 죽는다 |
| Y4 | 데몬 안내의 조건절을 `닿지 못하면(꺼져 있으면)` 으로 좁힌다(권한 갈래를 뺀다) | **1 failed, 2 passed** — 문 2 의 조건절(`권한` 갈래가 없다) |
| Y5 | `docker compose up --build` 줄을 지운다(= 탐침 자신에 대한 변이) | **3 failed** — 선행성과, 같은 탐침에 기대는 문 둘. **침묵하지 않는다** |

**Y3 이 Y1 과 다른 칸인 것이 이 표의 값이다**: 안내가 **있는데 늦게 있는** 트리는 「지워진 트리」와
grep 으로는 갈리지 않고, 사용자에게는 **둘 다 아무 말도 하지 않는다**(그 줄은 명령이 죽은 뒤에 나온다).
**Y5 는 탐침 자신을 태운다**(§6-2 5): `docker compose up` 이 사라지면 「안내가 명령 앞에 있다」는
공허하게 참이 될 수 있는 자리이고, 그때 죽는 것은 선행성 단언이어야지 침묵이어서는 안 된다.
"""
from __future__ import annotations

from tests.invariants.test_demo_stack_can_stand import MAKEFILE, _recipe

#: `dev` 레시피가 실제로 무엇을 돌리는가 — 이 이름이 사라지면 아래 선행성 단언이 공허해진다.
DOOR_OPENING_COMMAND = "docker compose up"


def _dev_recipe() -> tuple[list[str], list[str]]:
    """`make dev` 레시피를 (**명령 전에 보이는 줄**, 그 뒤의 줄)로 가른다.

    `@echo` 가 아닌 **첫** 줄에서 가른다 — 그 줄이 사용자가 문에 부딪히는 자리이고, 그 뒤의 `@echo` 는
    명령이 죽으면 영원히 나오지 않는다.
    """
    recipe = _recipe("dev")
    assert recipe, f"{MAKEFILE.name} 에 `dev` 레시피가 없다 — 이 파일의 모든 단언이 공허해진다."
    running = [line for line in recipe if not line.startswith("@echo")]
    assert running, (
        f"`dev` 레시피가 `@echo` 말고 아무것도 돌리지 않는다: {recipe} — 안내만 있고 명령이 없으면 "
        "「안내가 명령 앞에 있다」는 아무 말도 하지 않는다."
    )
    cut = recipe.index(running[0])
    return recipe[:cut], recipe[cut:]


def _before_text() -> str:
    """명령 전에 사용자가 보는 안내 전체(한 문자열). 줄바꿈은 표기 변종이므로 조각으로만 찾는다."""
    before, _ = _dev_recipe()
    return "\n".join(before)


def test_the_dev_recipe_runs_the_command_that_hits_the_doors_and_warns_first() -> None:
    """선행성 — `dev` 가 실제로 그 명령을 돌리고, 안내가 그 **앞**에 있다.

    이 단언이 먼저 있어야 아래 둘이 공허하지 않다(§6-2 1): 명령이 없으면 「앞에 있다」는 무엇이든
    만족하고, 안내가 없으면 아래 둘이 죽어야 한다.
    """
    before, running = _dev_recipe()
    assert any(DOOR_OPENING_COMMAND in line for line in running), (
        f"`dev` 레시피가 `{DOOR_OPENING_COMMAND}` 를 돌리지 않는다: {running} — 이 파일이 붙드는 안내는 "
        "그 명령이 부딪히는 문들의 것이다."
    )
    assert before, (
        f"`dev` 레시피가 `{DOOR_OPENING_COMMAND}` 앞에 아무 말도 하지 않는다 — 첫 실행의 실패는 "
        "저장소가 그 앞에 둔 문자열이 없으면 문의 이름을 말하지 못한다(ADR 0020 §2-1 항 3)."
    )


def test_the_dev_recipe_names_the_env_file_door_and_the_command_that_opens_it() -> None:
    """문 1 — 안내가 `.env`(ⓘ)와 사용자가 보게 될 조각을 말하고 **다음에 칠 명령**(ⓚ)을 이름한다.

    그리고 그 명령이 **이 `Makefile` 에 실재하는 타깃**이어야 한다 — 없는 명령을 이름하는 안내는
    §6-4 3 이 금지하는 「참일 수 없는 말」이다.
    """
    guidance = _before_text()
    for named in (".env", "env file", "not found", "make env"):
        assert named in guidance, (
            f"`dev` 의 선행 안내가 `{named}` 를 말하지 않는다 — 문 1 은 compose 가 **파일 해석 단계에서** "
            f"죽는 자리이고, 그때 사용자가 보는 것은 compose 의 stderr 뿐이다. 안내: {guidance!r}"
        )
    assert _recipe("env"), (
        f"안내가 `make env` 를 이름하는데 {MAKEFILE.name} 에 그 타깃의 레시피가 없다 — "
        "없는 명령을 다음에 칠 것으로 적으면 그 안내가 사용자를 막다른 곳으로 보낸다."
    )


def test_the_dev_recipe_names_the_docker_daemon_door_and_both_ways_it_closes() -> None:
    """문 2 — 안내가 소켓(ⓘ)·확인 명령·다시 칠 명령(ⓚ)을 말하고, **닿지 못하는 두 갈래**를 다 담는다.

    조건절이 「데몬이 꺼져 있으면」 하나로 좁으면 **소켓 권한이 없는 경우**가 그 밖으로 나간다 —
    ADR 0020 §2-2 (다)의 마감 정정이 그 좁힘을 판정한 자리이고(CLAUDE.md §6-3), 문안이 그 조건절의
    정본이다.
    """
    guidance = _before_text()
    for named in ("docker.sock", "docker info", "make dev"):
        assert named in guidance, (
            f"`dev` 의 선행 안내가 `{named}` 를 말하지 않는다 — 그 자리에서 사용자가 보는 것은 docker 가 "
            f"쓴 문자열뿐이고 그것은 다음에 칠 명령을 말하지 않는다(ADR 0020 §2-3 셋째 행: ⓙ 는 아직 "
            f"일어나지 않았고 ⓘⓚ 는 저장소가 안다). 안내: {guidance!r}"
        )
    for branch in ("꺼져", "권한"):
        assert branch in guidance, (
            f"데몬 안내의 조건절이 `{branch}` 갈래를 담지 않는다 — 「데몬이 없으면」으로 좁히면 데몬이 "
            f"살아 있는데 소켓 권한이 없는 사용자에게 그 안내가 자기 문을 말해 주지 못한다. 안내: {guidance!r}"
        )
