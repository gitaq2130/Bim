"""안전 불변식 config 검증(과제 3, `services/progress/config_loader.UnsafeConfigOverrideError`) — 담당: qa.

**① 값 고정**(`_assert_invariant`). 아래 키는 코드가 읽어서 분기하지 않는 "문서화용" 값이다 — 값을
바꿔도 조용히 아무 일도 일어나지 않는 것이 가장 위험하므로 로딩 시점에 검사해 위험한 값이면 요란하게
실패한다:

- `document_approval.use_confirmed_mappings_only` (True 만) — readiness.yaml
- `document_approval.scoring` (`"all_or_nothing"` 만) — readiness.yaml
- `title_matching.auto_confirm` (False 만) — document_register.yaml
- `mapping.always_needs_review` (True 만) — document_register.yaml
- `normalization.seq_digits_only` (True 만) — document_register.yaml
- `title_matching.normalize.affects_doc_id` (False 만) — document_register.yaml (ADR 0009 §1, 계획 0003 §7 V5.5)

**② 키 부재**(`_assert_absent`, ADR 0009 §2 세 번째 강제 지점 / 계획 0003 §7 V5.4). 식별용 제목
정규화는 `packages/core/models/document.identity_title()` 에 **동결**돼 있다. 그것을 config 로 되돌리려는
키는 값이 무엇이든 존재해서는 안 된다 — ①과 달리 "요구값"이 없다. 손잡이 자체를 없애는 것이 목적이다:

- `title_matching.identity_normalization` (존재 금지)
- `normalization.title_identity` (존재 금지)

각각 위험한 값/키면 실패하고, 키가 아예 없으면(하위 호환) 통과해야 한다. 실제 config/ 파일은 건드리지
않는다 — `settings.config_dir` 를 임시 디렉터리로 돌려 로더가 그 파일을 우선 찾게 한다(`config_path()`:
override 디렉터리에 파일이 있으면 그것을, 없으면 기본 `config/` 로 폴백).
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from packages.core.settings import settings
from services.progress.config_loader import (
    UnsafeConfigOverrideError,
    load_config,
    load_document_register_config,
    load_readiness_config,
)


@pytest.fixture
def isolated_config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """settings.config_dir 를 빈 임시 디렉터리로 돌린다. 이 디렉터리에 없는 파일은 그대로 기본
    config/ 로 폴백하므로(config_path()), 검사 대상 파일 하나만 이 안에 써 넣으면 된다."""
    monkeypatch.setattr(settings, "config_dir", str(tmp_path))
    return tmp_path


def _write(tmp_path: Path, filename: str, data: dict) -> None:
    (tmp_path / filename).write_text(yaml.safe_dump(data), encoding="utf-8")


# ── readiness.yaml: document_approval.use_confirmed_mappings_only (True 만) ────────────────
def test_use_confirmed_mappings_only_false_is_rejected(isolated_config_dir):
    base = load_config("readiness.yaml")   # 실제 config/readiness.yaml 은 건드리지 않고 값만 베낀다
    bad = {**base, "document_approval": {**base["document_approval"], "use_confirmed_mappings_only": False}}
    _write(isolated_config_dir, "readiness.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="use_confirmed_mappings_only"):
        load_readiness_config()


def test_use_confirmed_mappings_only_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("readiness.yaml")
    without = {**base, "document_approval": {k: v for k, v in base["document_approval"].items()
                                              if k != "use_confirmed_mappings_only"}}
    _write(isolated_config_dir, "readiness.yaml", without)
    cfg = load_readiness_config()   # 예외 없이 통과해야 한다(하위 호환)
    assert "use_confirmed_mappings_only" not in cfg["document_approval"]


# ── readiness.yaml: document_approval.scoring ("all_or_nothing" 만) ────────────────────────
def test_scoring_ratio_is_rejected(isolated_config_dir):
    base = load_config("readiness.yaml")
    bad = {**base, "document_approval": {**base["document_approval"], "scoring": "ratio"}}
    _write(isolated_config_dir, "readiness.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="scoring"):
        load_readiness_config()


def test_scoring_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("readiness.yaml")
    without = {**base, "document_approval": {k: v for k, v in base["document_approval"].items() if k != "scoring"}}
    _write(isolated_config_dir, "readiness.yaml", without)
    cfg = load_readiness_config()
    assert "scoring" not in cfg["document_approval"]


# ── document_register.yaml: title_matching.auto_confirm (False 만) ─────────────────────────
def test_auto_confirm_true_is_rejected(isolated_config_dir):
    base = load_config("document_register.yaml")
    bad = {**base, "title_matching": {**base["title_matching"], "auto_confirm": True}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="auto_confirm"):
        load_document_register_config()


def test_auto_confirm_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("document_register.yaml")
    without = {**base, "title_matching": {k: v for k, v in base["title_matching"].items() if k != "auto_confirm"}}
    _write(isolated_config_dir, "document_register.yaml", without)
    cfg = load_document_register_config()
    assert "auto_confirm" not in cfg["title_matching"]


# ── document_register.yaml: mapping.always_needs_review (True 만) ──────────────────────────
def test_always_needs_review_false_is_rejected(isolated_config_dir):
    base = load_config("document_register.yaml")
    bad = {**base, "mapping": {**base["mapping"], "always_needs_review": False}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="always_needs_review"):
        load_document_register_config()


def test_always_needs_review_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("document_register.yaml")
    without = {**base, "mapping": {k: v for k, v in base["mapping"].items() if k != "always_needs_review"}}
    _write(isolated_config_dir, "document_register.yaml", without)
    cfg = load_document_register_config()
    assert "always_needs_review" not in cfg["mapping"]


# ── document_register.yaml: normalization.seq_digits_only (True 만) ────────────────────────
def test_seq_digits_only_false_is_rejected(isolated_config_dir):
    """`seq_normalized` 는 doc_id 재료다(ADR 0007 §2-1) — false 로 바꿔도 파서는 그대로 숫자만 뽑는데,
    바꾼 사람은 문서 정체성이 달라질 거라 기대한다. 그 오해를 조용히 지나가게 두지 않는다."""
    base = load_config("document_register.yaml")
    bad = {**base, "normalization": {**base["normalization"], "seq_digits_only": False}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="seq_digits_only"):
        load_document_register_config()


def test_seq_digits_only_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("document_register.yaml")
    without = {**base, "normalization": {k: v for k, v in base["normalization"].items() if k != "seq_digits_only"}}
    _write(isolated_config_dir, "document_register.yaml", without)
    cfg = load_document_register_config()
    assert "seq_digits_only" not in cfg["normalization"]


# ── document_register.yaml: title_matching.normalize.affects_doc_id (False 만) ─────────────
# 계획 0003 §7 V5.5 (ADR 0009 §1·§2). 이 블록은 **대조 전용**이고 doc_id 를 움직이지 않는다.
# true 로 바꿔도 동작은 그대로다 — 그렇게 믿는 것 자체가 ADR 0009 가 고친 사고의 원인이므로 실패시킨다.
def test_affects_doc_id_true_is_rejected(isolated_config_dir):
    base = load_config("document_register.yaml")
    bad = {**base, "title_matching": {**base["title_matching"],
                                      "normalize": {**base["title_matching"]["normalize"], "affects_doc_id": True}}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="affects_doc_id"):
        load_document_register_config()


def test_affects_doc_id_missing_key_is_backward_compatible(isolated_config_dir):
    base = load_config("document_register.yaml")
    normalize = {k: v for k, v in base["title_matching"]["normalize"].items() if k != "affects_doc_id"}
    without = {**base, "title_matching": {**base["title_matching"], "normalize": normalize}}
    _write(isolated_config_dir, "document_register.yaml", without)
    cfg = load_document_register_config()
    assert "affects_doc_id" not in cfg["title_matching"]["normalize"]


# ── document_register.yaml: 식별 정규화를 config 로 되돌리려는 키는 **존재 금지** ─────────────
# 계획 0003 §7 V5.4 (ADR 0009 §2). 값 검사가 아니라 키의 존재를 막는다: 정규화 규칙은 정규식 목록·문자
# 집합·불리언의 중첩 구조라 "요구값과 같은가"를 검사하려면 그 구조를 코드에 한 벌 더 적어야 하고,
# 그러면 진실 원천이 둘이 된다. 그리고 config 에 키가 보이면 사람은 만진다.
@pytest.mark.parametrize("value", [
    {"lowercase": False, "strip_chars": "()"},   # 그럴듯한 설정
    {},                                          # 빈 dict
    None,                                        # null
], ids=["populated", "empty", "null"])
def test_title_matching_identity_normalization_key_is_rejected_whatever_its_value(isolated_config_dir, value):
    base = load_config("document_register.yaml")
    bad = {**base, "title_matching": {**base["title_matching"], "identity_normalization": value}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="identity_normalization"):
        load_document_register_config()


@pytest.mark.parametrize("value", [{"lowercase": False}, {}, None], ids=["populated", "empty", "null"])
def test_normalization_title_identity_key_is_rejected_whatever_its_value(isolated_config_dir, value):
    """이름을 바꿔서도 되돌리는 경로는 없다 — 두 번째 키도 같은 무게로 막는다."""
    base = load_config("document_register.yaml")
    bad = {**base, "normalization": {**base["normalization"], "title_identity": value}}
    _write(isolated_config_dir, "document_register.yaml", bad)
    with pytest.raises(UnsafeConfigOverrideError, match="title_identity"):
        load_document_register_config()


def test_shipped_config_passes_every_identity_guard():
    """저장소가 실제로 쓰는 `config/document_register.yaml` 이 위 여섯 검사를 통과한다 —
    가드를 추가하면서 정작 배포 config 가 로딩되지 않는 상태를 만들지 않았는지 본다."""
    cfg = load_document_register_config()
    assert cfg["title_matching"]["normalize"]["affects_doc_id"] is False
    assert "identity_normalization" not in cfg["title_matching"]
    assert "title_identity" not in cfg["normalization"]
