"""「`make dev` 가 설 수 있는가」를 붙드는 회귀 — 담당: qa (계획 0015 작업 2·3·7, 문 1·2·3·4).

## 왜 있는가

사용자가 곧 치는 명령 둘(`make dev` + `make seed`)이 지나는 문 넷 중 **앞의 둘을 오늘 어느 게이트도
보지 않는다**(계획 0015 §1-d 의 곱 표: 20칸 중 18칸이 「못 본다」). 두 문은 **같은 파일**에 있다 —
파일의 **존재**가 문 1(`docker compose config` 가 `env file …/.env not found` 로 죽는다)을,
그 안의 `JWT_SECRET` 이 문 2(compose 의 postgres URL 에서 `resolve_jwt_secret()` 이 RuntimeError)를
연다. 작업 1 이 그 파일을 만드는 명령(`make env`)을 두었고, 이 파일이 **그 명령이 실제로 두 문을
닫는지**를 값으로 붙든다.

## 무엇을 보는가 — 여섯이고, 다섯은 docker 를 부르지 않는다

1. `make env` 가 **없는** `.env` 를 만들고 그 `JWT_SECRET` 이 비어 있지 않다. 값은 **난수**다
   (서로 다른 두 사본에서 다른 값이 나온다) — 저장소에 상수로 있지 않다는 것이 CLAUDE.md §3-4 다.
2. `make env` 는 **있는** `.env` 를 한 바이트도 바꾸지 않는다(ADR 0019 §2-3). 사용자가 고친 파일로
   두 번 돌려 바이트 동일 + 그 사람이 적은 값이 살아 있다(양성).
3. `docker compose config` 가 **`.env` 없이 rc≠0**(양성 대조군 — 문 1 이 실재한다)이고
   **`make env` 뒤 rc=0** 이며, 그 config 의 `api` 서비스 환경에 그 파일의 `JWT_SECRET` 이 실린다.
   **`docker` CLI 나 compose 플러그인이 없으면 skip**(아래 「도구 부재」).
4. compose 파일이 적는 postgres URL 로 `resolve_jwt_secret()` 이 **빈 시크릿에서 RuntimeError**,
   난수 시크릿에서 그 값을 낸다 — 문 2 의 기전 자신. **docker 를 부르지 않는다.**
5. **문 3**(작업 3): compose 갈래의 시드 명령(`make seed-compose`)이 **compose 의 DB 를 쥔 서비스**
   안에서 ADR 0018 §2-2 의 명령을 돌리고, 호스트 `make seed` 는 **docker 를 지나지 않는다**.
   `Makefile` 의 레시피와 `docker-compose.yml` 의 서비스 목록을 **함께** 읽어 갈리는지 본다 —
   서비스 이름이 바뀌면 그 명령은 오늘 **데몬이 있는 자리에서만** 죽는다(이 환경에는 데몬이 없다).
   **docker 를 부르지 않는다**(파일 둘을 읽을 뿐이다).
6. **문 4 의 철자**(작업 7): `docker-compose.yml` 의 `web.environment` **키**와
   `apps/web/vite.proxy-target.ts` 의 `API_PROXY_TARGET_ENV` **값**이 같은 문자열인지, 그리고 그
   compose 가 주는 대상이 **자기 자신이 아닌 compose 서비스**를 그 서비스가 듣는 포트로 가리키는지.
   ⑤ 와 같은 「파일 둘을 함께 읽는」 모양이다. **docker 를 부르지 않는다.**

**3 이 rc 만 보지 않는 이유가 이 파일의 요점이다.** 계획 0015 §1-e 첫째 행이 기각한 처방
(`env_file: [{path: .env, required: false}]`)은 rc 를 **rc=0 으로 만들면서 문 2 를 그대로 남긴다** —
즉 rc 만 보는 단언은 「실패가 기동 전에서 로그인으로 밀린 트리」를 초록이라 부른다. 아래 변이 표의
**M2** 가 그 모양을 실제로 심어서 잰 값이고, 그 변이에서 rc 는 **0** 인데 3 이 죽는다.

## 도구 부재를 음성 관측으로 읽지 않는다 (계획 0015 §후속 46)

부재에는 **두 층**이 있고 이 파일은 그 둘을 갈라 적는다: ⓐ `docker` CLI 가 없다 ⓑ CLI 는 있는데
`docker compose` 플러그인이 없다. 어느 쪽이든 3 은 **skip 으로 보고**되고 나머지 셋은 그대로 돈다 —
그래서 도구가 없는 환경에서도 이 파일이 통째로 침묵하지 않는다. **데몬은 어느 단언도 요구하지
않는다**: `docker compose config` 는 데몬 없이 돈다(잰 트리에서 `docker info` 는
*"failed to connect to the docker API at unix:///var/run/docker.sock"* 를 낸다, N=1).
skip 수는 `pytest -q` 한 줄 요약에 실린다(아래 M5 의 값) — 사유까지 보려면 `-rs` 가 필요하다.

## 이 파일이 **보지 못하는** 것 (§6-1 ②)

- **사용자의 실제 `.env`.** 그 파일은 커밋되지 않으므로(`.gitignore` 첫 줄) 여기서는 **사본**만
  만든다. 「이 개발자의 `.env` 가 옳은가」는 이 회귀 밖이다(계획 0015 §리스크 5).
  4 는 `Settings(_env_file=None, …)` 로 그 파일을 **일부러 읽지 않는다** — 읽으면 이 단언의 값이
  실행하는 사람의 환경에 따라 갈린다.
- **컨테이너가 실제로 뜨는가.** `config` 는 파일 해석까지다. `docker compose up --build` 는 이
  사이클의 누구도 돌리지 않았다(계획 0015 §확인하지 않은 것 43·60 — 데몬 부재).
- **`docker compose exec` 의 실제 동작.** 5 는 **배선의 이름**(어느 서비스·어느 명령)만 읽는다 —
  그 컨테이너 안에서 `python -m services.api.seed` 가 실제로 돌아 rc 0 을 내는지는 데몬을 요구하고,
  이 사이클이 재지 않았다(계획 0015 §확인하지 않은 것 60·62).
- **문 4 의 나머지 반쪽.** 6 은 **철자와 대상**만 본다 — 그 프록시가 실제로 도는지, 즉
  `resolveApiProxyTarget()` 이 정말 그 대상을 정하는지는 이 파일 밖이다. 그것은
  `tests/e2e/conftest.py` 의 preview 설정이 **그 함수를 실제로 부르게** 되면서 `make e2e` 가 본다
  (같은 커밋). 그리고 **compose 로 뜬 web 컨테이너 안에서** 프록시가 api 에 닿는지는 둘 다 못 본다
  — 데몬을 요구한다.
- **이미지 안의 것.** 이 파일은 `Dockerfile` 을 **열지 않는다** — 그 안에서
  `python -m services.api.seed` 가 도는지도 못 본다(계획 0015 §확인하지 않은 것 62).
  **그러나 「저장소가 그것을 못 본다」는 뜻이 아니다**: `Dockerfile` 이 무엇을 설치한다고 **적는지**는
  같은 디렉터리의 `test_the_image_installs_from_one_source.py` 가 `pyproject.toml` 과 대조한다
  (계획 0016 작업 4). 그 파일도 **읽을 뿐 빌드하지 않으므로**, 이미지가 실제로 담게 되는 것은
  두 파일 어디에도 없다 — 그것은 빌드를 돌려야 알고 이 사이클은 재지 못했다.
- **`make env` 가 만든 파일의 권한.** 레시피는 `umask 077` 로 쓰지만(잰 값 `-rw-------`) 이 파일은
  그것을 단언하지 않는다 — 만든 사람의 umask·파일시스템에 따라 갈리는 값이라 여기서 계약으로
  삼으면 남의 환경에서 거짓 양성이 된다.

## 결함 있는 상태에서 실제로 죽는가 (§6-2 1 — 변이 실측, 각 N=1)

변이는 **한 자리씩** 심고 **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고,
사본으로 원복하고 루트 `git status --porcelain` 을 확인했다(§6-2 규칙 5). 표 전체를 **작업 7 에서
다시 쟀다** — ⑥ 이 들어와 모든 칸의 통과 수가 하나씩 올라가므로, 옛 값을 그대로 두면 이 표가
자기 파일에 대해 거짓이 된다. 명령은 매번 `pytest tests/invariants/test_demo_stack_can_stand.py -q`.

| 변이 | 무엇을 심었나 | 실행값(죽는 단언) |
|---|---|---|
| 음성 대조군 | 없음(이 커밋의 트리) | **6 passed** |
| M1 | `Makefile` 의 `env` 타깃을 **무동작**(`@true`)으로(= 작업 1 을 되돌린다) | **2 failed, 4 passed** — ①이 *"make env 를 돌렸는데 .env 가 없다"*, ③이 *"make env 뒤에도 `docker compose config` 가 rc≠0 다"* |
| M2 | `env` 타깃이 `.env` 를 만들되 `JWT_SECRET=` **빈 값**으로(= `.env.example` 복사와 같은 모양, `required: false` 처방과 같은 자리) | **2 failed, 4 passed** — ①이 *"JWT_SECRET 이 비어 있다"*, ③이 api 서비스 환경 단언에서 죽는다. **같은 변이의 사본에서 `docker compose config` 를 손으로 쳐 보면 rc 는 `0` 이다**(N=1) — rc 만 보는 단언이었으면 ③이 초록이었다 |
| M3 | `env` 타깃의 `[ -e .env ]` 갈래를 `if false` 로 바꿔 **언제나 덮어쓰게** 한다 | **1 failed, 5 passed** — ②만 죽는다(해시가 갈린다) |
| M4 | `packages/core/settings.py` 의 `raise RuntimeError(...)` → `return ""`(문 2 의 기전을 없앤다) | **1 failed, 5 passed** — ④만 죽는다(`DID NOT RAISE`) |
| M5 | 이 파일의 `_NO_COMPOSE_CLI` 를 강제로 채운다(= docker 부재를 흉내낸다) | **5 passed, 1 skipped** — 한 줄 요약이 skip 수를 싣는다 |
| M6 | `seed-compose` 의 서비스 이름을 compose 에 **없는 이름**(`apiserver`)으로 | **1 failed, 5 passed** — ⑤ |
| M7 | `seed-compose` 가 ADR 0018 §2-2 의 명령이 아닌 것(`python -c "print(1)"`)을 돌린다 | **1 failed, 5 passed** — ⑤ |
| M8 | **호스트** `seed` 레시피를 `docker compose exec …` 로 바꾼다(두 갈래를 뭉갠다) | **1 failed, 5 passed** — ⑤ |
| M9 | `docker-compose.yml` 의 `web.environment` **키**를 `API_PROXY_TARGET` 으로(= architect 가 문 4 를 다시 연 그 변이) | **1 failed, 5 passed** — ⑥ |
| M10 | `apps/web/vite.proxy-target.ts` 의 `API_PROXY_TARGET_ENV` 를 `"API_PROXY_TARGET"` 으로(= 반대쪽 철자) | **1 failed, 5 passed** — ⑥ |
| M11 | compose 가 주는 **값**을 `http://localhost:8000`(= `DEFAULT_API_PROXY_TARGET`)으로 | **1 failed, 5 passed** — ⑥ |
| M12 | compose 의 `web` 에서 `environment` 블록을 **통째로 지운다**(작업 5 이전 트리의 모양) | **1 failed, 5 passed** — ⑥ 이 *"compose 의 web 이 `BUILDTWIN_API_PROXY_TARGET` 을 주지 않는다(준 이름: [])"* 로 죽는다 |

**M6 은 「이름이 갈리는 것」의 값이다**: compose 의 서비스 이름을 바꾸는 커밋은 `make seed-compose` 를
조용히 부러뜨릴 수 있고, 그 손해는 오늘 **데몬이 있는 자리에서만** 보인다 — ⑤ 가 그것을 파일 둘의
대조로 앞당긴다.

**M1 ↔ M2 가 이 표의 값이다**: 둘 다 「데모가 서지 않는다」인데 **rc 로는 갈리지 않는다**(M1 은
rc≠0, M2 는 rc=0). 그래서 ③ 은 rc 와 **그 config 가 싣는 값**을 함께 본다(§6-2 4: 두 사실이 함께여야
의미가 있으면 함께 단언한다).

**M9~M11 이 ⑥ 이 새로 사는 이유다.** 이 커밋 **이전** 트리에서 architect 가 같은 M9 를 심고 잰 값은
**invariants 111 · vitest 289 전부 초록**이었다 — 문 4 가 조용히 다시 열려도 어느 게이트도 갈리지
않았다. M9 와 M10 이 **같은 계약의 양쪽 끝**이라 어느 쪽을 고쳐도 ⑥ 이 죽는 것이 요점이다: 이
대조는 「어느 파일이 옳은가」를 말하지 않고 **둘이 갈렸다**만 말한다.

**M12 는 탐침 자신에 대한 변이다**(§6-2 5 의 자리). architect 실측: 작업 5 이전 트리의 `web` 에는
그 키가 `{}` 도 `null` 도 아니라 **아예 없었다**. `svc["environment"]` 나 `svc.get("environment").get(…)`
로 읽는 탐침은 그 상태에서 `KeyError`/`AttributeError` 로 **터진다** — 그러면 보고되는 것은 「문이
열렸다」가 아니라 「탐침이 부러졌다」이고 둘은 다른 사실이다. `_service_environment` 가
`… or {}` 로 읽는 근거가 그것이고, M12 가 그 자리를 값으로 태운다.

## 이 파일이 postgres 축에 무엇을 하는가 (계획 0015 §후속 69)

**아무것도 하지 않는다.** 이 트리(`tests/invariants`)에는 축 기구가 없고(축은 `tests/integration` ·
`tests/unit` 두 트리의 것이다 — `tests/helpers/postgres_axis.py`), 이 파일의 어느 단언도 DB 엔진을
만들지 않는다. 그래서 `tests/postgres.floor.json` 의 두 바닥값은 이 커밋에서 **움직이지 않는다** —
`_measured_at` 이 기대는 부재("이 커밋 뒤에 들어온 단위/통합 테스트 중 축 엔진 위에서 SQL 을
실행하는 것이 없다")도 그대로 참이다. 이 파일이 만드는 유일한 상태는 **`tmp_path` 안의 사본**이고
저장소 파일을 쓰지 않는다.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

import pytest
import yaml

from packages.core.settings import Settings

#: `tests/invariants/이 파일` → tests → buildtwin.
BUILDTWIN = Path(__file__).resolve().parents[2]
MAKEFILE = BUILDTWIN / "Makefile"
COMPOSE = BUILDTWIN / "docker-compose.yml"
ENV_EXAMPLE = BUILDTWIN / ".env.example"
PROXY_TARGET_TS = BUILDTWIN / "apps" / "web" / "vite.proxy-target.ts"

#: 난수 시크릿의 최소 길이. `secrets.token_urlsafe(32)` 는 43자다 — 이 문턱은 「한 글자짜리
#: 시크릿도 비어 있지 않다」를 막는 하한이지 그 길이의 계약이 아니다.
MIN_SECRET_CHARS = 20

DOCKER = shutil.which("docker")


def _no_compose_cli() -> str | None:
    """compose CLI 가 없는 **층**을 이름으로 돌려준다(없으면 `None`). 데몬은 묻지 않는다."""
    if DOCKER is None:
        return "docker CLI 가 없다 — 도구 부재를 음성 관측으로 읽지 않는다(계획 0015 §후속 46)"
    probe = subprocess.run([DOCKER, "compose", "version"], capture_output=True, text=True, check=False)
    if probe.returncode != 0:
        return "docker CLI 는 있으나 compose 플러그인이 없다(`docker compose version` 이 실패한다)"
    return None


_NO_COMPOSE_CLI = _no_compose_cli()
requires_compose_cli = pytest.mark.skipif(_NO_COMPOSE_CLI is not None, reason=_NO_COMPOSE_CLI or "")


def _tree_with_compose(path: Path) -> Path:
    """저장소 밖 사본. **저장소 루트에 `.env` 를 만들지 않는다** — 그 파일은 이 세션 밖 사람의 환경이다."""
    path.mkdir(parents=True)
    shutil.copy(COMPOSE, path / COMPOSE.name)
    return path


def _make_env(cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["make", "-f", str(MAKEFILE), "env"], cwd=cwd, capture_output=True, text=True, check=False
    )


def _jwt_secret_of(env_file: Path) -> str:
    """`.env` 가 싣는 `JWT_SECRET`. 키가 아예 없으면 빈 문자열 — **부재와 빈 값을 같은 칸에 둔다**
    (문 2 는 둘을 구별하지 않는다: `resolve_jwt_secret` 은 falsy 면 거부한다)."""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("JWT_SECRET="):
            return line.split("=", 1)[1].strip()
    return ""


def _compose_config(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    assert DOCKER is not None  # skipif 가 이미 걸렀다
    return subprocess.run(
        [DOCKER, "compose", "config", *args], cwd=cwd, capture_output=True, text=True, check=False
    )


def _api_service() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]["api"]


def test_make_env_writes_a_random_secret_when_env_is_absent(tmp_path: Path) -> None:
    """① `.env` 가 없으면 만들고, 그 `JWT_SECRET` 은 **비어 있지 않은 난수**다(CLAUDE.md §3-4)."""
    first, second = _tree_with_compose(tmp_path / "a"), _tree_with_compose(tmp_path / "b")
    assert not (first / ".env").exists(), "사본에 이미 .env 가 있다 — 이 시나리오의 전제가 깨졌다"

    for tree in (first, second):
        proc = _make_env(tree)
        assert proc.returncode == 0, f"make env 가 rc={proc.returncode} 로 죽었다: {proc.stderr.strip()}"
        assert (tree / ".env").is_file(), (
            "make env 를 돌렸는데 .env 가 없다 — compose 는 이 파일이 있어야 해석된다"
            "(문 1: `env file …/.env not found`)."
        )

    secrets_found = [_jwt_secret_of(tree / ".env") for tree in (first, second)]
    for value in secrets_found:
        assert value, "만들어진 .env 의 JWT_SECRET 이 비어 있다 — 문 2 가 열린 채다(값은 싣지 않는다)"
        assert len(value) >= MIN_SECRET_CHARS, "JWT_SECRET 이 난수라기에는 너무 짧다(값은 싣지 않는다)"
    assert secrets_found[0] != secrets_found[1], (
        "서로 다른 두 사본이 같은 JWT_SECRET 을 받았다 — 상수를 심었다는 뜻이다(CLAUDE.md §3-4)."
    )
    for source in (MAKEFILE, ENV_EXAMPLE):
        text = source.read_text(encoding="utf-8")
        assert all(value not in text for value in secrets_found), f"{source.name} 이 그 시크릿을 상수로 담고 있다"


def test_make_env_does_not_touch_an_existing_env(tmp_path: Path) -> None:
    """② 있는 `.env` 는 **한 바이트도** 바꾸지 않는다(ADR 0019 §2-3) — 양성: 그 사람의 값이 살아 있다."""
    tree = _tree_with_compose(tmp_path / "kept")
    env_file = tree / ".env"
    mine = "JWT_SECRET=mine-not-random\nMINIO_BUCKET=custom\n"
    env_file.write_text(mine, encoding="utf-8")
    before = hashlib.sha256(env_file.read_bytes()).hexdigest()

    for _ in range(2):
        proc = _make_env(tree)
        assert proc.returncode == 0, f"make env 가 rc={proc.returncode} 로 죽었다: {proc.stderr.strip()}"

    after = hashlib.sha256(env_file.read_bytes()).hexdigest()
    assert after == before, (
        "make env 가 이미 있는 .env 를 바꿨다 — 그 파일은 사용자의 개발 환경이다(계획 0015 §리스크 2)."
    )
    assert env_file.read_text(encoding="utf-8") == mine, "사용자가 적은 값이 살아남지 않았다"


@requires_compose_cli
def test_compose_config_fails_without_env_and_stands_after_make_env(tmp_path: Path) -> None:
    """③ 문 1 이 실재하고(rc≠0), `make env` 뒤 서고(rc=0), 그 시크릿이 **api 서비스까지 간다**."""
    tree = _tree_with_compose(tmp_path / "gate")

    before = _compose_config(tree)
    assert before.returncode != 0, (
        "`.env` 가 없는데 `docker compose config` 가 rc=0 이다 — 문 1 이 실재하지 않는다.\n"
        "compose 가 `env_file` 을 `required: false` 로 바꾼 것이라면 그것은 결함이 아니라 **결정**이고, "
        "계획 0015 §1-e 첫째 행이 그 처방 단독을 기각한 근거(실패가 기동 전에서 로그인으로 밀린다)를 "
        "먼저 읽어야 한다."
    )
    assert ".env" in before.stderr, f"문 1 의 실패가 .env 를 이름으로 부르지 않는다: {before.stderr.strip()}"

    proc = _make_env(tree)
    assert proc.returncode == 0, f"make env 가 rc={proc.returncode} 로 죽었다: {proc.stderr.strip()}"

    after = _compose_config(tree, "--format", "json")
    assert after.returncode == 0, (
        f"make env 뒤에도 `docker compose config` 가 rc={after.returncode} 다: {after.stderr.strip()}"
    )
    api_env = json.loads(after.stdout)["services"]["api"]["environment"]
    carries_secret = api_env.get("JWT_SECRET") == _jwt_secret_of(tree / ".env")
    assert api_env.get("JWT_SECRET"), (
        "compose 가 서기는 하는데 api 서비스의 JWT_SECRET 이 비어 있다 — rc 만 보면 초록인 자리다"
        "(문 2 는 스택이 다 뜬 뒤 로그인에서 죽는다)."
    )
    assert carries_secret, "api 서비스가 실은 JWT_SECRET 이 그 .env 의 값이 아니다(값은 싣지 않는다)"


def test_the_compose_postgres_url_refuses_an_empty_secret() -> None:
    """④ 문 2 의 기전 — compose 가 적는 URL 에서 빈 시크릿은 거부되고 난수 시크릿은 통과한다."""
    api = _api_service()
    declared = [entry if isinstance(entry, str) else entry.get("path") for entry in api["env_file"]]
    assert ".env" in declared, f"compose 의 api 가 `.env` 를 선언하지 않는다: {declared}"

    url = api["environment"]["DATABASE_URL"]
    for absent in (None, ""):
        with pytest.raises(RuntimeError):
            Settings(_env_file=None, database_url=url, jwt_secret=absent).resolve_jwt_secret()

    value = secrets.token_urlsafe(32)
    resolved = Settings(_env_file=None, database_url=url, jwt_secret=value).resolve_jwt_secret()
    assert resolved == value, "시크릿을 준 뒤에도 compose 의 URL 에서 토큰 시크릿이 서지 않는다"


def _recipe(target: str) -> list[str]:
    """`Makefile` 의 그 타깃 레시피 줄들(탭 제거). 빈 줄은 건너뛰고 다음 타깃 줄에서 끊는다."""
    lines: list[str] = []
    collecting = False
    for line in MAKEFILE.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{target}:"):
            collecting = True
            continue
        if not collecting:
            continue
        if line.startswith("\t"):
            lines.append(line.lstrip("\t"))
        elif line.strip():
            break
    return lines


def test_the_compose_seed_command_targets_the_compose_database() -> None:
    """⑤ 문 3 — compose 갈래의 시드 명령이 **compose 의 DB 를 쥔 서비스** 안에서 돈다.

    호스트의 `make seed` 는 `settings.database_url`(기본 로컬 sqlite)에 만든다 — 그 갈래는 이 커밋이
    바꾸지 않는다. 여기서 붙드는 것은 **두 갈래가 서로의 자리를 침범하지 않는 것**이다.
    """
    compose_seed = _recipe("seed-compose")
    execs = [line for line in compose_seed if "docker compose exec" in line]
    assert len(execs) == 1, f"seed-compose 가 `docker compose exec` 을 한 줄로 갖지 않는다: {compose_seed}"

    tokens = execs[0].split()
    after_exec = tokens[tokens.index("exec") + 1:]
    service = next(token for token in after_exec if not token.startswith("-"))
    services = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    assert service in services, (
        f"seed-compose 가 `{service}` 안에서 돌려는데 docker-compose.yml 에 그 서비스가 없다 — "
        "서비스 이름이 바뀌면 이 명령은 데몬이 있는 자리에서만 죽는다(여기서 먼저 죽인다)."
    )

    url = services[service]["environment"]["DATABASE_URL"]
    assert url == services["api"]["environment"]["DATABASE_URL"], (
        f"seed-compose 가 시드하는 DB({url})가 api 서비스가 쓰는 DB 와 다르다 — 그러면 데모는 "
        "계정이 있는 DB 와 앱이 보는 DB 가 갈린다."
    )
    assert not url.startswith("sqlite"), f"compose 갈래의 DATABASE_URL 이 sqlite 다: {url}"
    assert "python -m services.api.seed" in execs[0], (
        "seed-compose 가 ADR 0018 §2-2 의 명령이 아닌 다른 경로로 시드한다"
    )

    host_seed = _recipe("seed")
    assert any("python -m services.api.seed" in line for line in host_seed), host_seed
    assert not any("docker" in line for line in host_seed), (
        "호스트 `make seed` 가 docker 를 지난다 — 이 갈래는 settings.database_url 이 가리키는 DB 에 "
        "만드는 것이고(ADR 0018 §2-4 ㉠) 이 커밋은 그것을 바꾸지 않는다."
    )


def _ts_string_const(name: str) -> str:
    """`vite.proxy-target.ts` 가 내보내는 문자열 상수 하나. **히트가 하나가 아니면 죽는다.**

    수가 아니라 **부재**에 기대는 확인이다(CLAUDE.md §6-1): 이 파일 안에서 그 이름을 다시 내보내는
    자리가 없다는 것. 둘이 되면 어느 쪽이 정본인지 이 함수가 고를 수 없으므로 그 자리에서 죽인다.
    """
    hits = re.findall(rf'^export const {name} = "([^"]*)";', PROXY_TARGET_TS.read_text(encoding="utf-8"), flags=re.M)
    assert len(hits) == 1, (
        f"{PROXY_TARGET_TS.name} 에서 `export const {name} = \"...\";` 를 {len(hits)}개 찾았다 — "
        "하나여야 한다(정본이 갈리면 이 대조는 어느 쪽과 맞대야 할지 모른다)."
    )
    return hits[0]


def _service_environment(service: str) -> dict[str, str]:
    """compose 서비스의 `environment`. **키가 아예 없는 것과 빈 것을 같은 칸에 둔다.**

    `svc["environment"]` 도 `svc.get("environment").get(...)` 도 그 자리에서 터진다 — 이 사이클의
    작업 5 **이전** 트리에서 `web` 에는 그 키가 `{}` 도 `null` 도 아니라 **아예 없었다**(architect
    실측). 탐침이 예외로 죽으면 그것은 「문이 열렸다」가 아니라 「탐침이 부러졌다」이고, 둘은 다른
    사실이다. 목록 형식(`- K=V`)도 받는다 — compose 가 둘 다 허용한다.
    """
    raw = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"][service].get("environment") or {}
    if isinstance(raw, list):
        pairs = [str(entry).split("=", 1) for entry in raw]
        return {pair[0]: (pair[1] if len(pair) > 1 else "") for pair in pairs}
    return {str(k): ("" if v is None else str(v)) for k, v in raw.items()}


def test_the_compose_web_service_spells_the_proxy_env_name_the_web_app_reads() -> None:
    """⑥ **문 4 의 철자** — `docker-compose.yml` 의 `web.environment` 키와 `vite.proxy-target.ts` 의
    `API_PROXY_TARGET_ENV` 가 같은 문자열인가. 파일 둘을 함께 읽는 것이 ⑤ 와 같은 모양이다.

    **갈리면 나는 것은 예외가 아니라 침묵이다**: `resolveApiProxyTarget` 은 이름이 환경에 **없으면**
    기본값(`DEFAULT_API_PROXY_TARGET`)을 돌려주므로, 한쪽 철자가 어긋난 트리에서도 vite 는 조용히
    뜨고 web 컨테이너의 `/api` 는 **자기 자신**을 가리킨다(그 컨테이너 안에서 `localhost:8000` 은
    api 가 아니다). 그 손해는 데몬이 있는 자리에서만 보인다 — 여기서 먼저 죽인다.
    """
    name = _ts_string_const("API_PROXY_TARGET_ENV")
    default = _ts_string_const("DEFAULT_API_PROXY_TARGET")
    services = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    env = _service_environment("web")

    assert name in env, (
        f"compose 의 web 이 `{name}` 을 주지 않는다(준 이름: {sorted(env)}). 그 이름의 정본은 "
        f"{PROXY_TARGET_TS.name} 의 API_PROXY_TARGET_ENV 이고, 철자가 갈리면 vite 는 예외 없이 "
        f"기본값 {default} 로 떨어져 web 컨테이너가 자기 자신을 가리킨다(문 4)."
    )
    value = env[name]
    assert value, (
        f"compose 의 web 이 `{name}` 을 **비워서** 준다 — 선언됐는데 비면 resolveApiProxyTarget 이 "
        "던지고 vite 가 뜨지 않는다(그 파일의 「선언됐는데 비었다」 문단)."
    )
    assert value != default, (
        f"compose 의 web 이 주는 값이 기본값({default})과 같다 — 그 값은 **호스트 갈래**의 것이고 "
        "컨테이너 안에서는 api 가 아니라 자기 자신이다. 이름을 아예 빼는 것과 같은 결과가 된다."
    )

    host, port = urlsplit(value).hostname, urlsplit(value).port
    assert host in services, (
        f"프록시 대상 호스트 `{host}` 가 compose 의 서비스 이름이 아니다(있는 이름: {sorted(services)}) — "
        "컨테이너 안에서 그 이름은 풀리지 않는다."
    )
    assert host != "web", f"프록시 대상이 web 자신이다({value}) — 문 4 가 열린 채다."
    assert f"--port {port}" in str(services[host]["command"]), (
        f"프록시 대상 포트({port})가 `{host}` 서비스가 듣는 포트와 다르다: {services[host]['command']}"
    )
