"""식별 컬럼 저장과 지문 대조 — ADR 0009 §5-2 / 계획 0003 §3-e·§7 V5 (담당: qa).

`persist_document_register_import` 는 행마다 두 값을 남긴다:

- `title_identity` — `doc_id` 해시에 **실제로 들어간 문자열**. 이 컬럼이 비면 "어떤 문자열로 해시됐는가"를
  되짚을 수 없고, 마이그레이션(옛 doc_id → 새 doc_id 사상)도 감사도 불가능해진다.
- `identity_fingerprint` — 그 `doc_id` 를 만든 **규칙의 지문**(적재 단위 값을 행마다 복제한다).
  드리프트 보고의 `previous_fingerprint` 는 이 컬럼에서만 나온다 — 저장을 빠뜨리면 "무엇이 바뀌어서"를
  영원히 답할 수 없고, 그 침묵은 어떤 기능 테스트도 실패시키지 않는다(이번 사이클의 지배적 실패 모드).

**여기서 고정하지 않는 것**: 드리프트 판정 자체(어떤 쌍이 이동으로 잡히는가)는 통합 테스트
`tests/integration/test_17_document_identity_drift.py` 가 소유한다. 이 파일은 "두 컬럼이 실제로 쓰이는가"
와 "지문 두 개가 보고에 실려 나오는가"만 본다.
"""
from __future__ import annotations

import copy
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from packages.core.models.document import identity_title
from packages.core.models.orm import Base, DocumentRow
from packages.core.settings import settings
from services.ingest.persistence import persist_document_register_import
from services.progress.config_loader import load_config
from services.progress.importers.document_register import import_document_register

from .conftest import make_file, make_project

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
REGISTER = FIXTURES / "document_register.xlsx"
PROJECT = "p-doc-identity"


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as s:
        make_project(s, PROJECT, name="doc identity test")
        for fid in ("f-doc-1", "f-doc-2"):
            make_file(s, fid, PROJECT, kind="xlsx")
        yield s


def _rows(session: Session) -> list[DocumentRow]:
    return list(session.scalars(select(DocumentRow).where(DocumentRow.project_id == PROJECT)
                                .order_by(DocumentRow.doc_id)))


def _sender_alias_renamed(cfg: dict[str, Any]) -> None:
    """새 협력사가 들어오면 반드시 만지는 표(ADR 0009 §5-1) — 표준명 표기를 바꾼다. 실측 7/10 이동."""
    aliases = cfg["normalization"]["sender_aliases"]
    aliases["동부건설(주)"] = aliases.pop("동부건설")


def _change_identity_surface(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """**첫 적재가 끝난 뒤**에 호출한다 — 그래야 "옛 규칙으로 쓰인 행 ↔ 새 규칙" 대조가 성립한다.
    실제 config/ 는 건드리지 않고 임시 디렉터리로 `settings.config_dir` 를 돌린다."""
    cfg = copy.deepcopy(load_config("document_register.yaml"))
    _sender_alias_renamed(cfg)
    target = tmp_path / "cfg"
    target.mkdir(exist_ok=True)
    (target / "document_register.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    monkeypatch.setattr(settings, "config_dir", str(target))


def test_persisted_rows_carry_title_identity_and_identity_fingerprint(session: Session) -> None:
    """V5 — 두 컬럼이 실제로 채워진다. `title_identity` 는 `title` 에서 파생된 값과 글자까지 같아야 하고,
    `identity_fingerprint` 는 그 적재의 지문이어야 한다(빈 문자열·NULL 은 "옛 스킴으로 쓰인 행"과
    구분되지 않는다 — orm.py 컬럼 주석)."""
    parsed = import_document_register(REGISTER, PROJECT, "f-doc-1")
    persist_document_register_import(session, PROJECT, "f-doc-1", parsed)

    rows = _rows(session)
    assert len(rows) == 10
    assert parsed.identity_fingerprint, "파서가 식별 표면 지문을 만들지 않았다"
    for row in rows:
        assert row.title_identity == identity_title(row.title) != ""
        assert row.identity_fingerprint == parsed.identity_fingerprint


def test_reimport_overwrites_fingerprint_with_the_rules_that_wrote_the_row(
    session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """갱신된 행은 **이번 적재의** 지문을 갖는다 — 지문이 "이 행을 마지막으로 쓴 규칙"을 가리켜야
    프로젝트 안에 섞인 지문으로 드리프트 구간을 되짚을 수 있다."""
    first = import_document_register(REGISTER, PROJECT, "f-doc-1")
    persist_document_register_import(session, PROJECT, "f-doc-1", first)

    _change_identity_surface(tmp_path, monkeypatch)
    second = import_document_register(REGISTER, PROJECT, "f-doc-2")
    assert second.identity_fingerprint != first.identity_fingerprint   # 식별 표면 config 가 바뀌었다
    persist_document_register_import(session, PROJECT, "f-doc-2", second)

    by_fingerprint: dict[str, int] = {}
    for row in _rows(session):
        by_fingerprint[row.identity_fingerprint] = by_fingerprint.get(row.identity_fingerprint, 0) + 1
    # 이번 적재에 나타난 10건은 새 지문, 이동으로 뒤에 남은 7건은 옛 지문 그대로.
    assert by_fingerprint == {second.identity_fingerprint: 10, first.identity_fingerprint: 7}


def test_drift_report_carries_both_fingerprints_from_stored_rows(
    session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """드리프트 보고의 `previous_fingerprint` 는 **저장된 컬럼에서만** 나온다.

    저장을 빠뜨려도 탐지(`moved`)는 그대로 동작하므로 이 값이 `None` 으로 새는 것은 조용하다 —
    "무엇이 바뀌어서 이동했는가"를 답하는 유일한 값이 사라지는데 job 은 여전히 `done` 이다.
    """
    first = import_document_register(REGISTER, PROJECT, "f-doc-1")
    persist_document_register_import(session, PROJECT, "f-doc-1", first)

    _change_identity_surface(tmp_path, monkeypatch)
    second = import_document_register(REGISTER, PROJECT, "f-doc-2")
    summary = persist_document_register_import(session, PROJECT, "f-doc-2", second)

    drift = summary.identity_drift
    assert drift is not None and len(drift.moved) == 7
    assert drift.previous_fingerprint == first.identity_fingerprint
    assert drift.current_fingerprint == second.identity_fingerprint
    assert drift.lost_decisions == []      # 이 프로젝트에는 사람의 판단이 없다(검토요청도 만들지 않는다)


def test_first_import_has_no_previous_fingerprint_and_no_drift(session: Session) -> None:
    """ADR 0009 §5-2 가 놓치는 것 1 — 첫 적재는 비교할 이전 지문도 이전 문서도 없다. 판정하지 않는 것이
    옳다(여기서 무엇이든 보고하면 새 프로젝트마다 드리프트가 뜬다)."""
    parsed = import_document_register(REGISTER, PROJECT, "f-doc-1")
    summary = persist_document_register_import(session, PROJECT, "f-doc-1", parsed)
    assert summary.identity_drift is None
