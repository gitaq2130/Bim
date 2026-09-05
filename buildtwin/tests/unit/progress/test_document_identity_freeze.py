"""문서 정체성 동결 — ADR 0009 / 계획 0003 §7 V1·V5·V6 (담당: qa).

이번 결함은 이 저장소가 겪은 "조용히 죽는" 실패의 극단이다: 예외 없음, 테스트 전부 통과, 화면 정상,
**CM 이 확정·반려한 이력만 사라짐**. `title_normalized` 하나가 식별(`doc_id` 재료)과 대조(제목 유사도)를
겸했기 때문에, 매칭 임계값을 다시 재려고 같은 config 블록의 `normalize` 를 한 줄 만지면 문서 열 건 중
여섯 건의 `doc_id` 가 바뀌고 CM 의 판단이 고아 문서에 남았다.

이 파일이 고정하는 것:

- **V1** 계약: `title_matching.*` 를 어떻게 흔들어도 `doc_id` 는 한 건도 움직이지 않는다.
- **V5** 동결의 강제: `title_identity` 는 호출자 값을 무시하고 `title` 에서 파생되며, `identity_title` 은
  표기 인코딩만 흡수하고 내용 편집에는 반응한다. 파서에 해시 계산이 되살아나지 않는다.
  (V5.4·V5.5 config 로더 가드는 이 저장소가 그 패턴을 이미 모아 둔
  `tests/unit/progress/test_config_loader_safety_invariants.py` 가 이어서 고정한다.
  V5 의 지문·`title_identity` **저장**은 `tests/unit/ingest/test_document_identity_persistence.py`.)
- **V6** 스킴 버전이 실제로 참여한다.

**계획에서 고쳐 쓴 부분 — V1 자기검증 레시피(§7 V1 마지막 줄)가 부정확했다.**
계획은 "`compute_doc_id` 의 마지막 인자를 `title_normalized` 로 바꾸면 승인요청·괄호·`lowercase` 세
뮤테이션에서 실패한다"고 적었으나, 그 상태로 실제 측정하면 **`lowercase: false` 는 0/10 으로 통과한다** —
`identity_title` 이 이미 `casefold()` 하므로 대조 정규화의 대소문자 설정이 해시에 흡수된다. 결함 코드에서
실제로 `doc_id` 를 움직이는 뮤테이션은 아래 `_MUTATIONS` 의 `defect_doc_id_moves` 열에 실측으로 적어 두었고,
계획 §9 체크 6("6/10 이상 움직이는 것 3개 이상")은 그 네 개(승인요청 6 · 괄호 7 · strip_chars 전체 삭제 8 ·
normalize 블록 삭제 8)로 성립한다. `test_mutation_set_would_have_caught_the_original_defect` 가 그 조건
자체를 테스트로 건다.

**반증 — 결함이 있어도 통과하는 단언(계획 §7 V1, 여기서 쓰지 않는다):**
- `len(set(doc_ids)) == 10`(유일성) — 결함 상태에서도 10/10 유일이다. **측정됨.**
- `len(docs) == 10`(건수) — 결함 상태에서도 10.
- `min_similarity` 뮤테이션 하나만 쓰는 것 — 결함 코드에서도 0/10 이라 무조건 통과한다. **측정됨.**
- 뮤테이션이 실제로 적용됐음을 확인하지 않는 것 — 오타난 config 키는 아무 일도 하지 않으므로 모든
  단언이 초록이 된다(가짜 초록). 그래서 각 뮤테이션은 `matching_output_moves` 로 "대조 정규화 결과가
  실제로 몇 건 바뀌는가"를 함께 단언한다.
"""
from __future__ import annotations

import copy
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import openpyxl
import pytest
import yaml

from packages.core.models import document as document_model
from packages.core.models.document import (
    DOC_ID_SCHEME,
    Document,
    DocumentType,
    compute_doc_id,
    identity_title,
)
from packages.core.models.evidence import Evidence
from packages.core.settings import settings
from services.progress import identity_surface
from services.progress.config_loader import load_config
from services.progress.identity_surface import identity_surface_fingerprint
from services.progress.importers.document_register import import_document_register

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
REGISTER = FIXTURES / "document_register.xlsx"
PARSER_SOURCE = Path(__file__).resolve().parents[3] / "services/progress/importers/document_register.py"
FIXTURE_DOCUMENT_COUNT = 10


# ─────────────────────────────────────────────────────────────────────────────
# 공용 — 매칭 config 를 흔들어 다시 파싱한다
# ─────────────────────────────────────────────────────────────────────────────
def _parse(config_dir: Path | None, monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    if config_dir is not None:
        monkeypatch.setattr(settings, "config_dir", str(config_dir))
    return list(import_document_register(REGISTER, "p-freeze", "f-freeze").documents)


def _write_mutated_config(tmp_path: Path, mutate: Callable[[dict[str, Any]], None]) -> Path:
    """실제 `config/document_register.yaml` 은 건드리지 않는다 — 값만 베껴 임시 디렉터리에 쓴다
    (`config_path()`: override 디렉터리에 파일이 있으면 그것을, 없으면 저장소 기본 config/ 로 폴백)."""
    cfg = copy.deepcopy(load_config("document_register.yaml"))
    mutate(cfg)
    target = tmp_path / "cfg"
    target.mkdir(exist_ok=True)
    (target / "document_register.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    return target


@dataclass(frozen=True)
class _Mutation:
    """매칭 튜닝 한 가지와, 그 튜닝이 실제로 무엇을 움직이는지의 실측치.

    `matching_output_moves`: 이 튜닝으로 `title_normalized`(대조용)가 달라지는 문서 수. **0 이 아닌
    값은 "뮤테이션이 no-op 이 아니다"의 증거**이고, 0 인 항목(임계·가중치·판별 토큰)은 애초에 제목
    정규화를 건드리지 않는 튜닝이라 대조 출력이 바뀌지 않는 것이 정상이다.

    `defect_doc_id_moves`: **ADR 0009 이전의 결함 코드**(`compute_doc_id` 의 마지막 인자로 원문 제목
    대신 `title_normalized` 를 넘기던 상태)에서 이 튜닝이 움직이던 `doc_id` 수. 손으로 되돌려 측정했다.
    이 값이 큰 항목이 이 테스트의 실제 방어력이다 — 0 인 항목만 모아 두면 결함 코드에서도 전부 통과한다.
    """

    name: str
    mutate: Callable[[dict[str, Any]], None]
    matching_output_moves: int
    defect_doc_id_moves: int


def _drop_parens_from_strip_chars(cfg: dict[str, Any]) -> None:
    normalize = cfg["title_matching"]["normalize"]
    normalize["strip_chars"] = "".join(ch for ch in normalize["strip_chars"] if ch not in "()[]{}")


def _rebalance_similarity_weights(cfg: dict[str, Any]) -> None:
    cfg["title_matching"]["seq_weight"] = 0.5
    cfg["title_matching"]["token_weight"] = 0.5


#: 계획 §7 V1 의 8가지 + qa 가 더한 2가지(`strip_chars` 전체 삭제 · `normalize` 블록 삭제).
#: 계획의 8가지 중 결함 코드에서 6/10 이상 움직이는 것은 실측상 둘뿐이라(승인요청 6, 괄호 7 —
#: `lowercase:false` 는 casefold 에 흡수돼 0), §9 체크 6("3개 이상")을 만족시키려면 더 필요했다.
_MUTATIONS: tuple[_Mutation, ...] = (
    _Mutation("strip_patterns += '승인요청'",
              lambda c: c["title_matching"]["normalize"]["strip_patterns"].append("승인요청"), 6, 6),
    _Mutation("strip_patterns += r'\\d+\\s*차'",
              lambda c: c["title_matching"]["normalize"]["strip_patterns"].append(r"\d+\s*차"), 0, 0),
    _Mutation("strip_chars 에서 괄호 제거", _drop_parens_from_strip_chars, 7, 7),
    _Mutation("lowercase: false",
              lambda c: c["title_matching"]["normalize"].update({"lowercase": False}), 9, 0),
    _Mutation("strip_chars 전체 삭제",
              lambda c: c["title_matching"]["normalize"].update({"strip_chars": ""}), 8, 8),
    _Mutation("normalize 블록 통째로 삭제",
              lambda c: c["title_matching"].pop("normalize"), 8, 8),
    _Mutation("min_similarity 0.22 → 0.30",
              lambda c: c["title_matching"].update({"min_similarity": 0.30}), 0, 0),
    _Mutation("seq_weight/token_weight 재조정", _rebalance_similarity_weights, 0, 0),
    _Mutation("discriminative_tokens 추가",
              lambda c: c["title_matching"]["discriminative_tokens"].append(
                  {"name": "phase", "pattern": r"(\d+)\s*단계"}), 0, 0),
    _Mutation("mapping_weights 재조정",
              lambda c: c["mapping_weights"].update({"title_similarity": 0.5, "level_match": 0.25}), 0, 0),
)


@pytest.fixture(scope="module")
def baseline() -> list[Any]:
    """기준 config(저장소 기본 `config/`)로 파싱한 문서 목록. 뮤테이션 결과와 순서까지 비교한다."""
    docs = list(import_document_register(REGISTER, "p-freeze", "f-freeze").documents)
    assert len(docs) == FIXTURE_DOCUMENT_COUNT, docs
    return docs


# ═══════════════════════════════════════════════════════════════════════════
# V1 — 계약: 매칭 튜닝은 doc_id 를 한 건도 움직이지 않는다
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("mutation", _MUTATIONS, ids=lambda m: m.name)
def test_matching_config_mutation_does_not_move_any_doc_id(
    mutation: _Mutation, baseline: list[Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ADR 0009 §5 규칙 2 — `title_matching.*` 아래 어떤 값도 `doc_id` 를 움직이지 않는다.

    두 가지를 함께 단언한다:
    1. `doc_id` 목록이 **순서까지** 동일하다(집합 비교는 "10건이 통째로 다른 10건이 됐다"도 통과시킨다).
    2. 뮤테이션이 실제로 적용됐다 — 대조용 `title_normalized` 가 실측치만큼 움직였다. 이것이 없으면
       config 키 오타 하나로 이 테스트 전체가 아무것도 검사하지 않는 초록이 된다.
    """
    mutated = _parse(_write_mutated_config(tmp_path, mutation.mutate), monkeypatch)
    assert [d.doc_id for d in mutated] == [d.doc_id for d in baseline], (
        f"매칭 튜닝 {mutation.name!r} 이 doc_id 를 움직였다 — ADR 0009 §5 규칙 2 위반. "
        "이 한 줄이 CM 의 확정·반려 이력을 조용히 무효화한다(ADR 0009 §2)"
    )

    moved = sum(1 for before, after in zip(baseline, mutated, strict=True)
                if before.title_normalized != after.title_normalized)
    assert moved == mutation.matching_output_moves, (
        f"뮤테이션 {mutation.name!r} 이 대조 정규화를 예상만큼 움직이지 않았다"
        f"(기대 {mutation.matching_output_moves}건, 실제 {moved}건) — 뮤테이션이 no-op 이면 위 doc_id "
        "단언은 아무것도 증명하지 않는다. config 키 이름이 바뀌었는지 확인할 것"
    )


def test_matching_config_mutation_keeps_title_identity_and_material(
    baseline: list[Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`doc_id` 만이 아니라 그 **재료**가 그대로임을 확인한다 — 해시가 우연히 같은 것이 아니다.

    가장 크게 움직이는 뮤테이션(`normalize` 블록 삭제, 결함 코드에서 8/10)으로 대표 검사한다.
    """
    mutation = next(m for m in _MUTATIONS if m.name == "normalize 블록 통째로 삭제")
    mutated = _parse(_write_mutated_config(tmp_path, mutation.mutate), monkeypatch)
    for before, after in zip(baseline, mutated, strict=True):
        assert (after.doc_type, after.sender_normalized, after.seq_normalized, after.title_identity) == (
            before.doc_type, before.sender_normalized, before.seq_normalized, before.title_identity)
        assert after.title_identity == identity_title(after.title)
    # 그러면서도 대조 쪽 출력은 실제로 달라져 있다 — 재료가 같은 것이지 뮤테이션이 무력한 것이 아니다.
    assert sum(1 for b, a in zip(baseline, mutated, strict=True)
               if b.title_normalized != a.title_normalized) == mutation.matching_output_moves


def test_mutation_set_would_have_caught_the_original_defect() -> None:
    """계획 §9 reviewer 체크 6 을 테스트로 건다 — 뮤테이션 목록에 **결함 코드에서 6/10 이상 움직이는 것이
    3개 이상** 있어야 한다.

    이 검사가 필요한 이유: 위 파라미터 목록은 결함이 고쳐진 지금 전부 0/10 이라 **아무 뮤테이션이나 넣어도
    초록이다.** 목록에서 "무는 것"을 빼거나 임계·가중치 튜닝만 남기면 테스트는 계속 통과하면서 방어력만
    사라진다. 실측치(`defect_doc_id_moves`)는 손으로 결함을 되돌려 잰 값이다:
    승인요청 6 · 괄호 7 · strip_chars 전체 삭제 8 · normalize 블록 삭제 8 (`lowercase:false` 는 0 —
    계획 §7 V1 의 자기검증 레시피가 이 항목에서 틀렸다).
    """
    biting = [m.name for m in _MUTATIONS if m.defect_doc_id_moves >= 6]
    assert len(biting) >= 3, f"결함 코드에서 6/10 이상 움직이는 뮤테이션이 부족하다: {biting}"


# ═══════════════════════════════════════════════════════════════════════════
# V5 — 동결의 강제
# ═══════════════════════════════════════════════════════════════════════════
def _document(title: str, **overrides: Any) -> Document:
    payload: dict[str, Any] = {
        "project_id": "p-freeze", "doc_id": "doc-v1-0000000000000000", "doc_type": DocumentType.TFA,
        "sender": "동부", "sender_normalized": "동부건설", "title": title, "title_normalized": title,
        "approval_confidence": 1.0,
        "approval_evidence": Evidence(source_type="document", source_id="f-freeze", method="unit-test"),
        "file_id": "f-freeze", "sheet_name": "TFA", "source_row": 4,
    }
    payload.update(overrides)
    return Document(**payload)


def test_title_identity_is_derived_and_caller_value_is_discarded() -> None:
    """V5.1 — 호출자가 준 `title_identity` 는 버려진다(ADR 0009 §2 두 번째 강제 지점).

    재료를 호출자가 고를 수 있으면 동결은 관례일 뿐 강제가 아니다. 오늘의 사고가 정확히
    "호출자가 재료를 골랐다"에서 비롯됐다.
    """
    assert _document("  A  B ", title_identity="LIES").title_identity == "a b"


@pytest.mark.parametrize("variant", [
    "시공상세도 승인요청 - 1F 기둥 배근도 (Z1)",          # 원문
    "시공상세도  승인요청 - 1F 기둥 배근도 (Z1)",          # 공백 2칸
    "  시공상세도 승인요청 - 1F 기둥 배근도 (Z1)  ",       # 앞뒤 공백
    "시공상세도 승인요청 - 1F 기둥 배근도 （Z1）",          # 전각 괄호
    "시공상세도 승인요청 - 1F 기둥 배근도 (Ｚ1)",          # 전각 영문
    "시공상세도 승인요청 - 1f 기둥 배근도 (z1)",           # 소문자
    "시공상세도 승인요청 - 1F 기둥 배근도 (Z1)",      # 논브레이킹 스페이스
])
def test_identity_title_absorbs_notation_encoding(variant: str) -> None:
    """V5.2 — 전각/반각·NBSP·중복 공백·대소문자는 엑셀에서 IME 상태에 따라 저절로 섞여 들어오는
    **표기 인코딩**이지 사람이 문서를 고쳐 쓴 것이 아니다(ADR 0009 §3)."""
    canonical = identity_title("시공상세도 승인요청 - 1F 기둥 배근도 (Z1)")
    assert identity_title(variant) == canonical
    assert compute_doc_id("TFA", "동부건설", "26049", variant) == compute_doc_id("TFA", "동부건설", "26049", canonical)


@pytest.mark.parametrize("edited", [
    "시공상세도 승인요청  1F 기둥 배근도 (Z1)",     # 하이픈 제거
    "시공상세도 승인요청 - 1F 기둥 배근도 Z1",       # 괄호 제거
    "시공상세도 - 1F 기둥 배근도 (Z1)",             # 머리말 토큰 제거
])
def test_identity_title_reacts_to_content_edits(edited: str) -> None:
    """V5.3 — 괄호·하이픈이 사라진 것은 **누군가 제목을 편집한 것**이고, 정체성이 흔들릴 수도 있는
    사건이므로 시스템이 대신 판단하지 않는다(ADR 0009 §3 — 분리 쪽으로 틀린다).

    이 검사가 없으면 "무조건 같은 값을 뱉는" 구현도 V5.1·V5.2 를 통과한다(계획 §7 V5 반증).
    """
    original = "시공상세도 승인요청 - 1F 기둥 배근도 (Z1)"
    assert identity_title(edited) != identity_title(original)
    assert compute_doc_id("TFA", "동부건설", "26049", edited) != compute_doc_id("TFA", "동부건설", "26049", original)


def test_parser_source_has_no_doc_id_hashing() -> None:
    """V5.6 — 파서에 해시 계산이 되살아나지 않는다(ADR 0009 §5 규칙 1).

    **한계를 숨기지 않는다**(계획 §7 V5 반증): 문자열 검사라 우회가 쉽다(`import hashlib as h`).
    그래도 두는 이유는 **되살아나는 사고를 막는 것**이 목적이지 악의를 막는 것이 아니기 때문이다.
    진짜 방어는 V1 이다 — 어떤 방식으로 해시를 되살리든 매칭 튜닝이 `doc_id` 를 움직이는 순간 V1 이 실패한다.
    """
    source = PARSER_SOURCE.read_text(encoding="utf-8")
    assert "_compute_doc_id" not in source, "파서가 자체 doc_id 해시 함수를 되살렸다"
    assert not re.search(r"^\s*import\s+hashlib", source, flags=re.MULTILINE), "파서에 hashlib import 가 되살아났다"
    assert re.search(r"from packages\.core\.models\.document import [^\n]*compute_doc_id", source), (
        "파서가 packages.core.models.document.compute_doc_id 를 import 하지 않는다")


def test_doc_id_prefix_is_minted_in_exactly_one_place() -> None:
    """규칙 1의 넓은 형태 — `doc-v…` 접두사를 만드는 자리가 저장소에 하나뿐이다.

    V5.6 이 파서 한 파일만 보는 데 비해, 이 검사는 "다른 모듈에 복제본이 생겼다"를 본다.
    (문자열 검사의 한계는 위와 같다.)
    """
    root = Path(__file__).resolve().parents[3]
    minting = [p for p in sorted((root / "services").rglob("*.py")) + sorted((root / "packages").rglob("*.py"))
               if re.search(r'f?"doc-v', p.read_text(encoding="utf-8"))]
    assert minting == [root / "packages/core/models/document.py"], minting


# ═══════════════════════════════════════════════════════════════════════════
# V6 — 스킴 버전이 실제로 참여한다
# ═══════════════════════════════════════════════════════════════════════════
def test_every_doc_id_carries_the_current_scheme(baseline: list[Any]) -> None:
    """V6.1 — 접두사에 스킴이 실린다. **리터럴 `"doc-v1-"` 로 쓰지 않는다**: 그러면
    `compute_doc_id` 가 상수를 읽지 않고 접두사를 하드코딩한 구현이 그대로 통과하고, 나중에
    `DOC_ID_SCHEME` 를 올려도 `doc_id` 가 안 바뀌어 ADR 0009 §5 규칙 5가 무력해진다(V6.2 와 함께 볼 것).
    """
    prefix = f"doc-v{DOC_ID_SCHEME}-"
    assert all(d.doc_id.startswith(prefix) for d in baseline)
    assert all(re.fullmatch(rf"doc-v{DOC_ID_SCHEME}-[0-9a-f]{{16}}", d.doc_id) for d in baseline)


def test_raising_the_scheme_changes_every_doc_id(baseline: list[Any], monkeypatch: pytest.MonkeyPatch) -> None:
    """V6.2 — `DOC_ID_SCHEME` 를 올리면 같은 입력의 `doc_id` 가 **전부** 달라진다.

    잡는 것은 "재료에 들어갔는가"가 아니라 **"상수를 읽는가"** 다(계획 §7 V6). 접두사에만 실리는 것은
    의도한 설계이며, 값이 문자열 표면에 보이는 편이 마이그레이션 조회
    (`WHERE doc_id NOT LIKE 'doc-v2-%'`)에 유리하기 때문이다.
    """
    before = [compute_doc_id(d.doc_type.value, d.sender_normalized, d.seq_normalized, d.title) for d in baseline]
    monkeypatch.setattr(document_model, "DOC_ID_SCHEME", DOC_ID_SCHEME + 1)
    after = [compute_doc_id(d.doc_type.value, d.sender_normalized, d.seq_normalized, d.title) for d in baseline]

    assert all(a != b for a, b in zip(after, before, strict=True))
    assert all(a.startswith(f"doc-v{DOC_ID_SCHEME + 1}-") for a in after)
    # 스킴은 **접두사에만** 들어간다(ADR 0009 §5 규칙 5 / 계획 §7 V6): 해시 재료는 그대로여야
    # 옛 doc_id → 새 doc_id 사상을 계산으로 만들 수 있다(ADR 0009 §마이그레이션 표).
    assert [a.split("-", 2)[2] for a in after] == [b.split("-", 2)[2] for b in before]


def test_raising_the_scheme_changes_the_identity_fingerprint(monkeypatch: pytest.MonkeyPatch) -> None:
    """스킴이 올라가면 같은 config 라도 `doc_id` 산출 규칙이 달라진 것이므로 지문도 달라져야 한다
    (ADR 0009 §5-2 — §5 규칙 4의 마이그레이션이 그 사실을 데이터에서 확인할 수 있어야 한다).

    `identity_surface` 는 `DOC_ID_SCHEME` 를 import 시점에 **값으로** 들여오므로 여기서 패치할 대상은
    그 모듈의 이름이다(운영에서 상수를 올리면 두 모듈이 함께 새 값을 본다).
    """
    cfg = load_config("document_register.yaml")
    before = identity_surface_fingerprint(cfg)
    monkeypatch.setattr(identity_surface, "DOC_ID_SCHEME", DOC_ID_SCHEME + 1)
    assert identity_surface_fingerprint(cfg) != before


# ═══════════════════════════════════════════════════════════════════════════
# 지문은 config 를 따라간다 — 대장 파일이 아니라 (계획 §1-a 블라인드 스팟 1)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.fixture
def sheet_renamed_register(tmp_path: Path) -> Iterator[Path]:
    """사용자가 엑셀에서 시트명을 바꾼 대장. config 는 한 글자도 바뀌지 않는다."""
    wb = openpyxl.load_workbook(REGISTER, data_only=True)
    wb["TFA"].title = "자료제출"      # sheet_doc_types 에서 TFR 로 걸린다 → doc_type 이 바뀐다
    path = tmp_path / "sheet_renamed.xlsx"
    wb.save(path)
    yield path


def test_workbook_sheet_rename_moves_doc_ids_without_touching_the_fingerprint(
    baseline: list[Any], sheet_renamed_register: Path,
) -> None:
    """식별 표면 지문은 **config 의 지문**이다 — 워크북 시트명처럼 config 밖에서 들어오는 입력이 바뀌면
    `doc_id` 는 움직이는데 지문은 그대로다.

    그래서 **지문 변화는 드리프트 판정의 조건이 아니다**(보고 값일 뿐이다). 판정을
    `previous_fingerprint != current_fingerprint` 로 거는 구현은 이 경로를 통째로 놓친다 —
    실제 탐지는 `tests/integration/test_17_document_identity_drift.py` 의 시트명 케이스가 고정한다.
    """
    base_result = import_document_register(REGISTER, "p-freeze", "f-freeze")
    renamed_result = import_document_register(sheet_renamed_register, "p-freeze", "f-freeze")
    renamed = list(renamed_result.documents)

    assert renamed_result.identity_fingerprint == base_result.identity_fingerprint != ""
    moved = sum(1 for before, after in zip(baseline, renamed, strict=True) if before.doc_id != after.doc_id)
    assert moved == 8, moved      # 실측: TFA 시트 8건이 TFR 로 재분류되어 doc_id 가 움직인다
    assert [d.title for d in renamed] == [d.title for d in baseline]   # 대장 원문은 그대로다
