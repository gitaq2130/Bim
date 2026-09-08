/**
 * vite dev 서버의 `/api` 프록시 대상을 정하는 자리 — 담당: `frontend` (계획 0015 작업 4, **문 4**).
 *
 * ## 왜 있는가
 *
 * `docker-compose.yml` 의 `web` 은 `node:22-alpine` **컨테이너 안에서** vite 를 돌린다
 * (`web.command` = `sh -c "npm install && npm run dev -- --host 0.0.0.0"`). 그 컨테이너 안에서
 * `http://localhost:8000` 은 **api 가 아니라 자기 자신**이다 — api 는 같은 네트워크의 `api:8000` 에
 * 있다. 그래서 프록시 대상은 **갈래마다 다른 값**이어야 하고, 이 파일이 그 값을 정하는 유일한 자리다.
 *
 * ## 두 갈래
 *
 * | 갈래 | `BUILDTWIN_API_PROXY_TARGET` | 대상 |
 * |---|---|---|
 * | 호스트 `make web`(+ `make api`) | 없다 | `http://localhost:8000` — **이 파일 이전과 같은 값** |
 * | compose `make dev` 의 `web` 컨테이너 | compose 가 준다 | 그 값(`http://api:8000`) |
 *
 * **이 파일 하나로는 문 4 가 닫히지 않는다.** 값을 주는 것은 compose 이고 그 파일의 소유는 이
 * 에이전트가 아니다(CLAUDE.md §2 — §후속 19). 두 커밋이 같은 사이클 안에 있어야 완료다
 * (계획 0015 §리스크 4, CLAUDE.md §6-2 4).
 *
 * ## 이름을 고른 근거
 *
 * - **`VITE_` 접두사를 쓰지 않는다.** vite 의 `envPrefix` 기본값이 `VITE_` 이고, 그 접두사가 붙은
 *   값은 `import.meta.env` 로 **브라우저 번들에 인라인된다**. 이것은 dev 서버가 프록시할 곳이지
 *   브라우저가 알아야 할 값이 아니다 — 접두사를 붙이면 내부 호스트 이름이 배포물에 실린다.
 * - **`BUILDTWIN_` 을 붙인다.** 이 값을 읽는 자리는 컨테이너의 환경 전체를 그대로 물려받는다.
 *   `API_PROXY_TARGET` 같은 흔한 이름이 다른 도구의 값과 부딪히면 그 손해가 정확히 문 4 다
 *   (프록시가 조용히 엉뚱한 곳을 가리킨다). 부딪힘의 확률이 아니라 **부딪혔을 때의 모양**이 근거다.
 *
 * ## 「선언됐는데 비었다」를 기본값으로 떨어뜨리지 않는다
 *
 * 빈 값은 프록시 대상이 될 수 없다. 그것을 기본값(`http://localhost:8000`)으로 대신하면 web
 * 컨테이너가 **다시 자기 자신을 가리키고**, 그 손해는 데몬이 있는 자리에서만 보인다 — 이 저장소의
 * 지배적 실패 모드(조용히 죽는 것) 그대로다. 그래서 **없으면 기본값, 있는데 비었으면 예외**다.
 * `make env` 의 레시피가 적는 관측(*"빈 값은 기본값을 덮는다"*)과 같은 자리에 대한 판단이다.
 */

/**
 * compose 의 `web` 서비스가 이 이름으로 값을 준다(계획 0015 작업 5 — 소유가 다르다).
 *
 * **이 문자열은 파일 둘 사이의 계약이다.** 반대편은 `docker-compose.yml` 의 `web.environment` 키이고,
 * `docker compose config` 가 그 이름으로 `http://api:8000` 을 싣는다. 여기서 이름이 갈리면
 * **게이트가 그것을 본다** — 이 상수를 `API_PROXY_TARGET` 으로 바꿔 직접 잰 값(각 N=1, 잰 트리
 * `5bc8d5c`, 변이는 한 자리 + 심기 직전의 작업 트리 사본과 `diff`, 그 사본으로 원복 뒤 루트
 * `git status --porcelain`):
 *
 * | 명령 | 실행값 | 무엇이 죽는가 |
 * |---|---|---|
 * | `pytest tests/invariants`(`make test` 의 한 갈래) | **1 failed, 111 passed** | `tests/invariants/test_demo_stack_can_stand.py` 의 `test_the_compose_web_service_spells_the_proxy_env_name_the_web_app_reads` — 이 파일과 compose 를 함께 읽는다 |
 * | `npx vitest run`(`make test` 의 한 갈래) | **1 failed, 288 passed** | `vite.proxy-target.test.ts` 의 이름 단언 |
 * | `make e2e` | **9 passed, 3 errors** | `tests/e2e/conftest.py` 의 `web_server` — 이 파일의 상수를 읽어 자기가 주는 이름과 맞대 본다 |
 * | `make lint` | **exit 0** | 아무것도 — 철자는 타입도 규칙도 아니다 |
 *
 * CI 는 같은 명령을 unit 잡(`pytest tests/… tests/invariants …` + `npx vitest run`)과 e2e 잡
 * (`pytest tests/e2e`)에서 돌린다(`.github/workflows/buildtwin-ci.yml`).
 *
 * 계획 0015 §1-d 곱 표의 문 4 행은 이 게이트들을 「못 본다」로 적었다. 그것은 **그 계획을 쓰던 트리의
 * 기록**이고(CLAUDE.md §3-13 첫째 갈래 — 뒤늦게 갱신하지 않는다), 그 행을 뒤집은 것은 같은 사이클의
 * 뒤 커밋들이다: compose 반대편(`8926f3d`)과, 두 자리를 함께 읽는 회귀·E2E 배선(`3e54221`).
 */
export const API_PROXY_TARGET_ENV = "BUILDTWIN_API_PROXY_TARGET";

/** 환경이 말하지 않을 때의 대상 — 호스트 `make web` 갈래의 값이고, 이 파일 이전과 같다. */
export const DEFAULT_API_PROXY_TARGET = "http://localhost:8000";

/** `process.env` 를 노드 전역 타입 없이 읽는다(이 앱의 tsconfig `types` 에 `node` 가 없다). */
function processEnv(): Record<string, string | undefined> {
  const host = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return host.process?.env ?? {};
}

/**
 * `/api` 프록시 대상. 인수는 시험을 위해 열어 둔 것이고, vite 는 인수 없이 부른다.
 *
 * @throws 그 이름이 **선언됐는데 비어 있을 때**(위 문단).
 */
export function resolveApiProxyTarget(env: Record<string, string | undefined> = processEnv()): string {
  if (!(API_PROXY_TARGET_ENV in env)) return DEFAULT_API_PROXY_TARGET;
  const value = (env[API_PROXY_TARGET_ENV] ?? "").trim();
  if (!value) {
    throw new Error(
      `${API_PROXY_TARGET_ENV} 가 선언됐는데 비어 있다 — /api 프록시 대상이 될 수 없다. ` +
        `값을 주거나(compose 갈래: http://api:8000) 이름을 아예 빼라(호스트 갈래: ${DEFAULT_API_PROXY_TARGET}). ` +
        `기본값으로 대신하지 않는 이유는 그것이 web 컨테이너 안에서 자기 자신을 가리키기 때문이다(계획 0015 문 4).`,
    );
  }
  return value;
}
