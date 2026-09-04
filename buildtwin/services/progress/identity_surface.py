"""식별 표면(identity surface) 지문 — ADR 0009 §5-1·§5-2.

`doc_id` 재료 네 개 중 제목은 ADR 0009 §2 로 표면에서 빠졌지만(코드에 동결), 나머지는 **동결할 수 없다**:
`normalization.sender_aliases`(새 협력사가 들어오면 반드시 추가한다),
`register_layout.sheet_doc_types`·`column_aliases`(대장 서식이 현장마다 다르다)는 운영 필수다.
실측 폭발 반경은 각각 7/10, 8/10, 10/10 이다. 이들에 대해 ADR 0009 가 하는 일은 **막는 것이 아니라
알아채는 것**이고, 그 "무엇이 바뀌어서"를 답하는 값이 이 지문이다.

**왜 별도 모듈인가.** 계획 0003 §3-a 는 이 함수를 `importers/document_register.py` 에 두라고 적었지만,
같은 계획의 §2(순서 1 완료 조건)와 §7 V5.6 은 그 파일에서 `hashlib` 이 사라질 것을 요구한다 — 둘은
동시에 성립할 수 없다. 파서에 해시 계산이 **한 줄도** 남지 않는 쪽을 택했다: V5.6 의 소스 불변식이
"doc_id 해시가 파서에 되살아났다"를 문자열 검사만으로 잡을 수 있어야 하고, 지문 해시와 `doc_id` 해시가
같은 파일에 나란히 있으면 그 검사가 성립하지 않는다(리뷰어의 눈으로도 구분하기 어렵다).
`importers/document_register.py` 는 이 함수를 import 해 그대로 재수출하므로 §3-a 의 호출 계약은 그대로다.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from packages.core.models.document import DOC_ID_SCHEME

#: 지문 재료가 되는 `register_layout.column_aliases` 의 논리 컬럼. `sender`·`seq_raw`·`title` 은 각각
#: `sender_normalized`·`seq_normalized`·`title`(=`title_identity` 재료)을 **어느 열에서 읽을지**를
#: 결정하므로 별칭을 바꾸면 `doc_id` 가 움직인다(실측 10/10). 나머지 논리 컬럼(`issued_on`·`result_raw`
#: 등)은 `doc_id` 재료가 아니므로 넣지 않는다 — 넣으면 정체성과 무관한 변경이 드리프트 경고를 낸다.
_IDENTITY_COLUMN_ALIASES = ("sender", "seq_raw", "title")


def identity_surface_fingerprint(cfg: dict[str, Any]) -> str:
    """ADR 0009 §5-2. `doc_id` 재료에 관여하는 config 부분집합만 해시한다(계획 0003 §1-b 표 2~5번).

    `title_matching.*` 는 **들어가지 않는다** — ADR 0009 §2 로 정체성과 무관해졌기 때문이고, 넣으면
    매칭 임계값 보정(ADR 0007 이 예고한 대로 반드시 일어난다)이 매번 드리프트 경고를 발화시켜 경고가
    늑대소년이 된다.

    여기서 `hashlib` 을 쓰는 것은 ADR 0009 §5 규칙 1과 충돌하지 않는다 — 그 규칙이 금지하는 것은
    **`doc_id` 해시 계산의 복제**이지 해시 사용 일반이 아니다. 이 값은 `doc_id` 가 아니라 "그 `doc_id` 를
    만든 규칙의 지문"이고, `documents.identity_fingerprint` 에 적재 단위로 저장된다.

    `DOC_ID_SCHEME` 가 재료에 들어간다: 스킴이 올라가면 같은 config 라도 `doc_id` 산출 규칙이 달라진
    것이므로 지문도 달라져야 한다(§5 규칙 4의 마이그레이션이 그 사실을 데이터에서 확인할 수 있어야 한다).

    `cfg` 의 어느 섹션이 없어도 실패하지 않는다(전부 `.get`) — 지문은 안전 장치이지 검증기가 아니고,
    config 구조 검증은 `config_loader` 가 이미 한다. 여기서 KeyError 를 내면 탐지가 적재를 막는다.
    """
    layout = cfg.get("register_layout") or {}
    norm = cfg.get("normalization") or {}
    column_aliases = layout.get("column_aliases") or {}
    material = json.dumps({
        "scheme": DOC_ID_SCHEME,
        "sender_aliases": norm.get("sender_aliases", {}),
        "sheet_doc_types": layout.get("sheet_doc_types", {}),
        "fallback_doc_type": layout.get("fallback_doc_type"),
        "column_aliases": {k: column_aliases.get(k) for k in _IDENTITY_COLUMN_ALIASES},
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


__all__ = ["identity_surface_fingerprint"]
