"""데모 시드 **명령**. `python -m services.api.seed` (ADR 0018 §2-2).

`auth/seed.py` 의 `seed_dev_users` / `seed_dev_project` 를 **명시적으로 불리는 엔트리포인트**로 감싼다.
함수가 아니라 명령인 이유는 소비자 하나가 **하위 프로세스**이기 때문이다 — `tests/e2e` 의 `api_server`
픽스처는 `uvicorn` 을 별도 프로세스로 띄우므로 부모가 `settings` 를 만져도 그 프로세스에 닿지 않는다
(ADR 0018 §2-2). 같은 프로세스 안에서 부르는 소비자는 `seed_all(session)` 을 쓴다.

**계약(ADR 0018 §2-4).** 보장하는 것 넷:

1. `DEV_SEED_ROLES` 네 계정이 존재한다.
2. `DEV_SEED_PROJECT_ID` 프로젝트와 contractor·cm·client **셋**의 멤버십이 존재한다
   (`admin` 은 받지 않는다 — ADR 0006 §4).
3. **멱등**이다. 근거는 이 모듈이 아니라 `auth/seed.py` 의 `users_count(session) > 0` 갈래다 —
   두 번째 실행은 계정도 멤버십도 만들지 않는다.
4. **종료 코드로 실패를 말한다**: `0` = 시드된 DB(만들었거나 이미 있었거나), `1` = 시드하지 못했다,
   `2` = 호출이 틀렸다. 하위 프로세스로 부르는 쪽은 이 값을 봐야 한다 — stdout 을 로그 파일로 돌리면
   실패 문구는 아무도 읽지 않는다.

보장하지 **않는** 것 둘:

- **어떤 DB 인지 가리지 않는다.** `settings.database_url` 이 가리키는 DB 에 그대로 만든다(sqlite 든
  postgres 든 같은 명령이 돈다). 운영 URL 을 주고 부르면 운영에 데모 계정이 생긴다(ADR 0018 §2-4 ㉠).
- **비밀번호를 숨기지 않는다.** `DEV_SEED_PASSWORD` 는 시크릿이 아니라 문서화된 개발 시드 전용
  상수다(`auth/seed.py`).
"""
from __future__ import annotations

import sys

from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from packages.core import db as core_db
from packages.core.models.orm import ProjectRow, UserRow
from packages.core.settings import settings

from .auth.seed import DEV_SEED_MEMBER_ROLES, seed_dev_project, seed_dev_users, users_count

USAGE = "usage: python -m services.api.seed   (인자를 받지 않는다)"


def seed_all(session: Session) -> tuple[list[UserRow], ProjectRow | None]:
    """데모 계정과 데모 프로젝트 멤버십을 만든다. 이미 시드된 DB 에서는 `([], None)`.

    `seed_dev_project` 는 `seed_dev_users` 가 **방금 만든** 계정에만 멤버십을 주므로(빈 목록이면
    `None` 을 돌려준다) 두 호출의 순서와 인자가 이 함수의 전부다.
    """
    created = seed_dev_users(session)
    return created, seed_dev_project(session, created)


def _safe_url(url: str) -> str:
    """실패 보고에 자격 증명을 싣지 않는다(CLAUDE.md §3-4). 파싱이 안 되면 URL 을 아예 싣지 않는다."""
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
    try:
        # 이미 같은 URL 로 초기화된 엔진이 있으면 그것을 쓴다(in-process 소비자의 엔진을 갈아치우지 않는다).
        core_db.init_db(None if core_db.database_url() == url and core_db._engine is not None else url)
        with core_db.session_scope() as s:
            created, project = seed_all(s)
            emails = [u.email for u in created]
            project_id = None if project is None else project.project_id
            total = users_count(s)
    except Exception as exc:
        print(f"seed failed on {_safe_url(url)}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    if emails:
        print(f"seeded {len(emails)} dev users ({', '.join(emails)})")
        if project_id is not None:
            print(f"seeded dev project {project_id} with member roles for {'/'.join(DEV_SEED_MEMBER_ROLES)}")
    else:
        print(f"nothing to seed: users={total} (auth/seed.py 의 users_count(session) > 0 갈래)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
