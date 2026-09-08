"""데모 시드 **명령**. `python -m services.api.seed` (ADR 0018 §2-2).

`auth/seed.py` 의 `seed_dev_users` / `seed_dev_project` 를 **명시적으로 불리는 엔트리포인트**로 감싼다.
함수가 아니라 명령인 이유는 소비자 하나가 **하위 프로세스**이기 때문이다 — `tests/e2e` 의 `api_server`
픽스처는 `uvicorn` 을 별도 프로세스로 띄우므로 부모가 `settings` 를 만져도 그 프로세스에 닿지 않는다
(ADR 0018 §2-2). 같은 프로세스 안에서 부르는 소비자는 `seed_all(session)` 을 쓴다.

**계약(ADR 0018 §2-4)은 종료 코드로 갈라서 말한다.** `rc=0` 이면 아래 ①②가 **이 DB 에서 성립한다**;
성립시키지 못하면 `rc=1` 이고 무엇이 없는지를 stderr 에 적는다. **그 한정이 없으면 계약은 거짓이다**
(실측, sqlite, N=1): 데모 시드가 아닌 계정 하나를 넣은 DB 에 이 명령을 부르면
`nothing to seed: users=1` 을 찍고 **rc=0** 인데 데모 계정은 **0개** · `p-dev-demo` 는 **0개** 다 —
`seed_dev_users` 가 `users_count(session) > 0` 에서 무동작이기 때문이다.

1. `DEV_SEED_ROLES` 네 계정이 존재한다(이메일과 role 이 **함께** 맞아야 한다).
2. `DEV_SEED_PROJECT_ID` 프로젝트와 contractor·cm·client **셋**의 멤버십이 존재한다
   (`admin` 은 받지 않는다 — ADR 0006 §4).
3. **멱등**이다. 근거는 이 모듈이 아니라 `auth/seed.py` 의 `users_count(session) > 0` 갈래다 —
   두 번째 실행은 계정도 멤버십도 만들지 않는다.
4. **종료 코드로 실패를 말한다**: `0` = ①②가 성립한다(방금 만들었거나 이미 있었거나),
   `1` = 성립하지 않는다(예외로 실패했거나, DB 가 비어 있지 않아 시드가 무동작이었다),
   `2` = 호출이 틀렸다. 하위 프로세스로 부르는 쪽은 이 값을 봐야 한다 — stdout 을 로그 파일로 돌리면
   실패 문구는 아무도 읽지 않는다.

**「없으면 만든다」로 가지 않은 이유.** ①②를 무조건 참으로 만들려면 **비어 있지 않은 DB 에도** 데모
계정을 넣어야 하는데, 이 명령은 어떤 DB 인지 가리지 않는다(아래 · ADR 0018 §2-4 ㉠). 그러면 사용자가
있는 운영 DB 에 문서화된 비밀번호를 가진 `admin@buildtwin.local` 이 생긴다 — 오늘 그것을 막고 있는
것이 바로 그 `users_count(session) > 0` 갈래다. 그래서 **만드는 범위는 넓히지 않고 보고를 가른다.**

**성공 출력은 어느 DB 에 만들었는지 적는다**(§2-4 ㉠ 과 짝이다: 위험이 「사람이 치는 명령」으로 옮겨간
자리라, 친 사람이 자기가 어디에 만들었는지 값으로 봐야 한다). 자격 증명은 싣지 않는다(CLAUDE.md §3-4).

보장하지 **않는** 것 둘:

- **어떤 DB 인지 가리지 않는다.** `settings.database_url` 이 가리키는 DB 에 그대로 만든다(sqlite 든
  postgres 든 같은 명령이 돈다). 운영 URL 을 주고 부르면 운영에 데모 계정이 생긴다(ADR 0018 §2-4 ㉠).
- **비밀번호를 숨기지 않는다.** `DEV_SEED_PASSWORD` 는 시크릿이 아니라 문서화된 개발 시드 전용
  상수다(`auth/seed.py`).
"""
from __future__ import annotations

import sys

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from packages.core import db as core_db
from packages.core.models.orm import ProjectMemberRow, ProjectRow, UserRow
from packages.core.settings import settings

from .auth.seed import (
    DEV_SEED_DOMAIN,
    DEV_SEED_MEMBER_ROLES,
    DEV_SEED_PROJECT_ID,
    DEV_SEED_ROLES,
    seed_dev_project,
    seed_dev_users,
    users_count,
)

USAGE = "usage: python -m services.api.seed   (인자를 받지 않는다)"


def seed_all(session: Session) -> tuple[list[UserRow], ProjectRow | None]:
    """데모 계정과 데모 프로젝트 멤버십을 만든다. `users` 가 **비어 있지 않으면** `([], None)`.

    「비어 있지 않으면」이지 「이미 시드됐으면」이 아니다 — `seed_dev_users` 는 계정의 **수**만 보므로
    데모와 무관한 계정 하나로도 무동작이 된다. 그 DB 에서 계약 ①②가 성립하는지는 이 함수가 아니라
    `unmet_contract(session)` 이 답한다.

    `seed_dev_project` 는 `seed_dev_users` 가 **방금 만든** 계정에만 멤버십을 주므로(빈 목록이면
    `None` 을 돌려준다) 두 호출의 순서와 인자가 이 함수의 전부다.
    """
    created = seed_dev_users(session)
    return created, seed_dev_project(session, created)


def unmet_contract(session: Session) -> list[str]:
    """계약 ①②(ADR 0018 §2-4)가 이 DB 에서 성립하지 **않는** 항목. 빈 목록이면 성립한다.

    개수를 세지 않고 **각 항목을 이름으로 확인한다** — 계정 수만 보면 이름이 다른 계정 넷도 통과하고,
    그 통과가 정확히 이 함수를 만든 이유다(모듈 docstring 의 실측).
    """
    want = {f"{role}@{DEV_SEED_DOMAIN}": role for role in DEV_SEED_ROLES}
    have = {u.email: u for u in session.scalars(select(UserRow).where(UserRow.email.in_(want)))}
    unmet = [f"계정 없음: {email}(role={role})" for email, role in sorted(want.items())
             if email not in have or have[email].role != role]
    if session.get(ProjectRow, DEV_SEED_PROJECT_ID) is None:
        unmet.append(f"프로젝트 없음: {DEV_SEED_PROJECT_ID}")
    else:
        for role in DEV_SEED_MEMBER_ROLES:
            user = have.get(f"{role}@{DEV_SEED_DOMAIN}")
            if user is None or session.get(ProjectMemberRow, (DEV_SEED_PROJECT_ID, user.user_id)) is None:
                unmet.append(f"멤버십 없음: {DEV_SEED_PROJECT_ID}/{role}")
    return unmet


def _safe_url(url: str) -> str:
    """출력(성공·실패 모두)에 자격 증명을 싣지 않는다(CLAUDE.md §3-4). 파싱이 안 되면 URL 을 아예 싣지 않는다."""
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        return "<database url unparsable>"


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if args:
        print(f"{USAGE} — 받은 인자: {' '.join(args)}", file=sys.stderr)
        return 2
    url = settings.database_url
    where = _safe_url(url)
    try:
        # 이미 같은 URL 로 초기화된 엔진이 있으면 그것을 쓴다(in-process 소비자의 엔진을 갈아치우지 않는다).
        core_db.init_db(None if core_db.database_url() == url and core_db._engine is not None else url)
        with core_db.session_scope() as s:
            created, project = seed_all(s)
            emails = [u.email for u in created]
            project_id = None if project is None else project.project_id
            total = users_count(s)
            unmet = unmet_contract(s)   # 만든 뒤에 센다: rc 는 「무엇을 했는가」가 아니라 「무엇이 있는가」를 말한다
    except Exception as exc:
        print(f"seed failed on {where}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    if emails:
        print(f"seeded {len(emails)} dev users on {where} ({', '.join(emails)})")
        if project_id is not None:
            print(f"seeded dev project {project_id} with member roles for {'/'.join(DEV_SEED_MEMBER_ROLES)}")
    elif not unmet:
        print(f"already seeded on {where}: users={total}, {DEV_SEED_PROJECT_ID} 멤버십 "
              f"{'/'.join(DEV_SEED_MEMBER_ROLES)} (아무것도 만들지 않았다 — 멱등)")
    if unmet:
        print(f"seed contract not met on {where}: users={total} — " + " · ".join(unmet), file=sys.stderr)
        if not emails:
            print("이 DB 에는 이미 계정이 있어 auth/seed.py 의 users_count(session) > 0 갈래가 무동작이었다. "
                  "이 명령은 남의 계정이 있는 DB 에 데모 계정을 만들지 않는다 — 어떤 DB 인지 가리지 않으므로 "
                  "운영 DB 일 수 있다(ADR 0018 §2-4 ㉠). 개발 DB 라면 비운 뒤 다시 부른다 — 비우는 명령은 "
                  "갈래마다 다르다: 호스트 sqlite(./buildtwin.db)는 'make db-reset', compose 스택의 "
                  "postgres 는 'docker compose down -v'(그 DB 는 pgdata 볼륨이라 rm -f *.db 가 닿지 않는다).",
                  file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
