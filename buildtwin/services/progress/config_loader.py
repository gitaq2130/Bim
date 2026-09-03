"""config/*.yaml 로더. settings.config_dir 우선, 없으면 저장소 기본 config/ 로 폴백. 숫자 상수는 코드에 두지 않는다."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from packages.core.settings import ROOT, settings

_DEFAULT_CONFIG_DIR = ROOT / "config"


def config_path(filename: str) -> Path:
    primary = Path(settings.config_dir) / filename
    if primary.exists():
        return primary
    return _DEFAULT_CONFIG_DIR / filename


def load_config(filename: str, required: bool = True) -> dict[str, Any]:
    data, _ = _load_config_with_path(filename, required)
    return data


def _load_config_with_path(filename: str, required: bool = True) -> tuple[dict[str, Any], Path]:
    """`load_config`와 같지만 실제로 읽은 경로도 함께 돌려준다 — `_assert_invariant`가 예외 메시지에
    실을 수 있게 하기 위해서다(과제 4, 9차 리뷰: 어느 config_dir 의 어느 파일인지 알 수 없다는 지적)."""
    path = config_path(filename)
    if not path.exists():
        if required:
            raise FileNotFoundError(f"config file not found: {filename} (searched {settings.config_dir}, {_DEFAULT_CONFIG_DIR})")
        return {}, path
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"config file {path} must contain a mapping at top level")
    return data, path


class UnsafeConfigOverrideError(ValueError):
    """안전 불변식으로 **문서화된** config 키를 코드가 허용하지 않는 값으로 바꾸려는 시도.

    ADR 0007 §4 규칙 5(문서 매핑은 confidence 와 무관하게 항상 needs_review=True)와
    §5-1(도면 승인은 비율이 아니라 논리곱)은 코드에 하드코딩된 불변식이고, 아래 네 config 키는 그
    불변식을 "문서화"하는 값일 뿐 코드가 읽어서 분기하지 않는다. 값을 바꿔도 아무 일도 일어나지
    않는 것이 가장 위험하다 — 운영자가 "설정했으니 됐다"고 믿게 된다. 그래서 로딩 시점에 값을
    검사해, 안전하지 않은 값으로 바뀌면 조용히 무시하는 대신 요란하게 실패한다."""


def _assert_invariant(cfg: dict[str, Any], source: Path, key_path: tuple[str, ...], expected: Any, why: str) -> None:
    """`source`는 실제로 읽은 config 파일 경로다(과제 4) — `settings.config_dir` 오버라이드가 있으면
    저장소 기본 `config/`가 아니라 그 경로일 수 있으므로, 예외 메시지에 파일명뿐 아니라 어느 디렉터리의
    파일인지까지 실어야 운영자가 바로 찾아갈 수 있다. 키 이름은 `readiness.yaml`·`document_register.yaml`
    사이에 겹칠 수 있어(예: 두 파일 모두 `mapping.*`) 파일명만으로는 부족하다."""
    node: Any = cfg
    for key in key_path[:-1]:
        if not isinstance(node, dict) or key not in node:
            return   # 섹션 자체가 없으면 검사할 것이 없다(하위 호환 — 기존 동작 유지)
        node = node[key]
    if not isinstance(node, dict) or key_path[-1] not in node:
        return       # 키가 아예 없으면 검사하지 않는다(기존 동작 유지) — 있는데 다른 값일 때만 막는다
    actual = node[key_path[-1]]
    if actual != expected:
        dotted = ".".join(key_path)
        raise UnsafeConfigOverrideError(
            f"{source}: {dotted} = {actual!r} 는 허용되지 않는다(요구값 {expected!r}). {why}"
        )


def load_readiness_config() -> dict[str, Any]:
    cfg, source = _load_config_with_path("readiness.yaml")
    _assert_invariant(
        cfg, source, ("document_approval", "use_confirmed_mappings_only"), True,
        "이 값은 ADR 0007 §5-2 규칙 3(미확정 매핑은 readiness 점수에 반영하지 않는다)을 문서화하는 안전 "
        "불변식이며 코드가 읽지 않는다 — services/progress/document_mapper.confirmed_required_documents() "
        "는 언제나 needs_review=False 인 매핑만 센다. false 로 바꾸는 것은 'CM 미확정 상태에서도 착수 가능 "
        "판단을 움직이겠다'는 뜻이라 ADR 0001 불변식 1(확정은 cm만)과 충돌한다.",
    )
    _assert_invariant(
        cfg, source, ("document_approval", "scoring"), "all_or_nothing",
        "이 값은 ADR 0007 §5-1(도면 승인은 비율이 아니라 논리곱 AND)을 문서화하는 안전 불변식이며 코드가 "
        "읽지 않는다 — services/progress/readiness.drawing_component() 는 언제나 '필수 문서 전부 승인이면 "
        "1.0, 하나라도 아니면 0.0'을 계산한다. 비율로 바꾸면 9/10=0.9 가 start_threshold 를 넘겨 미승인 "
        "도면 위에서 착수 가능이 뜬다.",
    )
    return cfg


def load_resources_config() -> dict[str, Any]:
    return load_config("resources.yaml", required=False)


def load_activity_mapping_config() -> dict[str, Any]:
    return load_config("activity_mapping.yaml")


def load_wbs_mapping_config() -> dict[str, Any]:
    return load_config("wbs_mapping.yaml", required=False)


def load_document_register_config() -> dict[str, Any]:
    """`document_mapper.py`·`importers/document_register.py` 공용 로더. 세 안전 불변식 키를 검사한다."""
    cfg, source = _load_config_with_path("document_register.yaml")
    _assert_invariant(
        cfg, source, ("title_matching", "auto_confirm"), False,
        "이 값은 ADR 0007 §4 규칙 5(문서 매핑은 유사도 값과 무관하게 항상 needs_review=True)를 문서화하는 "
        "안전 불변식이며 코드가 읽지 않는다 — packages/core/models/document.ActivityDocumentMapping 이 "
        "model_validator 에서 confidence 와 무관하게 needs_review=(reviewed_by is None) 을 강제한다. true 로 "
        "바꿔도 매핑은 여전히 항상 needs_review=True 다(이 설정으로는 끌 수 없다) — 이 사실이 아무 일도 "
        "일어나지 않는 채로 조용히 지나가는 것 자체가 위험하므로 로딩을 실패시킨다.",
    )
    _assert_invariant(
        cfg, source, ("mapping", "always_needs_review"), True,
        "이 값도 같은 불변식(ADR 0007 §4 규칙 5)을 문서화한다. false 로 바꿔도 "
        "ActivityDocumentMapping 모델이 그대로 needs_review=True 를 강제하므로 코드 동작은 바뀌지 않는다 "
        "— 그 사실을 조용히 넘기지 않기 위해 로딩을 실패시킨다.",
    )
    _assert_invariant(
        cfg, source, ("normalization", "seq_digits_only"), True,
        "이 값은 ADR 0007 §2-3(seq_normalized 는 숫자 이외 문자를 모두 제거해 이어붙인다 — 자릿수를 "
        "재해석하지 않는다: 연도 확장·선행 0 제거 금지)을 문서화하는 안전 불변식이며 코드가 읽지 않는다 "
        "— services/progress/importers/document_register._seq_normalized() 는 언제나 숫자만 추출한다. "
        "seq_normalized 는 doc_id 재료다(§2-1) — auto_confirm 보다 이해관계가 크다: false 로 바꿔도 "
        "정규화 동작은 그대로인데, 바뀐다고 믿고 설정한 사람은 문서 정체성(doc_id)이 달라질 거라 "
        "기대하지만 실제로는 아무 일도 일어나지 않는다.",
    )
    return cfg
