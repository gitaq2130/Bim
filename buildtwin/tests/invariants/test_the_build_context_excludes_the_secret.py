"""빌드 컨텍스트가 **`.env` 를 빼고** `Dockerfile` 이 필요로 하는 것은 **빼지 않는다** — 담당: qa (계획 0017 작업 5).

## 왜 있는가

`make env` 가 난수 `JWT_SECRET` 을 `buildtwin/.env` 에 쓰고, 그 디렉터리가 그대로 빌드 컨텍스트다
(`docker-compose.yml` 의 `api`·`worker` 가 `build: { context: ., dockerfile: Dockerfile }`).
`Dockerfile` 의 마지막 줄은 `COPY . .` 이고, 이 저장소에는 `.dockerignore` 가 **없었다** — 그 부재를
러너가 스스로 쟀다(계획 0017 §3-1-1 ㉯ ㅈ: `#5 [worker internal] load .dockerignore` /
`transferring context: 2B`, **저장소 밖 값**).

거짓이 아니라 **위험**이다(계획 0017 §3-1-2 의 한정어 역방향 확인). CLAUDE.md §3-4 의 「`.env` 에만」이
지는 것은 **사람이 값을 적는 소스 표면**이지 값이 흘러가는 자리가 아니다 — 그렇게 읽으면 같은 저장소가
처방한 compose 의 `env_file:` 자신이 위반이 된다. 위험의 이름은 **지속**과 **이동**이다: 레이어는
`.env` 를 지워도 · `docker compose down -v` 뒤에도 남고, `make env` 의 `umask 077` 은 레이어를 따라가지
않으며, `docker save`·푸시로 레이어째 나갈 수 있다. 그리고 그 사본은 **실행에도 쓰이지 않는다** —
`api`·`worker` 는 `volumes: [".:/app", …]` 로 호스트 디렉터리를 `/app` 위에 덮는다.

**파일만 만들고 게이트를 두지 않으면 다음 편집이 그것을 조용히 지운다.** 그 실패 모양은 이 저장소가
이미 값으로 갖고 있다 — 이웃 파일 `test_ci_builds_the_image.py` 의 「이 파일이 서기 전」 표:
`image` 잡을 **통째로 지워도 126 passed**(무변화)였다. 그래서 파일과 게이트를 한 소유가 함께 진다
(계획 0017 §3-1-5 의 3·4).

## 무엇을 보는가 — 셋 + 탐침. **넷 다 파일 셋을 읽을 뿐 docker 를 부르지 않는다**

1. **ⓛ 자리.** `.dockerignore` 가 **빌드 컨텍스트의 뿌리**에 있다. 그 뿌리는 못박은 상수가 아니라
   `docker-compose.yml` 의 `build.context` 에서 읽는다 — 컨텍스트가 옮겨지면 이 단언이 먼저 죽는다.
   (저장소 루트에 둔 `.dockerignore` 는 **아무 효과가 없다**: 그 자리는 컨텍스트 밖이다.)
2. **ⓜ 뺀다.** 그 파일이 `.env` 를 뺀다. `.env.local` 같은 변종도 함께 빠지고, **`.env.example` 은
   남는다**(`.gitignore` 와 같은 처분). 시크릿만이 아니라 이 목록이 이름으로 정한 파생물
   (호스트 가상환경 · 캐시 · 웹 파생물 · 런타임 데이터)도 함께 확인한다.
3. **ⓝ 안 뺀다.** `Dockerfile` 이 **이름으로 `COPY`** 하는 것이 하나도 빠지지 않고,
   `services/` · `packages/` · `config/` · `rules/` · `pyproject.toml` 도 빠지지 않는다.
   **이 축이 없으면 다음 사람이 목록을 넓히다 빌드를 깨뜨린다** — ⓜ 만 있는 게이트는 `*` 한 줄로도
   초록이다(변이 D6 이 그 값이다).
4. **탐침 자신**(§6-2 5). 세 파일을 읽는 기구가 성한지를 **이 사이클이 만들지 않은 자리**로 태운다:
   `Dockerfile` 의 `COPY pyproject.toml ./`(`6149e17` 부터 있다)를 파서가 이름으로 집어내지 못하면
   ⓝ 은 「빠진 것이 없다」가 아니라 「볼 것이 없었다」를 보고하고 있는 것이다.

**개수를 세지 않는다**(CLAUDE.md §6-1 9회차 — 그 자리에서 도는 참조:
`grep -n "열거는 길이가 곧 개수다" ../../CLAUDE.md`). 「줄이 몇이다」·「이름이 몇이다」를 쓰지 않고
**무엇이 빠지는가**와 **무엇이 빠지지 않는가**만 단언한다.

## 패턴을 어떻게 읽는가 — 그리고 그 매처가 **도커가 아니라는 것**

`.dockerignore` 의 패턴 의미는 `.gitignore` 와 다르다: 패턴은 **컨텍스트 뿌리에 붙고** `*` 는 `/` 를
건너지 않는다. 그래서 `.gitignore` 가 어느 깊이에서나 잡는 이름(`node_modules` 등)은 여기서 `**/` 를
붙여야 하고, 붙이지 않으면 `apps/web/node_modules` 가 **조용히 컨텍스트에 남는다** — 이 저장소의
지배적 실패 모드 그 자체다. 그것을 보려면 문자열 포함이 아니라 **경로 판정**이 필요하므로, 이 파일은
moby 의 patternmatcher 변환을 따르는 작은 매처를 갖는다(`*`→`[^/]*`, `**`→ 디렉터리를 건넌다,
`!`= 재포함, **뒤에 오는 규칙이 이긴다**, 부모 디렉터리가 걸리면 그 아래가 걸린다).

***한정 — 이 매처는 도커가 아니다.*** 판정하는 것은 **선언**이지 실제 전송이 아니고, 두 구현이 갈리는
자리는 이 파일이 답하지 못한다(그 축을 재려면 데몬이 필요하다 — 이 환경 `docker info` rc 1, N=1).
그래서 단언은 **모든 경로**가 아니라 이 목록이 이름으로 정한 **대표 경로**에 건다.

## 이 파일이 **보지 못하는** 것 (CLAUDE.md §6-1 ②)

- **레이어 안에 무엇이 들어갔는가.** 이 파일이 보는 것은 **빼겠다는 선언**이지 **담긴 것**이 아니다.
  레이어를 여는 것은 데몬을 요구한다 — 계획 0017 §후속 94 · §확인하지 않은 것 97 이 그 자리다.
- **이미 구워진 이미지.** 이 커밋 전에 `make dev` 를 친 기계에는 시크릿이 들어간 레이어가 **이미
  있다.** 이 파일도 `.dockerignore` 도 그것을 지우지 못한다(§확인하지 않은 것 98).
- **`.env` 밖의 시크릿.** 보는 것은 이 목록이 이름으로 정한 것뿐이다. 사용자가 컨텍스트에 둔 다른
  자격 증명(예: `secrets.json`)은 이 단언을 지나간다.
- **다른 모양의 무력화.** 잡는 것은 **패턴 판정**이다. 컨텍스트를 옮기는 편집은 ⓛ 이 잡고(D8),
  `Dockerfile` 이 `.env` 를 **이름으로 COPY** 하는 편집도 ⓝ 이 잡는다(D10) — 다만 그때 보고되는 것은
  「시크릿을 굽는다」가 아니라 **「빌드가 깨진다」** 이다. **빌드를 아예 안 하게 만드는 편집**(잡을
  지우는 것 · 레시피를 바꾸는 것)은 이 파일 밖이고, 그 자리는 이웃 파일
  `test_ci_builds_the_image.py` 가 진다.

## 결함 있는 상태에서 실제로 죽는가 (CLAUDE.md §6-2 1 — 변이 실측, 각 N=1)

변이는 **한 자리씩** 심고, **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 그 사본으로
원복하고 루트 `git status --porcelain` 을 확인했다(§6-2 규칙 5 — **`.dockerignore` 는 이 커밋이 처음
넣는 파일이라 그것을 지우거나 그 줄을 빼는 변이에서 `git diff` 가 침묵한다**: 그 침묵을 값으로 쟀다,
아래 표 오른쪽 칸).
명령은 매번 `pytest tests/invariants/test_the_build_context_excludes_the_secret.py -q`.

| 변이 | 무엇을 심었나 | 실행값(죽는 단언) | `git diff \| grep -c '^-[^-]'` |
|---|---|---|---|
| 음성 대조군 | 없음(이 커밋의 트리) | **4 passed** | 0 |
| D1 | `.dockerignore` 를 **통째로 지운다** | **4 failed** — ⓛⓜⓝ 에 더해 **탐침까지** 죽는다 | **0**(침묵) |
| D2 | `.env` 줄을 지운다 | **1 failed, 3 passed** — ⓜ. `.env.*` 가 남아도 `.env` 자신은 그 패턴에 걸리지 않는다 | **0**(침묵) |
| D3 | `.env` 를 빼는 줄 **셋**(`.env`·`.env.*`·`!.env.example`)을 지운다 | **1 failed, 3 passed** — ⓜ | **0**(침묵) |
| D4 | `!.env.example` 만 지운다 | **1 failed, 3 passed** — **ⓝ** | **0**(침묵) |
| D5 | `pyproject.toml` 을 빼는 줄을 더한다 | **1 failed, 3 passed** — ⓝ | 0 |
| D6 | 목록을 `*` 한 줄로 넓힌다(= 컨텍스트를 통째로 비운다) | **1 failed, 3 passed** — ⓝ. **ⓜ 는 초록이다** | **0**(침묵) |
| D7 | `**/node_modules/` 에서 `**/` 를 뗀다(= `.gitignore` 의 표기를 그대로 옮긴 모양) | **1 failed, 3 passed** — ⓜ. `apps/web/node_modules` 가 컨텍스트에 **남는다** | **0**(침묵) |
| D8 | `docker-compose.yml` 의 컨텍스트를 `context: ..` 로 옮긴다 | **4 failed** — ⓛ 이 먼저 죽고, 그 자리가 뿌리가 아니게 되어 나머지 셋도 파일을 찾지 못한다 | **2** — 추적 파일이라 여기서는 `git diff` 가 **말한다** |
| D9 | 이 파일이 읽는 `.dockerignore` 이름을 없는 이름으로 바꾼다 | **4 failed** — 탐침이 **침묵하지 않는다** | **0**(침묵) |
| D10 | `Dockerfile` 에 `COPY .env /app/.env` 를 더한다(= 목록을 우회해 시크릿을 이름으로 굽는다) | **1 failed, 3 passed** — ⓝ. 보고되는 이유는 **「빌드가 깨진다」** 다 | 0 |

**오른쪽 칸이 §6-2 규칙 5 의 값이다**: `.dockerignore` 와 이 파일을 건드린 변이(D1~D7·D9)는 모두
`git diff` 의 `-` 줄이 **0** 이다 — 이 커밋이 처음 넣는 파일이라 대-HEAD diff 는 「지웠다」를 보이지
못한다. 적용을 확인한 것은 **작업 트리 사본과의 `diff`** 이고, 그 사본이 매번 지운 줄을 냈다.
**D8 이 그 대비다**: 추적 파일(`docker-compose.yml`)을 건드리니 같은 관측이 `-` 줄 **2** 를 낸다 —
침묵하는 것은 변이가 아니라 **기준선**이다. (D10 도 추적 파일이지만 줄을 **더하는** 변이라 0 이다:
`-` 줄 세기는 「지웠다」만 본다.)

**두 칸이 예측과 갈렸다**(CLAUDE.md §6-1 3회차 — 그래서 이 표의 칸은 생각이 아니라 실행값이다):
D1 은 「3 failed, 1 passed」로 적었는데 **4 failed** 다(탐침도 그 파일을 읽으므로 함께 죽는다 —
부재가 곧 결함인 자리라 그것이 옳다), D4 는 ⓜ 이 죽을 것으로 적었는데 죽는 것은 **ⓝ** 이다
(`.env.*` 가 `.env.example` 까지 먹는 것은 「빼는가」가 아니라 **「필요한 것을 안 빼는가」** 쪽에서
관측된다).

**D6 이 이 파일의 두 축을 값으로 만든다**: `*` 한 줄은 `.env` 를 확실히 뺀다 — ⓜ 만 있는 게이트에서는
**초록**이다. 그리고 그 트리의 빌드는 `COPY pyproject.toml ./` 에서 죽는다. 「빼는가」와
「필요한 것을 안 빼는가」는 서로를 가려 주지 않는다(CLAUDE.md §6-2 3).

**D7 이 「표기를 그대로 옮기면」의 값이다**: `.gitignore` 의 `node_modules/` 를 그대로 옮긴 트리는
**어떤 문자열 검사도 통과**하지만(그 줄이 거기 있다) `apps/web/node_modules` 는 컨텍스트에 남는다.

## 빌드를 깨뜨리지 않는가 (정적 확인 — 데몬 0회)

- `Dockerfile` 이 **이름으로 `COPY`** 하는 것은 `pyproject.toml` 하나이고 이 목록의 어느 항목도 그
  이름에 걸리지 않는다(ⓝ 이 그것을 판정으로 붙든다).
- `pip install --no-cache-dir -e .` 은 `COPY . .` 보다 **앞이다** — 그 자리에서 도는 참조:
  `grep -n "COPY\|RUN pip" Dockerfile`(`COPY pyproject.toml ./` → `RUN pip …` → `COPY . .` 순).
  그러므로 이 목록은 그 설치에 닿지 않는다.
- 컨텍스트를 통째로 비우는 패턴(`*`)이 없다 — 있으면 ⓝ 이 죽는다(D6).
- **추적 파일 전수로도 쟀다**(qa, 이 커밋의 트리, N=1): 저장소 루트에서
  `git ls-tree -r --name-only <트리> -- buildtwin` 이 낸 경로를 이 목록의 이름들로 거르니 걸리는 것은
  **`.env.example` 하나**이고, 그것은 `!.env.example` 이 도로 넣는다. 즉 이 목록이 빼는 것 중
  **커밋된 파일은 없다** — 「커밋하지 않는 것은 이미지에도 넣지 않는다」가 그 축이었다.

## 이 파일이 postgres 축에 무엇을 하는가

**아무것도 하지 않는다.** 이 트리에는 축 기구가 없고, 이 파일의 어느 단언도 DB 엔진을 만들지 않는다
— `tests/postgres.floor.json` 의 두 바닥값은 이 커밋에서 움직이지 않는다.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

#: `tests/invariants/이 파일` → tests → buildtwin.
BUILDTWIN = Path(__file__).resolve().parents[2]
COMPOSE = BUILDTWIN / "docker-compose.yml"
DOCKERFILE = BUILDTWIN / "Dockerfile"

#: 컨텍스트의 뿌리에 있어야 하는 파일의 이름. 이 이름이 바뀌면 도커가 그 파일을 읽지 않는다.
IGNORE_FILE_NAME = ".dockerignore"

#: `build:` 를 갖는 서비스들. 이 이름들이 컨텍스트를 정한다.
BUILDING_SERVICES = ("api", "worker")

#: 탐침이 자기를 태울 때 쓰는 자리(§6-2 5) — 이 사이클이 만든 것이 아니라 `6149e17` 부터 있는 줄이다.
REFERENCE_COPY_SOURCE = "pyproject.toml"

#: 빠져야 하는 대표 경로. 이름으로 적는다 — 개수를 세지 않는다(§6-1 9회차).
MUST_BE_EXCLUDED = (
    ".env",
    ".env.local",
    ".venv/lib/python3.11/site-packages/anything.py",
    "apps/web/node_modules/react/index.js",
    "apps/web/dist/index.html",
    "services/api/__pycache__/main.cpython-311.pyc",
    "buildtwin.egg-info/PKG-INFO",
    ".mypy_cache/3.11/builtins.data.json",
    ".pytest_cache/CACHEDIR.TAG",
    ".ruff_cache/content",
    "storage/uploads/site.ifc",
    "buildtwin.db",
    "apps/web/.e2e-preview.abcdef.config.mts",
)

#: 빠지면 **안 되는** 대표 경로 — 이 목록이 기대는 부재다. 뜬 컨테이너의 import 경로와 설치의 정본.
MUST_NOT_BE_EXCLUDED = (
    ".env.example",
    "pyproject.toml",
    "services/api/main.py",
    "packages/core/settings.py",
    "config/readiness.yaml",
    "rules/verification.yaml",
)


def _ignore_file() -> Path:
    """`.dockerignore` 를 **컨텍스트의 뿌리에서** 찾는다 — 그 뿌리는 compose 가 정한다."""
    return _context_root() / IGNORE_FILE_NAME


def _context_root() -> Path:
    """`build:` 를 갖는 서비스들이 선언한 빌드 컨텍스트. 갈리면 그 자리에서 죽는다."""
    assert COMPOSE.is_file(), f"compose 파일을 읽지 못했다: {COMPOSE} — 컨텍스트의 뿌리를 정할 수 없다."
    doc = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    services = (doc or {}).get("services")
    assert isinstance(services, dict), f"{COMPOSE} 가 `services` 매핑을 갖지 않는다 — 파싱이 틀렸거나 구조가 바뀌었다."

    roots = {}
    for name in BUILDING_SERVICES:
        service = services.get(name)
        assert isinstance(service, dict), f"compose 에 `{name}` 서비스가 없다(있는 이름: {sorted(services)})."
        build = service.get("build")
        assert isinstance(build, dict) and "context" in build, (
            f"`{name}` 서비스가 `build.context` 를 갖지 않는다({build!r}) — "
            "이 파일은 컨텍스트의 뿌리를 그 값에서 읽는다."
        )
        roots[name] = (COMPOSE.parent / str(build["context"])).resolve()

    assert len(set(roots.values())) == 1, (
        f"`build:` 를 갖는 서비스들의 컨텍스트가 갈린다: {roots} — "
        f"{IGNORE_FILE_NAME} 은 컨텍스트마다 하나이므로, 갈리면 어느 쪽이 보호되는지가 갈린다."
    )
    return next(iter(roots.values()))


def _rules() -> list[tuple[re.Pattern[str], bool]]:
    """`.dockerignore` 를 (정규식, 재포함인가) 목록으로 읽는다. **순서가 의미다** — 뒤가 이긴다."""
    path = _ignore_file()
    assert path.is_file(), (
        f"{path} 가 없다 — 빌드 컨텍스트에서 아무것도 빠지지 않는다. "
        "`make env` 가 만든 .env 가 그대로 이미지 레이어로 간다(계획 0017 §3-1)."
    )
    rules: list[tuple[re.Pattern[str], bool]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negated = line.startswith("!")
        pattern = line[1:].strip() if negated else line
        rules.append((_compiled(pattern), negated))
    assert rules, f"{path} 에 규칙이 하나도 없다 — 주석뿐인 파일은 아무것도 빼지 않는다."
    return rules


def _compiled(pattern: str) -> re.Pattern[str]:
    """도커의 패턴을 정규식으로 편다(moby patternmatcher 의 변환): `*` 는 `/` 를 건너지 않고 `**` 는 건넌다."""
    cleaned = pattern.strip()
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    cleaned = cleaned.rstrip("/") or "."
    out: list[str] = []
    i = 0
    while i < len(cleaned):
        char = cleaned[i]
        if char == "*":
            if cleaned[i + 1 : i + 2] == "*":
                i += 2
                if cleaned[i : i + 1] == "/":
                    i += 1
                out.append(".*" if i >= len(cleaned) else "((.*/)|([^/]*))")
            else:
                i += 1
                out.append("[^/]*")
        elif char == "?":
            i += 1
            out.append("[^/]")
        else:
            i += 1
            out.append(re.escape(char))
    return re.compile("^" + "".join(out) + "$")


def _is_excluded(path: str) -> bool:
    """그 경로가 컨텍스트에서 빠지는가. 부모가 걸리면 그 아래가 걸리고, **뒤에 오는 규칙이 이긴다**."""
    parts = path.split("/")
    prefixes = ["/".join(parts[: k + 1]) for k in range(len(parts))]
    excluded = False
    for rule, negated in _rules():
        if any(rule.match(prefix) for prefix in prefixes):
            excluded = not negated
    return excluded


def _copy_sources() -> list[str]:
    """`Dockerfile` 이 **이름으로 `COPY`** 하는 것들(컨텍스트 전체를 뜻하는 `.` 은 뺀다)."""
    assert DOCKERFILE.is_file(), f"{DOCKERFILE} 을 읽지 못했다 — 무엇이 필요한지 알 수 없다."
    sources: list[str] = []
    for raw in DOCKERFILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or not line.upper().startswith("COPY "):
            continue
        words = [word for word in line.split()[1:] if not word.startswith("--")]
        for source in words[:-1]:
            if source not in (".", "./"):
                sources.append(source)
    return sources


def test_the_ignore_file_sits_at_the_build_context_root() -> None:
    """ⓛ 자리 — 컨텍스트의 뿌리에 있다. 뿌리는 compose 의 `build.context` 가 정한다."""
    root = _context_root()
    path = _ignore_file()
    assert path.is_file(), (
        f"{IGNORE_FILE_NAME} 이 빌드 컨텍스트의 뿌리({root})에 없다. "
        "다른 자리(예: 저장소 루트)에 두면 도커가 읽지 않아 **아무 효과가 없다** — "
        "부재와 값이 같아진다(러너가 그 부재를 `transferring context: 2B` 로 쟀다)."
    )


def test_the_build_context_excludes_the_secret_and_the_derived_trees() -> None:
    """ⓜ 뺀다 — `.env` 와 그 변종, 그리고 이름으로 정한 파생물."""
    leaked = [path for path in MUST_BE_EXCLUDED if not _is_excluded(path)]
    assert not leaked, (
        f"이 경로들이 빌드 컨텍스트에 남는다: {leaked} — {_ignore_file()} 이 그것을 빼지 않는다. "
        "`.env` 가 남으면 `COPY . .` 이 난수 JWT_SECRET 을 이미지 레이어에 넣고, 그 레이어는 "
        "`.env` 를 지워도 · `docker compose down -v` 뒤에도 남는다(계획 0017 §3-1-2). "
        "패턴은 컨텍스트 뿌리에 붙는다 — 어느 깊이에서나 잡으려면 `**/` 가 필요하다."
    )


def test_the_build_context_does_not_exclude_what_the_dockerfile_needs() -> None:
    """ⓝ 안 뺀다 — 이름으로 `COPY` 하는 것과 뜬 컨테이너가 읽는 트리."""
    named = _copy_sources()
    assert named, (
        f"{DOCKERFILE} 에서 이름으로 COPY 하는 것을 하나도 찾지 못했다 — 아래 단언이 공허해진다. "
        "먼저 탐침을 읽어라(파서가 틀렸거나 Dockerfile 이 바뀌었다)."
    )
    broken = [source for source in named if _is_excluded(source)]
    assert not broken, (
        f"{DOCKERFILE} 이 이름으로 COPY 하는 것이 컨텍스트에서 빠진다: {broken} — **빌드가 깨진다.** "
        f"{_ignore_file()} 의 목록을 넓힐 때는 이 축을 함께 본다."
    )
    missing = [path for path in MUST_NOT_BE_EXCLUDED if _is_excluded(path)]
    assert not missing, (
        f"이 경로들이 컨텍스트에서 빠진다: {missing} — 이 목록이 기대는 **부재**가 깨졌다. "
        "`services/`·`packages/`·`config/`·`rules/` 는 뜬 컨테이너의 import 경로이고, "
        "`.env.example` 은 키 이름의 정본이다(CLAUDE.md §3-4)."
    )


def test_this_probe_reads_the_three_files_and_dies_when_that_reading_is_wrong() -> None:
    """탐침 자신(§6-2 5) — 세 파일을 읽는 기구가 성한지를 이 사이클이 만들지 않은 자리로 태운다."""
    assert _ignore_file().is_file(), (
        f"{_ignore_file()} 을 읽지 못했다 — 위 단언들은 「빠지지 않는다」가 아니라 "
        "「아무것도 못 읽었다」를 보고하고 있는 것이다."
    )
    assert REFERENCE_COPY_SOURCE in _copy_sources(), (
        f"`{REFERENCE_COPY_SOURCE}` 를 {DOCKERFILE} 의 COPY 에서 집어내지 못했다"
        f"(읽은 것: {_copy_sources()}) — COPY 파서가 틀렸다는 뜻이고, 그러면 ⓝ 은 "
        "「빠진 것이 없다」가 아니라 「볼 것이 없었다」를 보고한다."
    )
    fictional = [path for path in MUST_NOT_BE_EXCLUDED if not (BUILDTWIN / path).exists()]
    assert not fictional, (
        f"이 대표 경로들이 실재하지 않는다: {fictional} — 「빠지지 않는다」가 **공허한 참**이 된다. "
        "그 자리가 옮겨졌으면 MUST_NOT_BE_EXCLUDED 를 함께 고친다."
    )
    assert _compiled("*").match("anything") and not _compiled("*").match("a/b"), (
        "패턴 매처가 도커의 의미를 따르지 않는다 — `*` 는 `/` 를 건너지 않아야 한다. "
        "이것이 틀리면 위 두 판정이 조용히 뒤집힌다."
    )
