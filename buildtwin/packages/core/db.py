"""DB 엔진·세션. URL은 .env(DATABASE_URL)에서만. 기본은 로컬 SQLite(개발·테스트)."""
from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .models.orm import Base

_engine: Engine | None = None
_Session: sessionmaker[Session] | None = None


def database_url() -> str:
    return os.environ.get("DATABASE_URL", "sqlite:///./buildtwin.db")


def get_engine(url: str | None = None) -> Engine:
    global _engine, _Session
    if _engine is None or url is not None:
        u = url or database_url()
        kw = {"connect_args": {"check_same_thread": False}} if u.startswith("sqlite") else {}
        _engine = create_engine(u, future=True, **kw)
        _Session = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def init_db(url: str | None = None) -> Engine:
    eng = get_engine(url)
    Base.metadata.create_all(eng)
    return eng


def reset_engine() -> None:
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine, _Session = None, None


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    assert _Session is not None
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def new_session() -> Session:
    get_engine()
    assert _Session is not None
    return _Session()
