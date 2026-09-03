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
    path = config_path(filename)
    if not path.exists():
        if required:
            raise FileNotFoundError(f"config file not found: {filename} (searched {settings.config_dir}, {_DEFAULT_CONFIG_DIR})")
        return {}
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"config file {path} must contain a mapping at top level")
    return data


class UnsafeConfigOverrideError(ValueError):
    """안전 불변식으로 **문서화된** config 키를 코드가 허용하지 않는 값으로 바꾸려는 시도.

    ADR 0007 §4 규칙 5(문서 매핑은 confidence 와 무관하게 항상 needs_review=True)와
    §5-1(도면 승인은 비율이 아니라 논리곱)은 코드에 하드코딩된 불변식이고, 아래 네 config 키는 그
    불변식을 "문서화"하는 값일 뿐 코드가 읽어서 분기하지 않는다. 값을 바꿔도 아무 일도 일어나지
    않는 것이 가장 위험하다 — 운영자가 "설정했으니 됐다"고 믿게 된다. 그래서 로딩 시점에 값을
    검사해, 안전하지 않은 값으로 바뀌면 조용히 무시하는 대신 요란하게 실패한다."""


def _assert_invariant(cfg: dict[str, Any], path: tuple[str, ...], expected: Any, why: str) -> None:
    node: Any = cfg
    for key in path[:-1]:
        if not isinstance(node, dict) or key not in node:
            return   # 섹션 자체가 없으면 검사할 것이 없다(하위 호환 — 기존 동작 유지)
        node = node[key]
    if not isinstance(node, dict) or path[-1] not in node:
        return       # 키가 아예 없으면 검사하지 않는다(기존 동작 유지) — 있는데 다른 값일 때만 막는다
    actual = node[path[-1]]
    if actual != expected:
        dotted = ".".join(path)
        raise UnsafeConfigOverrideError(
            f"{dotted} = {actual!r} 는 허용되지 않는다(요구값 {expected!r}). {why}"
        )


def load_readiness_config() -> dict[str, Any]:
    cfg = load_config("readiness.yaml")
    _assert_invariant(
        cfg, ("document_approval", "use_confirmed_mappings_only"), True,
        "이 값은 ADR 0007 §5-2 규칙 3(미확정 매핑은 readiness 점수에 반영하지 않는다)을 문서화하는 안전 "
        "불변식이며 코드가 읽지 않는다 — services/progress/document_mapper.confirmed_required_documents() "
        "는 언제나 needs_review=False 인 매핑만 센다. false 로 바꾸는 것은 'CM 미확정 상태에서도 착수 가능 "
        "판단을 움직이겠다'는 뜻이라 ADR 0001 불변식 1(확정은 cm만)과 충돌한다.",
    )
    _assert_invariant(
        cfg, ("document_approval", "scoring"), "all_or_nothing",
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
    """`document_mapper.py`·`importers/document_register.py` 공용 로더. 두 안전 불변식 키를 검사한다."""
    cfg = load_config("document_register.yaml")
    _assert_invariant(
        cfg, ("title_matching", "auto_confirm"), False,
        "이 값은 ADR 0007 §4 규칙 5(문서 매핑은 유사도 값과 무관하게 항상 needs_review=True)를 문서화하는 "
        "안전 불변식이며 코드가 읽지 않는다 — packages/core/models/document.ActivityDocumentMapping 이 "
        "model_validator 에서 confidence 와 무관하게 needs_review=(reviewed_by is None) 을 강제한다. true 로 "
        "바꿔도 매핑은 여전히 항상 needs_review=True 다(이 설정으로는 끌 수 없다) — 이 사실이 아무 일도 "
        "일어나지 않는 채로 조용히 지나가는 것 자체가 위험하므로 로딩을 실패시킨다.",
    )
    _assert_invariant(
        cfg, ("mapping", "always_needs_review"), True,
        "이 값도 같은 불변식(ADR 0007 §4 규칙 5)을 문서화한다. false 로 바꿔도 "
        "ActivityDocumentMapping 모델이 그대로 needs_review=True 를 강제하므로 코드 동작은 바뀌지 않는다 "
        "— 그 사실을 조용히 넘기지 않기 위해 로딩을 실패시킨다.",
    )
    return cfg
