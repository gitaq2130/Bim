"""문서 ↔ Activity 매핑 (ADR 0007 §4). 문서 ↔ 객체 직접 매핑은 만들지 않는다 — 대장에 객체를 식별할
정보가 없어 근거가 없다(§4-1 규칙 1). 필요하면 `문서 → Activity → activity_object_mappings → 객체`로 파생한다.

세 가지 안전 규칙(반드시 지킬 것 — ADR 0007 §4-2):
1. **제목 근거 없이는 어떤 조합으로도 매핑하지 않는다.** `title_similarity < title_matching.min_similarity`
   면 공종·층·날짜가 모두 맞아도 후보가 아니다.
2. **공종(discipline)은 신뢰할 수 없는 필드다.** 일치는 가점만, 불일치는 감점·배제하지 않는다.
3. **판별 토큰(ZONE·구간·차수·층)이 양쪽에 모두 존재하고 값이 다르면 유사도와 무관하게 후보에서 제외한다.**
   한쪽에만 있으면 배제하지 않고 confidence 만 낮춘다(`one_sided_token_penalty`).

`ActivityDocumentMapping` Pydantic 모델이 confidence 값과 무관하게 항상 `needs_review=True`를 강제한다
(§4 규칙 5) — 이 모듈은 그 모델을 거쳐서만 매핑을 만들고 별도로 자동 확정 로직을 두지 않는다.

`map_project_documents`는 매핑 저장에 더해 `document_mapping` ReviewRequest 생명주기 전체를 소유한다
(§4 규칙 6, CLAUDE.md §3 규칙 11): 생성(중복 방지) / 확정 시 종료(`close_document_mapping_review`,
api 가 호출) / 문서가 고아가 되면 자동 종료. api 는 이 함수들을 호출만 한다.

**반려**(10차 리뷰 후속)도 매핑 생명주기의 일부라 여기서 소유한다: `reject_document_mapping`이 매핑 행에
반려 표시를 남기면(삭제하지 않음 — ADR §4-2 규칙 7과 같은 evidence 보존 원칙), `_drop_already_confirmed`가
재계산이 같은 (activity_id, doc_id) 후보를 다시 만들지 않도록 걸러내고, `confirmed_required_documents`가
반려된 매핑을 readiness/검증 증거에서 제외한다. api 는 대응 검토요청을 `status="rejected"`로 닫는 것까지만
하고, 매핑 행은 건드리지 않은 채 `reject_document_mapping`을 호출한다.

**식별 드리프트**(ADR 0009 §5-2·§5-3)도 매핑 생명주기에 걸리므로 여기서 소유한다:
`open_identity_drift_review`가 "우리 식별 규칙이 움직여 CM 이 확정·반려한 판단이 오염됐다"는 사건을 CM 큐에
올린다. 오염되는 길은 셋이고(`lost_decisions[].cause`) 사람이 해야 할 일이 서로 다르므로 검토요청 제목은
경위마다 다르게 쓴다(`_identity_drift_review_title`) — 대장 행은 그대로인데 우리 식별 규칙이 그 행을 다른
`doc_id` 로 옮긴 것(`row_moved`), 살아 있는 `doc_id` 가 **담고 있던 대장 행이 바뀐** 것(`row_replaced`),
판단이 가리키던 대장 행이 **다른 `doc_id` 아래로 간** 것(`row_absorbed`). 판정 자체(이동 쌍 짝짓기,
행-정체/행-내용 대조)는 재업로드 규칙을 소유한 `services/ingest/persistence`가 하고, 이 모듈은 그
결과(`IdentityDriftReport`)를 받아 검토요청으로만 바꾼다. 이 kind 는 **확인 전용**이라 해소에 부수 효과가
없다 — 매핑을 되살리지 않는다.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from difflib import SequenceMatcher
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing_extensions import TypedDict  # pydantic 은 3.12 미만에서 typing_extensions.TypedDict 를 요구한다

from packages.core.models.document import ActivityDocumentMapping, Document
from packages.core.models.evidence import Evidence
from packages.core.models.orm import ActivityDocumentMappingRow, DocumentRow
from packages.core.models.progress import Activity
from packages.core.models.review import (
    IDENTITY_DRIFT_CAUSE_ROW_ABSORBED,
    IDENTITY_DRIFT_CAUSE_ROW_MOVED,
    IDENTITY_DRIFT_CAUSE_ROW_REPLACED,
    IDENTITY_DRIFT_CAUSE_UNSPECIFIED,
    IdentityDriftCause,
    ReviewRequest,
)

from . import persistence as db
from .config_loader import load_document_register_config

_UNMAPPED_WARNING_CODE = "DOCUMENT_UNMAPPED"   # config/document_register.yaml import_warnings 의 카탈로그 키(과제 3, 9차 리뷰)

# 매핑 반려 표시 (10차 리뷰 후속, reject_document_mapping 참고). `ActivityDocumentMappingRow`에 컬럼을
# 더하지 않고 기존 evidence(JSON) 안에 `extra.mapping_review_decision` 로 표시한다 — 없으면(None) 시스템이
# 제안했거나 확정된 매핑, 이 값이면 CM 이 반려한 매핑이라는 뜻이다.
_MAPPING_REVIEW_DECISION_REJECTED = "rejected"

# ADR 0009 §5-2 탐지 경고 code. config/document_register.yaml `import_warnings` 의 카탈로그 키와 같은 문자열이며,
# 실제로 발화하는 곳은 `services/ingest/persistence.persist_document_register_import`(재업로드 판정 소유)다.
# 여기서 상수로 두는 이유는 이 모듈이 만드는 검토요청 evidence 에 "무엇을 보고 만든 요청인가"를 남기기 위해서다.
_IDENTITY_DRIFT_WARNING_CODE = "DOCUMENT_IDENTITY_DRIFT"
_IDENTITY_DRIFT_METHOD = "identity_drift_detection"

# 사람의 판단이 오염된 **경위**(`IdentityDriftReport.lost_decisions[]` 의 `cause`). 값을 붙이는 곳은 판정을
# 소유한 `services/ingest/persistence` 이고 이 모듈은 소비자다 — CM 에게 보일 문구를 이 값으로 가른다.
# **값의 정본은 `packages/core/models/review.IDENTITY_DRIFT_CAUSES` 하나뿐이고**(ADR 0009 §Deferred 5,
# 계획 0005 §과제 2), 아래 `_CAUSE_*` 는 그 정본의 **별칭**이다 — 이 모듈은 값을 다시 적지 않는다.
# 셋을 하나로 뭉뚱그린 문구는 그 자체가 거짓이다: `row_moved` 는 대장 행이 그대로
# 살아 다른 `doc_id` 아래에 있으므로 **그 `new_doc_id` 위에서 같은 판단을 다시 내리면** 되지만,
# `row_replaced` 는 행도 `reviewed_by` 도 그대로인 채 그 `doc_id` 가 **담고 있는 대장 행**이 바뀐 것이라
# 다시 판단할 새 `doc_id` 자체가 없고, CM 이 먼저 알아야 할 것은 "내 판단이 붙어 있는 대상이 움직였다"는
# 사실이다. **그 승인 상태가 실제로 달라졌는지는 `approval_flipped` 만 답한다** — 개정 3 이전에는 이
# 자리에서 "지금 화면의 승인 상태는 내가 보고 판단한 그 행의 것이 아니다"라고 단정했는데, 대장이 같은 행의
# 표기를 스스로 고친 경로(V8a·V8b)와 `changed_fields` 도 비는 경로(P13b)에서 그 말은 거짓이다
# (ADR 0009 §5-3-b — `_identity_drift_clause` 의 세 갈래).
#
# **개정 2에서 셋 다 이름을 바꿨다(ADR 0009 §5-2 (마)).** 옛 이름은 전부 관측과 어긋나 있었다 —
#   `orphaned`          → `row_moved`    : 시트명 변경 경로는 `moved=8` 인데 그 행들이 **고아가 아니다**
#                                          (실측 P3 `is_orphaned=False`). 판정은 고아를 보지 않는데 이름만 고아였다.
#   `merge_overwritten` → `row_replaced` : 새 조건이 잡는 주 경로에는 **병합이 없다**(실측 R1 `merged=0`).
#                                          병합이라 적으면 CM 이 있지도 않은 충돌 묶음을 찾는다.
#   `merge_absorbed`    → `row_absorbed` : 대칭 짝도 마찬가지로 `merged=0` 에서 발화한다.
_CAUSE_ROW_MOVED = IDENTITY_DRIFT_CAUSE_ROW_MOVED          # 대장 행은 그대로인데 우리 식별 규칙이 그 행을 다른 doc_id 로 옮겼다
_CAUSE_ROW_REPLACED = IDENTITY_DRIFT_CAUSE_ROW_REPLACED    # 이 doc_id 가 담고 있던 **대장 행 자체**가 바뀌었다(행도 판단도 살아 있다)
_CAUSE_ROW_ABSORBED = IDENTITY_DRIFT_CAUSE_ROW_ABSORBED    # 판단이 가리키던 대장 행이 **다른 doc_id 아래로** 갔다
# 생산자가 `cause` 를 싣지 않았을 때 쓰는 자리표시자(정본의 `IDENTITY_DRIFT_CAUSE_UNSPECIFIED`, 소비 전용).
# **`row_moved` 로 떨어뜨리지 않는다**(ADR 0009 §Deferred 5) — 모르는 경위를 가장 흔한 경위로 적으면 이
# 함수가 고치려는 바로 그 거짓이 된다. 정본이 이 값을 `IDENTITY_DRIFT_CAUSES` 에 넣지 않는 이유도 같다.
_CAUSE_UNSPECIFIED = IDENTITY_DRIFT_CAUSE_UNSPECIFIED
# 문구에 세우는 순서 = 위험한 순서. `row_replaced` 가 맨 앞인 이유는 ADR 0009 §3 이 스스로 최악이라고
# 적은 경로("미승인 도면 위에서 착수 가능을 띄운다")가 이것뿐이기 때문이다 — 나머지 둘은 근거가 사라져
# 점수가 내려가는(보수적) 실패다.
_CAUSE_ORDER = (_CAUSE_ROW_REPLACED, _CAUSE_ROW_ABSORBED, _CAUSE_ROW_MOVED)
# `lost_decisions[].changed_fields` 가 싣는 대장 **원문** 필드 이름(생산자의 `_ROW_IDENTITY_FIELDS`) →
# CM 이 읽을 라벨. 여기 없는 이름은 그대로 적는다 — 모르는 필드를 아는 척 번역하지 않는다.
_ROW_IDENTITY_FIELD_LABELS = {"sender": "발신", "doc_number": "문서번호", "seq_raw": "번호", "title": "제목"}


def _load_document_register_config() -> dict[str, Any]:
    return load_document_register_config()


# ─────────────────────────────────────────────────────────────────────────────
# 제목 정규화·유사도 (ADR 0007 §4 규칙 1 — 필수 근거)
# ─────────────────────────────────────────────────────────────────────────────
def _normalize_title(text: str, normalize_cfg: dict[str, Any]) -> str:
    for pattern in normalize_cfg.get("strip_patterns", []):
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    strip_chars = normalize_cfg.get("strip_chars", "")
    if strip_chars:
        text = re.sub(f"[{re.escape(strip_chars)}]", " ", text)
    if normalize_cfg.get("lowercase", True):
        text = text.lower()
    if normalize_cfg.get("collapse_whitespace", True):
        text = re.sub(r"\s+", " ", text).strip()
    return text


def _title_similarity(a: str, b: str, seq_weight: float, token_weight: float) -> float:
    seq_ratio = SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    token_jaccard = (len(ta & tb) / len(ta | tb)) if (ta or tb) else 0.0
    return seq_weight * seq_ratio + token_weight * token_jaccard


# ─────────────────────────────────────────────────────────────────────────────
# 판별 토큰(ZONE·구간·차수·층) 하드 배제 (ADR 0007 §4 규칙 3)
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class _DiscriminativeToken:
    name: str
    pattern: re.Pattern[str]


def _compile_discriminative_tokens(cfg: list[dict[str, Any]]) -> list[_DiscriminativeToken]:
    return [_DiscriminativeToken(name=str(t["name"]), pattern=re.compile(str(t["pattern"]), re.IGNORECASE)) for t in cfg]


def _extract_tokens(text: str, tokens: list[_DiscriminativeToken]) -> dict[str, set[str]]:
    """토큰 name -> 정규화된 값 집합. 같은 name 이 여러 패턴(zone 은 "Z1"·"1구역" 두 패턴)에 걸릴 수 있다."""
    found: dict[str, set[str]] = {}
    for tok in tokens:
        for m in tok.pattern.finditer(text):
            value = "".join(g for g in m.groups() if g) or m.group(0)
            found.setdefault(tok.name, set()).add(re.sub(r"\s+", "", value).upper())
    return found


def _activity_text(activity: Activity) -> str:
    """판별 토큰 추출용 Activity 텍스트. 구조화 필드(level·zone)를 텍스트에 포함시켜, Activity 이름에
    층·구역이 문자로 없어도(구조화 컬럼에만 있어도) 판별 토큰 정규식이 인식하게 한다."""
    parts = [activity.name or "", activity.level or "", activity.zone or ""]
    return " ".join(p for p in parts if p)


def _discriminative_check(doc_tokens: dict[str, set[str]], act_tokens: dict[str, set[str]]) -> tuple[list[str], list[str]]:
    """returns (excluded_by, one_sided). 양쪽에 다 있고 값이 다르면 excluded_by, 한쪽에만 있으면 one_sided."""
    excluded_by: list[str] = []
    one_sided: list[str] = []
    for name in sorted(set(doc_tokens) | set(act_tokens)):
        dv, av = doc_tokens.get(name), act_tokens.get(name)
        if dv and av:
            if dv.isdisjoint(av):
                excluded_by.append(name)
        elif dv or av:
            one_sided.append(name)
    return excluded_by, one_sided


# ─────────────────────────────────────────────────────────────────────────────
# 가점 근거 (ADR 0007 §4-2 표)
# ─────────────────────────────────────────────────────────────────────────────
def _discipline_match(doc: Document, activity: Activity) -> bool:
    """공종은 신뢰 불가 필드다 — 가점만 준다(규칙 2). 불일치는 이 함수를 호출하지 않는 쪽(감점 없음)으로 이미 지켜진다."""
    if not doc.discipline_normalized or not activity.discipline:
        return False
    return str(doc.discipline_normalized).strip().lower() == str(activity.discipline).strip().lower()


def _level_match(doc_tokens: dict[str, set[str]], act_tokens: dict[str, set[str]]) -> bool:
    dv, av = doc_tokens.get("level"), act_tokens.get("level")
    return bool(dv and av and not dv.isdisjoint(av))


def _zone_match(doc_tokens: dict[str, set[str]], act_tokens: dict[str, set[str]]) -> bool:
    dv, av = doc_tokens.get("zone"), act_tokens.get("zone")
    return bool(dv and av and not dv.isdisjoint(av))


def _date_window_match(doc: Document, activity: Activity, window_days: int) -> bool:
    if not doc.issued_on or activity.planned_start is None:
        return False
    try:
        issued = date.fromisoformat(doc.issued_on[:10])
    except ValueError:
        return False
    delta = (activity.planned_start - issued).days
    return 0 <= delta <= window_days


# ─────────────────────────────────────────────────────────────────────────────
# 매핑 산출
# ─────────────────────────────────────────────────────────────────────────────
def _build_mapping(doc: Document, activity: Activity, cfg: dict[str, Any],
                   tokens_cfg: list[_DiscriminativeToken]) -> ActivityDocumentMapping | None:
    tm_cfg = cfg["title_matching"]
    weights = cfg["mapping_weights"]
    mapping_cfg = cfg["mapping"]
    normalize_cfg = tm_cfg.get("normalize", {})

    doc_text = _normalize_title(doc.title, normalize_cfg)
    act_text = _normalize_title(activity.name or "", normalize_cfg)
    similarity = _title_similarity(doc_text, act_text, float(tm_cfg["seq_weight"]), float(tm_cfg["token_weight"]))
    if similarity < float(tm_cfg["min_similarity"]):
        return None   # 규칙 1: 제목 근거 없이는 어떤 조합으로도 매핑하지 않는다

    # 판별 토큰은 원문(raw title)에서 추출한다 — normalize 가 "(Z1)" 같은 괄호를 지우지 않지만,
    # 대소문자·공백은 여기서 다시 흡수하므로 원문을 써도 안전하고, 정규화가 향후 strip_patterns 를
    # 넓혀도(예: 괄호 제거) 판별 토큰 추출이 영향받지 않도록 원문을 쓴다.
    doc_tokens = _extract_tokens(doc.title, tokens_cfg)
    act_tokens = _extract_tokens(_activity_text(activity), tokens_cfg)
    excluded_by, one_sided = _discriminative_check(doc_tokens, act_tokens)
    if excluded_by:
        return None   # 규칙 3: 판별 토큰이 양쪽에 있고 값이 다르면 유사도와 무관하게 하드 배제

    confidence = similarity * float(weights.get("title_similarity", 0.0))
    matched_rules = ["title_similarity"]
    if _level_match(doc_tokens, act_tokens):
        confidence += float(weights.get("level_match", 0.0))
        matched_rules.append("level_match")
    if _zone_match(doc_tokens, act_tokens):
        confidence += float(weights.get("zone_match", 0.0))
        matched_rules.append("zone_match")
    if _discipline_match(doc, activity):
        confidence += float(weights.get("discipline_match", 0.0))
        matched_rules.append("discipline_match")
    if _date_window_match(doc, activity, int(mapping_cfg.get("date_window_days", 90))):
        confidence += float(weights.get("date_window", 0.0))
        matched_rules.append("date_window")

    if one_sided:
        confidence *= float(tm_cfg.get("one_sided_token_penalty", 1.0))   # 규칙 3: 한쪽에만 있으면 감쇠만

    confidence = max(0.0, min(1.0, confidence))
    if confidence < float(mapping_cfg["min_confidence_to_propose"]):
        return None   # 규칙 4: 후보 하한 미만이면 행을 만들지 않는다

    evidence = Evidence(
        source_type="document", source_id=doc.doc_id, method="document_title_match", note=doc.title,
        extra={"title_similarity": similarity, "matched_rules": matched_rules, "excluded_by": excluded_by,
               "one_sided_tokens": one_sided, "discipline_trusted": False, "activity_id": activity.activity_id},
    )
    # ActivityDocumentMapping 모델이 needs_review=True 를 항상 강제한다(규칙 5) — 여기서 별도로 설정하지 않는다.
    return ActivityDocumentMapping(activity_id=activity.activity_id, doc_id=doc.doc_id,
                                   confidence=confidence, evidence=evidence)


def map_documents_to_activities(documents: Sequence[Document], activities: Sequence[Activity],
                                cfg: dict[str, Any] | None = None) -> list[ActivityDocumentMapping]:
    """순수 함수. Activity 하나당 confidence 내림차순 상위 `mapping.max_candidates_per_activity` 개만 남긴다.

    고아 문서(`is_orphaned=True`)는 후보로 만들지 않는다 — 최근 대장에 없는 문서를 새로 매핑 제안하는
    것은 CM 검토 큐만 오염시킨다.
    """
    cfg = cfg or _load_document_register_config()
    tokens_cfg = _compile_discriminative_tokens(cfg["title_matching"].get("discriminative_tokens", []))
    max_candidates = int(cfg.get("mapping", {}).get("max_candidates_per_activity", 5))
    live_documents = [d for d in documents if not d.is_orphaned]

    results: list[ActivityDocumentMapping] = []
    for activity in activities:
        candidates = [m for doc in live_documents if (m := _build_mapping(doc, activity, cfg, tokens_cfg)) is not None]
        candidates.sort(key=lambda m: m.confidence, reverse=True)
        results.extend(candidates[:max_candidates])
    return results


# ─────────────────────────────────────────────────────────────────────────────
# document_mapping ReviewRequest 생명주기 (ADR 0007 §4 규칙 6, CLAUDE.md §3 규칙 11 — 생성·해소는
# services/progress 소유. API 는 아래 공개 함수를 호출만 한다.)
#
# 8차 리뷰 REJECT 사유: needs_review=True 매핑이 쌓여도 이 kind 의 ReviewRequest 를 만드는 코드가
# 저장소 어디에도 없었다 — CM 검토 큐가 영원히 비어 있었고 어떤 테스트도 실패하지 않았다.
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class DocumentMappingSyncResult:
    """`map_project_documents` 의 반환값. `ObjectStateMachine.TransitionResult`(state_machine.py)와 같은
    패턴 — 무엇을 만들고 무엇을 닫았는지 호출자(api)에게 그대로 알린다."""
    mappings: list[ActivityDocumentMapping]
    created_review_ids: list[str] = field(default_factory=list)   # 새로 만든 document_mapping 검토요청
    closed_review_ids: list[str] = field(default_factory=list)    # 문서가 고아가 되어 자동으로 닫힌 검토요청
    reopened_review_ids: list[str] = field(default_factory=list)  # 확정 근거가 재계산에서 무너져 다시 연 검토요청(9차 리뷰)
    warnings: list[dict[str, Any]] = field(default_factory=list)  # JobRow.warnings 에 그대로 append 가능(과제 2)


def _document_mapping_review_title(mapping: ActivityDocumentMapping, doc: Document | None) -> str:
    label = f"{doc.doc_number or doc.doc_id} «{doc.title}»" if doc is not None else mapping.doc_id
    return f"문서 매핑 확인: Activity {mapping.activity_id} → {label} (confidence {mapping.confidence:.2f})"


def _document_mapping_review(mapping: ActivityDocumentMapping, project_id: str, doc: Document | None) -> ReviewRequest:
    """ADR 0007 §4 규칙 6·7. `conflicting_sources`에 `drawing_id`/`entity_handle`을 절대 넣지 않는다 —
    `services/sync/review_queue.resolve_mapping_review`가 그 키를 다른 구조로 기대해 `mapping_review_data_corrupt`
    로 깨진다. 여기서는 중복 생성 조회(§4 규칙 6 "중복 생성 금지")를 위한 `doc_id`만 싣는다. evidence 는
    매핑이 이미 가진 것(source_type="document")을 그대로 쓴다 — CLAUDE.md §3 규칙 3."""
    return ReviewRequest(
        project_id=project_id, kind="document_mapping", activity_id=mapping.activity_id, global_id=None,
        title=_document_mapping_review_title(mapping, doc), conflicting_sources={"doc_id": mapping.doc_id},
        confidence=mapping.confidence, evidence=mapping.evidence, assignee_role="cm",
    )


def is_rejected_mapping(evidence: dict[str, Any] | None) -> bool:
    """`row.evidence`(JSON dict)에 `reject_document_mapping`이 남긴 반려 표시가 있는지 본다.

    **공개 함수다(10차 리뷰).** "reviewed_by 만으로 확정을 판별하지 마라"는 §4-2 규칙 6 ⑥의 불변식은
    이 모듈 밖에서도 지켜져야 하므로(services/api 의 확정 거절, apps/web 의 배지 — domain/mappingReview.ts)
    판정을 여기 한 곳이 소유한다. 키 문자열을 호출자가 직접 읽지 말고 이 함수를 쓸 것.

    확정(`_confirm_document_mapping_row`, api 소유)은 이 키를 절대 쓰지 않으므로, `reviewed_by is not None`
    이면서 이 함수가 `False`를 돌려주면 확정된 매핑이고 `True`를 돌려주면 반려된 매핑이다 — 같은
    `reviewed_by` 필드를 "누가 이 매핑을 검토했는가"로 공유하고, 승인/반려 어느 쪽인지는 evidence 로
    구분한다(§4-2 규칙 6·7과 같은 결의 확장 — evidence 는 감사 기록이지 상태 저장소가 아니라고 했지만,
    반려 사유 자체가 감사해야 할 근거이므로 여기 남기는 것이 자연스럽다)."""
    return bool((evidence or {}).get("extra", {}).get("mapping_review_decision") == _MAPPING_REVIEW_DECISION_REJECTED)


def _drop_already_confirmed(session: Session, project_id: str,
                            mappings: Sequence[ActivityDocumentMapping]) -> list[ActivityDocumentMapping]:
    """재계산된 후보 중, 이미 사람이 판단한(`reviewed_by is not None` — 확정이든 반려든) 기존 매핑 행이
    있으면 제외한다.

    `map_documents_to_activities`는 순수 함수라 매번 `needs_review=True`인 새 후보를 만든다(§4 규칙 5) —
    그걸 그대로 upsert 하면 대장 재업로드가 CM 이 이미 확정한 매핑을 조용히 다시 미확정으로 되돌리고,
    방금 닫은 document_mapping 검토요청까지 재생성하게 된다. 확정은 사람의 행위이고 시스템 재계산이
    되돌려서는 안 된다 — ADR 0001 불변식 2("CONFIRMED 에서 나가는 전이도 cm만")와 같은 구조다.

    **반려도 같은 이유로 여기서 걸러진다(10차 리뷰 후속, `reject_document_mapping` 참고).**
    `reject_document_mapping`이 반려된 행에도 `reviewed_by`를 채우므로 이 조건이 그대로 적용된다 —
    "CM 이 이미 이 (activity_id, doc_id) 쌍을 판단했다"는 확정이든 반려든 시스템 재계산이 뒤집어서는
    안 되는 같은 종류의 사람의 결정이기 때문이다. 별도 분기를 두지 않는다.

    **`project_id` 는 필수다(ADR 0008 규칙 4 — ADR 0007 §Deferred 해소 지점).** 전역 `(activity_id, doc_id)`
    로 읽던 시절, p1 에서 CM 이 확정·반려한 쌍이 p2 의 후보 생성을 그대로 막았다(실측: p2 의
    `mapping_count` 가 6 대신 3). 사람의 판단은 그 프로젝트 안에서만 유효하다."""
    kept: list[ActivityDocumentMapping] = []
    for m in mappings:
        existing = session.get(ActivityDocumentMappingRow, (project_id, m.activity_id, m.doc_id))
        if existing is not None and existing.reviewed_by is not None:
            continue
        kept.append(m)
    return kept


def _activity_signature(activity: Activity) -> str:
    """확정 매핑을 무효화할 수 있는 Activity 쪽 입력의 스냅샷. `_build_mapping`이 판정에 실제로 쓰는
    필드만 담는다(name/level/zone → 판별 토큰·유사도, discipline → 가점, planned_start → date_window).
    문서 쪽은 여기 넣지 않는다 — `doc_id`가 title/sender/seq 의 해시라(§2-1) 그 셋이 바뀌면 다른 doc_id가
    되고, 그러면 원래 문서는 고아가 되어 `_close_reviews_for_orphaned_documents`가 이미 처리한다."""
    planned = activity.planned_start.isoformat() if activity.planned_start else ""
    return "|".join([activity.name or "", activity.level or "", activity.zone or "", activity.discipline or "", planned])


def _reconfirmation_review_title(mapping_row: ActivityDocumentMappingRow, doc: Document | None) -> str:
    label = f"{doc.doc_number or doc.doc_id} «{doc.title}»" if doc is not None else mapping_row.doc_id
    return (f"문서 매핑 재확인 필요: Activity {mapping_row.activity_id} → {label} — 확정 이후 Activity 정보가 "
            "바뀌어 재계산이 더 이상 이 매핑을 지지하지 않습니다(판별 토큰 불일치 등). 재계산이 매핑을 "
            "되돌리지는 않았지만 CM 재확인이 필요합니다.")


def _reopen_reviews_for_invalidated_confirmations(
    session: Session, project_id: str, documents: Sequence[Document], activities: Sequence[Activity],
    cfg: dict[str, Any], tokens_cfg: list[_DiscriminativeToken],
) -> list[str]:
    """9차 리뷰 REJECT 후속. `_drop_already_confirmed`는 재계산 후보에 없는 확정 매핑을 그대로
    보존한다 — 확정은 사람의 행위이고 시스템이 되돌려서는 안 되므로 그 자체는 옳다. 하지만 침묵하는
    것은 다른 문제다: Activity 가 재업로드로 바뀌어(예: "1F 기둥…" → "9F 기둥…") 판별 토큰이 더는
    맞지 않으면(ADR 0007 §4 규칙 3 — 유사도와 무관한 하드 배제) 확정 행은 아무 신호 없이 남아
    `drawing_approval`을 계속 채운다.

    되돌리지 않고 CM 에게 넘긴다: 확정된 (activity_id, doc_id) 쌍마다 `_build_mapping`(후보 생성과
    100% 같은 판정 로직)을 다시 돌려, 더 이상 후보가 아니면 이미 `approved`로 닫힌 document_mapping
    검토요청을 다시 `open`으로 되돌린다. 매핑 행 자체(`confidence`/`reviewed_by`/`needs_review`)는
    건드리지 않는다 — 되돌리는 게 아니라 CM 이 다시 보게 하는 것이 목적이다.

    **무한 재생성 방지**: 재오픈할 때 이번에 무효화를 유발한 Activity 상태의 스냅샷
    (`_activity_signature`)을 검토요청 evidence 에 `extra.invalidated_activity_signature`로 남긴다.
    다음 실행에서 같은 쌍이 여전히 무효(재실행이 흔히 그렇다 — 재업로드된 공정표는 매번 같은 값)여도,
    검토요청이 이미 `open`이면 그대로 두고(재생성 없음), CM 이 처리해 `open`이 아니게 된 뒤에는
    스냅샷이 그대로인 한 다시 열지 않는다(CM 의 결정이 유지된다) — Activity 가 **다시** 바뀌어 스냅샷이
    달라질 때만 새로운 신호로 보고 또 연다. `open_document_mapping_review`(status="open" 고정)가 아니라
    상태 무관 `find_document_mapping_review`를 쓰는 이유가 이것이다."""
    docs_by_id = {d.doc_id: d for d in documents}
    acts_by_id = {a.activity_id: a for a in activities}
    reopened: list[str] = []
    for row in db.document_mappings_for_project(session, project_id):
        if row.reviewed_by is None:
            continue   # 확정된 매핑만 대상 — 미확정은 재계산이 그대로 덮어쓰므로 여기서 다룰 대상이 아니다
        if is_rejected_mapping(row.evidence):
            # 반려된 매핑은 대상이 아니다(10차 리뷰 후속). CM 은 이미 "이 문서는 이 Activity 와 무관하다"고
            # 판단했고, Activity 정보가 바뀐다고 그 판단의 근거가 흔들리지 않는다 — 확정과 달리 반려는
            # readiness/검증 어디에도 "증거"로 쓰이지 않으므로(§ confirmed_required_documents 필터), 낡은
            # 반려를 되돌리지 않는 것과 같은 무게로 "재확인이 필요한 낡은 근거"도 없다. 여기서 되살리면
            # CM 이 이미 반려한 항목이 "재확인 필요" 검토요청으로 큐에 다시 나타나 이번 과제가 고치려는
            # 문제(반려한 매핑이 되살아난다)를 검토요청 쪽에서 재현하게 된다.
            continue
        doc = docs_by_id.get(row.doc_id)
        activity = acts_by_id.get(row.activity_id)
        if doc is None or activity is None or doc.is_orphaned:
            continue   # 문서·Activity 가 사라졌으면 다른 경로(orphan 자동 종료) 또는 이번 라운드 범위 밖
        if _build_mapping(doc, activity, cfg, tokens_cfg) is not None:
            continue   # 현재 규칙으로도 여전히 유효한 매핑 — 조용히 두는 것이 맞다

        signature = _activity_signature(activity)
        review = db.find_document_mapping_review(session, project_id, row.activity_id, row.doc_id)
        if review is not None:
            already_flagged_this_state = (review.evidence or {}).get("extra", {}).get(
                "invalidated_activity_signature") == signature
            if review.status == "open" or already_flagged_this_state:
                continue   # 이미 열려 있거나(중복 생성 금지), CM 이 이 상태로 이미 처리했다(무한 재생성 금지)
            review.status = "open"
            review.resolved_by = None
            review.resolved_at = None
            review.resolution_note = None
        else:
            mapping_model = db.document_mapping_row_to_model(row)
            review_model = _document_mapping_review(mapping_model, project_id, doc)
            review_model.title = _reconfirmation_review_title(row, doc)
            review = db.save_review_request(session, review_model)

        review.title = _reconfirmation_review_title(row, doc)
        review.confidence = row.confidence
        evidence = dict(row.evidence or {})
        evidence["extra"] = {**evidence.get("extra", {}), "invalidated_activity_signature": signature,
                             "invalidation_reason": "confirmed_mapping_no_longer_a_recompute_candidate"}
        review.evidence = evidence
        reopened.append(review.review_request_id)
    if reopened:
        session.flush()
    return reopened


def _sync_pending_document_mapping_reviews(session: Session, project_id: str,
                                           mappings: Sequence[ActivityDocumentMapping],
                                           docs_by_id: dict[str, Document]) -> list[str]:
    """`needs_review=True`인 매핑마다 열린 document_mapping 검토요청이 없으면 만든다.

    **중복 생성 금지**(과제 1 규칙 2): 대장을 매주 재업로드하면 `map_project_documents`가 다시 돌고
    같은 (activity_id, doc_id) 후보가 또 나올 수 있다 — 이미 열린 검토요청이 있으면 새로 만들지 않고
    confidence·evidence·title 만 최신 값으로 갱신한다(재업로드로 근거가 바뀌었을 수 있으므로)."""
    created: list[str] = []
    for m in mappings:
        if not m.needs_review:
            continue
        existing = db.open_document_mapping_review(session, project_id, m.activity_id, m.doc_id)
        if existing is not None:
            existing.confidence = m.confidence
            existing.evidence = m.evidence.model_dump(mode="json")
            existing.title = _document_mapping_review_title(m, docs_by_id.get(m.doc_id))
            continue
        review = _document_mapping_review(m, project_id, docs_by_id.get(m.doc_id))
        db.save_review_request(session, review)
        created.append(str(review.review_request_id))
    return created


def _close_reviews_for_orphaned_documents(session: Session, project_id: str) -> list[str]:
    """과제 1 규칙 4: 매핑이 가리키는 문서가 고아가 됐거나(최근 대장에서 사라짐) 아예 없어졌으면 그
    document_mapping 검토요청을 닫는다 — 없어진 문서를 확정하라고 CM 에게 남겨두지 않는다.

    `status="on_hold"`를 쓴다: `approved`/`rejected`는 사람(cm)의 판단이어야 하고(ADR 0001 §6·CLAUDE.md
    §3 규칙 7 — 전이는 actor·evidence 필수), 이건 시스템이 "이 요청이 더 이상 유효하지 않다"고 닫는
    것이라 `resolved_by`도 채우지 않는다(ADR 0001 §6: "시스템은 대체된 요청을 on_hold로 바꿀 수만 있다").
    매핑 행 자체는 손대지 않는다(ADR 0007 §2-2 규칙 3: 고아 문서도 매핑·이력은 유지)."""
    closed: list[str] = []
    now = datetime.now(UTC)
    for row in db.open_reviews(session, project_id, kind="document_mapping"):
        doc_id = (row.conflicting_sources or {}).get("doc_id")
        doc = db.load_document(session, project_id, str(doc_id)) if doc_id else None
        if doc is not None and not doc.is_orphaned:
            continue   # 문서가 살아 있으면 그대로 둔다
        row.status = "on_hold"
        row.resolved_at = now
        row.resolution_note = (f"document {doc_id!r} is orphaned or no longer in the register — "
                               "closed automatically, nothing for cm to confirm")
        closed.append(row.review_request_id)
    if closed:
        session.flush()
    return closed


def close_document_mapping_review(session: Session, project_id: str, activity_id: str, doc_id: str,
                                  resolved_by: str, note: str | None = None) -> list[str]:
    """과제 1 규칙 3: 매핑이 확정(`needs_review=False`)되면 그 document_mapping 검토요청을 닫는다.

    CLAUDE.md §3 규칙 11: 검토요청 해소는 `services/progress` 소유. `services/api/usecases.py`의
    `confirm_document_mapping`이 매핑을 저장한 뒤 **이 함수를 호출해야 한다** —
    `state_machine.close_inspection_reviews`와 같은 패턴(호출자는 사람 확정 사실만 넘긴다)."""
    row = db.open_document_mapping_review(session, project_id, activity_id, doc_id)
    if row is None:
        return []
    row.status = "approved"
    row.resolved_by = resolved_by
    row.resolved_at = datetime.now(UTC)
    row.resolution_note = note or f"mapping confirmed by {resolved_by}"
    session.flush()
    return [row.review_request_id]


def reject_document_mapping(session: Session, project_id: str, activity_id: str, doc_id: str,
                            rejected_by: str, note: str | None = None) -> None:
    """CM 이 이 문서↔Activity 매핑 후보를 반려했다(10차 리뷰 후속). 대응 `document_mapping`
    ReviewRequest 는 이미 api 가 `status="rejected"`로 닫아 두었다는 전제로, 여기서는 매핑 행만 다룬다.

    **행을 삭제하지 않는다**(ADR §4-2 규칙 7과 같은 이유 — 나중에 "왜 반려됐는가" 감사가 필요하다).
    `ActivityDocumentMappingRow.reviewed_by`를 `rejected_by`로 채워 "사람이 이미 이 쌍을 판단했다"는
    사실을 확정과 같은 필드로 남기고(§4 규칙 5의 `needs_review=(reviewed_by is None)` 불변식과
    호환되므로 `needs_review`도 자연히 `False`가 된다 — 더는 CM 검토 큐의 "대기" 항목이 아니다),
    `evidence.extra.mapping_review_decision="rejected"`로 확정과 구분한다. `evidence.source_type`/
    `.method`는 시스템이 제안했을 때의 값(`document`/`document_title_match`)을 그대로 두고 `note`만
    반려 코멘트로 갱신한다 — `_confirm_document_mapping_row`(services/api/usecases.py)와 같은 관례다.

    **`map_project_documents`의 재계산이 이 쌍을 다시 만들지 않는다**: `_drop_already_confirmed`가
    `reviewed_by is not None`이면 후보를 버리므로(확정·반려 구분 없이), 대장·공정표를 몇 번 재업로드해도
    이 (activity_id, doc_id) 매핑 행도 `document_mapping` 검토요청도 재생성되지 않는다. 또한
    `confirmed_required_documents`가 `evidence.extra.mapping_review_decision` 로 반려된 행을 걸러내므로
    반려된 매핑은 readiness `drawing_approval`·3중 검증 `logic` 축 어디에도 증거로 들어가지 않는다.

    **반려는 (activity_id, doc_id) 쌍에 대해 영구하다 — Activity 쪽 정보가 바뀌어도 되돌리지 않는다.**
    확정 매핑은 Activity 가 바뀌면 재확인 검토요청을 다시 연다(`_reopen_reviews_for_invalidated_confirmations`)
    — 확정은 "이 문서가 이 Activity 의 착수 가능 판단에 쓰일 증거"이므로, 그 근거가 흔들리는데 침묵하면
    낡은 증거가 계속 AND 조건을 채운다(안전 문제). 반려는 반대다 — 반려된 매핑은 애초에 증거로 쓰이지
    않으므로(위 문단) Activity 가 바뀌어도 "낡은 증거가 착수 가능 판단을 오염시키는" 위험이 없다. CM 의
    "이 문서는 이 작업과 무관하다"는 판단은 Activity 이름·층·구역이 다시 표기돼도 뒤집힐 이유가 없는
    사람의 결정이고, 여기서 자동으로 되살리면 이번에 고치는 문제(반려한 매핑이 되살아난다)를 검토요청
    쪽에서 그대로 재현하게 된다 — 그래서 `_reopen_reviews_for_invalidated_confirmations`도 반려된 행은
    건드리지 않도록 걸러 두었다.

    **문서 쪽이 바뀌면(제목 수정 등) 다르다 — 이건 자동으로 이미 대칭이다.** `doc_id`는 title 을 재료로 한
    결정적 해시(ADR §2-1)이므로 문서 제목이 바뀌면 `doc_id`가 바뀌어 **다른 문서**가 된다. 반려는
    `(activity_id, doc_id)` 쌍에 매달려 있으므로 새 `doc_id`는 반려 표시가 전혀 없는 완전히 새 매핑
    후보로 취급된다 — 별도 코드 없이 키 설계에서 이미 그렇게 동작한다.

    대상 매핑 행이 이 프로젝트에 없으면 `LookupError`(호출자 사전조건 위반 — api 가 이미 존재를
    확인했어야 한다, `save_document_mapping`과 같은 관례). ADR 0008 이후 키 자체가
    `(project_id, activity_id, doc_id)` 이므로 별도의 `row.project_id != project_id` 방어는 중복이라 없앴다."""
    row = session.get(ActivityDocumentMappingRow, (project_id, activity_id, doc_id))
    if row is None:
        raise LookupError(f"document mapping not found: activity_id={activity_id!r} doc_id={doc_id!r} "
                          f"in project {project_id!r}")
    before = Evidence(**row.evidence)
    extra = {**before.extra, "mapping_review_decision": _MAPPING_REVIEW_DECISION_REJECTED,
            "rejected_by": rejected_by, "rejected_at": datetime.now(UTC).isoformat()}
    if note:
        extra["rejection_note"] = note
    evidence = before.model_copy(update={"note": note or before.note, "extra": extra})
    row.evidence = evidence.model_dump(mode="json")
    row.reviewed_by = rejected_by
    row.needs_review = False
    session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# 식별 드리프트 검토요청 (ADR 0009 §5-2·§5-3)
#
# 동결할 수 없는 식별 표면(`sender_aliases`·`sheet_doc_types`·`column_aliases`)이 바뀌면 대장 원문이
# 그대로여도 `doc_id` 가 움직이고, CM 이 확정·반려한 매핑이 오염된다 — 판단이 가리키던 행이 **고아가 되어
# 증거로서 사라지거나**(readiness 의 `confirmed_required_documents` 가 고아를 제외한다), 서로 다른 대장
# 행이 한 `doc_id` 로 병합돼 **행은 살아 있는데 그 안의 승인 상태가 다른 행으로 바뀐다**(이쪽이 더
# 위험하다 — ADR 0009 §3 (나): 미승인 도면 위에서 착수 가능이 뜬다). 막을 수는 없으니
# 알아채게 한다 — 그리고 알아채는 자리는 job 경고가 아니라 **사람의 큐**여야 한다(8차 리뷰: 아무도
# 만들지 않는 검토요청 때문에 CM 큐가 영원히 비어 있었고 어떤 테스트도 실패하지 않았다).
# ─────────────────────────────────────────────────────────────────────────────
# `IdentityDriftCause` 는 `packages/core/models/review` 에서 import 해 그대로 재수출한다(파일 상단 import,
# `__all__` 에 이름이 남아 있다). 이 모듈은 그 Literal 을 다시 적지 않는다 — 이 파일이 기대는 **부재**는
# **주석 밖에서 경위 값을 문자열로 적는 코드 줄이 이 파일에 하나도 없다**는 것이고, 실행으로 확인하는
# 명령은 아래다(기대 히트 0). 주석·docstring 은 옛 이름과 개명 근거를 의도적으로 인용하므로
# `^[^#]*` 로 주석 줄을 뺀다 — 빼지 않으면 이 문단 자신이 히트한다(실측: 뺄 때 0, 안 뺄 때 1).
#     grep -nE '^[^#]*(= *"row_|Literal\[ *"row_|= *"unspecified")' services/progress/document_mapper.py
# 그 부재가 깨지면 정본과 갈라져도 mypy·pytest 가 침묵한다.
# 이 Literal 은 **생산 시점 계약**을 적는 데에만 쓴다 — `LostDecision.cause` 를 이것으로 좁히지 **않는**
# 이유가 바로 그것이다(아래).


class LostDecision(TypedDict):
    """`IdentityDriftReport.lost_decisions[]` 항목 계약(ADR 0009 §5-2 (마), 계획 0003 §12-d).

    필드 넷(`cause`·`new_doc_id`·`changed_fields`·`approval_flipped`)이 있는 이유는 하나다:
    **문구가 아는 것만 말하게 하기 위해서**(CLAUDE.md §6-4 규칙 2 — 소비자가 산문을 되읽어 분류하지
    않는다). 이 셋이 없던 개정 1 의 제목은 병합 경로에서 세 군데가 거짓이었다(ADR 0009 §5-4).

    **`cause` 를 `IdentityDriftCause` 로 좁히지 않는다.** 생산자가 새 경위를 추가했는데 이 모듈이
    따라오지 못한 경우, 좁은 타입은 pydantic 검증에서 항목을 통째로 튕겨 **적재 job 을 실패시키거나
    사건을 삼킨다**. 그 대신 `_identity_drift_clause` 가 모르는 값을 "설명할 수 없는 경위"로 적어
    내보낸다 — 모르는 것을 `row_moved` 로 떨어뜨리는 폴백은 금지다(ADR 0009 §Deferred 5).
    """

    activity_id: str
    doc_id: str
    decision: Literal["confirmed", "rejected"]
    cause: str                      # `IdentityDriftCause` 중 하나. 모르는 값은 그대로 두고 `unspecified` 로 표시
    new_doc_id: str | None          # None = 다시 판단할 곳이 **없다**(row_replaced). "모른다"가 아니다
    changed_fields: list[str]       # 달라진 행-정체 필드(sender | doc_number | seq_raw | title). (나-ii)면 []
    approval_flipped: bool          # 이번 적재에서 approval_status 가 달라졌는가(row_moved/row_absorbed 는 언제나 False)


class IdentityDriftReport(BaseModel):
    """한 번의 대장 적재에서 관찰된 식별 드리프트(ADR 0009 §5-2). **판정은 적재 쪽이 소유한다** —
    `services/ingest/persistence.persist_document_register_import` 가 재업로드 규칙(ADR 0007 §2-2)을
    이미 소유하므로 고아 ↔ 신규 쌍도, 한 `doc_id` 로 수렴한 병합 묶음도 아는 것은 그쪽이다. 이 모듈은 그
    관찰을 받아 검토요청으로만 바꾼다.

    **이 타입이 `services/progress` 에 있는 이유**(계획 0003 §3-e 는 `services/ingest/persistence.py` 에
    두라고 적었다): 의존 방향이다. `services/ingest/persistence.py` 는 이미
    `services.progress.importers.document_register` 를 import 하고 있고, 반대 방향을 추가하면 두 서비스가
    서로를 import 하게 된다(게다가 `services.ingest.__init__` 가 IFC/DXF 파서를 끌고 오므로 매핑 모듈이
    파서 의존성을 지게 된다). 소비자(이 함수)가 타입을 소유하고 생산자가 import 하는 쪽이 기존 방향과
    같다 — `is_rejected_mapping` 을 ingest 가 import 해 쓰는 것과 같은 구조다.
    """

    previous_fingerprint: str | None = None   # 이번 적재에 없던 기존 행들의 최빈 지문(첫 적재면 None)
    current_fingerprint: str = ""             # 이번 적재의 `identity_surface_fingerprint`
    file_id: str = ""                         # 드리프트를 드러낸 대장 업로드(evidence.source_id)
    moved: list[dict[str, str]] = Field(default_factory=list)        # {"previous_doc_id","new_doc_id","title"} — title 원문이 같은 쌍
    merged: list[dict[str, Any]] = Field(default_factory=list)       # {"doc_id","titles":[...]} — 한 doc_id 로 수렴한 서로 다른 행
    # 이번 적재가 오염시킨 사람의 판단(ADR 0009 §5-2 (마) 항목 계약 = `LostDecision`).
    #
    # 계획 0003 §12-d 대로 `LostDecision` TypedDict 를 쓴다 — bim-ingest 가 개정 2 구현 중 임시로
    # `dict[str, str]` → `dict[str, Any]` 로 넓혀 둔 자리를 여기서 회수한다(넓힌 이유 자체는 옳았다:
    # 안 넓히면 `new_doc_id=None`·`changed_fields=[…]`·`approval_flipped=bool` 이 pydantic 검증에서
    # 튕겨 **대장 적재 job 자체가 실패**한다). `Any` 로 두면 생산자의 필드 오타가 조용히 통과하고,
    # 조용히 통과한 오타는 `cause` 가 사라진 항목 → `unspecified` 문구로만 드러난다.
    lost_decisions: list[LostDecision] = Field(default_factory=list)


def _decision_counts(lost: Sequence[LostDecision]) -> tuple[int, int, int]:
    """(전체, 확정, 반려). 반려 표시는 `_MAPPING_REVIEW_DECISION_REJECTED` 하나뿐이고 나머지(값이 없는 경우
    포함)는 확정이다 — `_lost_decisions` 가 `is_rejected_mapping()` 으로 이미 가른 값을 그대로 센다."""
    rejected = sum(1 for d in lost if d.get("decision") == _MAPPING_REVIEW_DECISION_REJECTED)
    return len(lost), len(lost) - rejected, rejected


def _particle(word: str, after_batchim: str, after_vowel: str) -> str:
    """앞말의 **받침 유무**로 조사를 고른다(`이/가`, `은/는`, `을/를`, `과/와`).

    이 모듈이 조사를 붙이는 값은 둘 다 **런타임에 갈린다**. ① `changed_fields` 라벨 —
    `발신`(받침 O) · `제목`(받침 O) · `번호`(받침 X) · `문서번호`(받침 X)로 갈리므로 조사를 문자열에
    고정하면 절반이 틀린다(실측: "발신가 달라졌습니다"). ② `changed_fields` 가 빈 `row_replaced` 절이
    값에서 유도하는 행-내용 라벨(`처리결과 표기` · `승인 상태` · 둘 다). 지금은 셋 다 받침이 없지만
    라벨이 바뀌면 같은 자리에서 같은 실수가 나므로 이 함수를 태운다. 고정 명사에 붙은 조사
    (`…건이`, `…건은`)는 앞말이 늘 `건`이라 이미 맞으므로 태우지 않는다.

    한글 음절 범위(가~힣) 밖이면 **받침이 있는 쪽**을 쓴다. 그 자리에 오는 값은 생산자가 우리가 모르는
    필드 이름을 원문 그대로 실어 보낸 경우(예: `result_raw`)뿐이고, 그때는 라벨을 아는 척 번역하지
    않는다는 규칙(`_ROW_IDENTITY_FIELD_LABELS`)과 짝을 이뤄 조사도 한쪽으로 고정하는 편이 낫다."""
    if not word:
        return after_batchim
    last = word[-1]
    if "가" <= last <= "힣":
        return after_batchim if (ord(last) - 0xAC00) % 28 else after_vowel
    return after_batchim


def _changed_field_labels(lost: Sequence[LostDecision]) -> str:
    """이 경위 묶음에서 실제로 달라진 행-정체 필드를 CM 라벨로 나열한다(생산자가 실은 순서 그대로).

    이 값이 있어야 CM 이 "다른 문서로 바뀐 것"과 "대장이 문서번호 오타를 고친 것"을 **한 줄 안에서**
    가른다. ADR 0009 §5-2 (바)는 후자(P6·P7)를 오탐인 채로 두기로 했고, 그 판단이 성립하는 근거가
    바로 이 필드다 — 시스템이 구별할 수 없으니 **관측한 사실만 적고 판단은 CM 에게 넘긴다.**"""
    labels: list[str] = []
    for item in lost:
        for name in item.get("changed_fields") or []:
            label = _ROW_IDENTITY_FIELD_LABELS.get(name, name)
            if label not in labels:
                labels.append(label)
    return "·".join(labels)


def _redecide_verb(lost: Sequence[LostDecision]) -> str:
    """다시 내려야 할 판단의 종류를 **오염된 판단 그대로** 적는다.

    한정어 역방향 확인 — "다시 **확정**하십시오"는 이 묶음에 반려가 섞이면 거짓이다(CM 이 반려한 것을
    확정하라고 시키는 말이 된다). 반대로 늘 "다시 판단"으로만 적으면 CM 이 무엇을 다시 해야 하는지
    잃는다. 그래서 값(확정/반려 건수)에서 유도한다."""
    _, confirmed, rejected = _decision_counts(lost)
    if confirmed and rejected:
        return "다시 확정·반려"
    return "다시 반려" if rejected else "다시 확정"


def _identity_drift_clause(cause: str, lost: Sequence[LostDecision], drift: IdentityDriftReport) -> str:
    """한 경위에 대해 **그 경위에서만 참인** 사실을 쓴다(CLAUDE.md §6-4). 건수는 이 경위의 몫만 센다.

    쓰는 재료는 그 경위가 실제로 싣는 값뿐이다 — `row_moved` 는 `new_doc_id`(있다)와 `drift.moved`,
    `row_replaced` 는 `changed_fields`·`approval_flipped`(그리고 `new_doc_id` 가 없다는 사실),
    `row_absorbed` 는 `new_doc_id`. **어느 절에도 "고아"·"병합"은 쓰지 않는다**(ADR 0009 §5-3 개정 2):
    판정이 둘 다 보지 않으므로 문구가 알 수 없는 말이다. 시트명 변경 경로는 `moved=8` 인데
    `is_orphaned=False` 이고(P3), `row_replaced` 의 주 경로는 `merged=0` 이다(R1)."""
    total, confirmed, rejected = _decision_counts(lost)
    counted = f"CM 판단 {total}건(확정 {confirmed} · 반려 {rejected})"
    documents = len({d["doc_id"] for d in lost})   # 한 문서에 여러 Activity 매핑이 걸릴 수 있다

    if cause == _CAUSE_ROW_REPLACED:
        # 한정어 역방향 확인 — 이 절에는 "내용도 함께 바뀌었을 때만" 같은 한정어를 두지 않는다. 그 단어를
        # 넣으면 승인 상태가 **우연히 같은** 다른 행으로 바뀐 경우가 문구 밖으로 나가고, 그때도 CM 의
        # 확정은 자기가 보지 않은 도면에 붙어 있다(ADR 0009 §5-2 (바) P6·P7 판단 2). `approval_flipped`
        # 는 발화를 가르지 않고 **문장의 순서와 표현만** 가른다(아래 세 갈래 — ADR 0009 §5-3-b).
        parts: list[str] = []
        flipped = {d["doc_id"] for d in lost if d["approval_flipped"]}
        if flipped:
            # 역방향 확인 — 이 조건을 없애고 늘 붙이면 뒤집히지 않은 적재에 거짓이 붙는다. 반대로 이것을
            # 발화 게이트로 쓰면 위 P6·P7 이 표 밖으로 나간다. 그래서 **맨 앞에 세우기만** 한다:
            # CM 이 미승인 도면 위에서 착수 가능을 보고 있을 수 있다는 사실이 가장 먼저 와야 한다.
            parts.append(f"도면 승인 근거가 뒤집혔습니다 — 문서 {len(flipped)}건의 승인 상태가 "
                         "이번 적재에 달라졌습니다")
        fields = _changed_field_labels(lost)
        if fields:
            # 조사는 라벨의 받침에서 유도한다 — `발신`·`제목`은 `이`, `번호`·`문서번호`는 `가`.
            parts.append(f"CM 이 판단한 문서 {documents}건이 담고 있던 대장 행이 바뀌었습니다"
                         f"({fields}{_particle(fields, '이', '가')} 달라졌습니다)")
        else:
            # 역방향 확인 — `changed_fields` 가 비면 대장 원문 네 필드는 그대로다(ADR 0009 §5-2 (나-ii)로만
            # 걸린 경우). 그때 "다른 대장 행으로 바뀌었다"고 적으면 관측하지 못한 것을 단정하는 것이다.
            # **무엇이 달라졌는지도 값에서 읽는다**(ADR 0009 §5-3-b 곁가지 관찰). (나-ii)는 행-내용
            # `(result_raw, approval_status)` 중 **어느 한쪽**만 달라져도 발화하므로, 늘 "처리결과·승인
            # 상태"라고 적으면 승인 상태가 그대로인 적재에서 CM 은 자기 승인 근거가 움직였다고 읽는다
            # (실측 P13b: 행-정체가 같은 두 행의 처리결과가 `반려`/`부적합` — 둘 다 `REJECTED` 라
            # `approval_flipped=False`). 이 분기의 전제상 원문 네 필드는 그대로이므로, 뒤집히지 않은
            # 항목에서 달라질 수 있는 것은 `result_raw` 뿐이다.
            contents = []
            if any(not d["approval_flipped"] for d in lost):
                contents.append("처리결과 표기")
            if flipped:
                contents.append("승인 상태")
            changed_contents = "·".join(contents)
            parts.append(f"CM 이 판단한 문서 {documents}건은 대장 원문(발신·문서번호·번호·제목)이 그대로인데, "
                         f"그 doc_id 가 담은 {changed_contents}"
                         f"{_particle(changed_contents, '이', '가')} 달라졌습니다")
        # 한정어 역방향 확인(ADR 0009 §5-3-b) — 이 문장은 개정 2 까지 **한정어 없이** "화면의 승인 상태는
        # CM 이 보고 판단한 그 대장 행의 것이 아닙니다"로 붙었고, 이 절에서 **유일하게 역방향 확인이 없던
        # 자리**였다("모든 row_replaced 에 공통으로 참"이라고 여겨 건너뛴 자리다. CLAUDE.md §6-3 은
        # 한정어를 **빼는** 방향도 확인 대상이라고 적는다). 그 단정이 거짓인 적재가 실제로 있다:
        # ① 대장이 **같은 행의** 표기를 스스로 고친 경로(V8a·V8b·P8b·FP1 — `approval_flipped=False`,
        # `drawing_approval` 0.0 → 0.0, `is_orphaned=False`), ② 행-정체가 같은 두 행의 처리결과가
        # `반려`/`부적합` 이라 둘 다 `REJECTED` 인 경로(P13b — `changed_fields=[]` 이면서
        # `approval_flipped=False`). 둘 다 승인 상태 **값**은 CM 이 판단할 때와 한 글자도 다르지 않다.
        # 이 오탐들을 남기기로 한 근거가 "대가는 부수 효과 없는 확인 요청 1건"인데(§5-2 (바)), 요청
        # 본문이 "네가 본 승인 상태가 그 행의 것이 아니다"라고 말하면 CM 은 도면을 다시 연다 — 대가가
        # **CM 의 도면 재확인 1회**가 되어 그 결정의 전제가 깨진다.
        # 반대 방향도 확인했다 — 이것을 **발화** 게이트로 올리면 §5-2 (바) 근거 2 가 일부러 표 안에 남긴
        # 변종(승인 상태가 **우연히 같은** 다른 행으로 바뀐 경우)이 다시 밖으로 나간다. 그래서 발화는
        # 그대로 두고(`lost_decisions` 불변) **문장의 표현만** 가른다. 근거는 `approval_flipped` 뿐이다:
        # `changed_fields` 는 "무엇이" 달라졌는지만 답해 대장측 오타 정정(V8a `['sender']`)과 행 교체
        # (V7a `['sender','doc_number']`)를 가르지 못하고, `new_doc_id` 는 이 경위에서 **언제나 `None`**
        # 이라 "다시 판단할 곳이 있는가"에만 답한다.
        if flipped:
            parts.append(f"{counted}이 그 문서에 걸려 있고, 그 판단은 지금 화면에 떠 있는 승인 상태와 "
                         "다른 값 위에서 내려졌습니다")
        elif fields:
            parts.append(f"{counted}이 그 문서에 걸려 있고, 승인 상태 값 자체는 CM 이 판단할 때와 같습니다 — "
                         "달라진 것은 이 doc_id 가 담고 있는 대장 원문이고, 대장이 같은 행을 고쳐 적은 "
                         "것인지 다른 행으로 바뀐 것인지는 이번 적재의 값으로 가릴 수 없습니다")
        else:
            # 역방향 확인 — 여기서 "달라진 것은 대장 원문"이라고 적으면 `changed_fields == []` 가 말하는
            # 바로 그 사실(원문 네 필드는 그대로)을 뒤집는 거짓이 된다. 위 `else` 분기가 이미 무엇이
            # 달라졌는지 적었으므로 이 절은 승인 상태만 말한다(ADR 0009 §5-3-b 결정표 셋째 줄).
            parts.append(f"{counted}이 그 문서에 걸려 있고, 승인 상태 값은 CM 이 판단할 때와 같습니다")
        if not any(d["new_doc_id"] for d in lost):
            # 역방향 확인 — "없다"를 **값에서** 읽는다. 경위 이름만 보고 단정하면, 생산자가 언젠가
            # `new_doc_id` 를 싣기 시작했을 때 문구만 거짓으로 남는다.
            parts.append("다시 판단할 새 doc_id 는 없습니다")
        return ". ".join(parts)

    if cause == _CAUSE_ROW_ABSORBED:
        holders = len({d["new_doc_id"] for d in lost if d["new_doc_id"]})
        # 역방향 확인 — `new_doc_id` 가 비어 오면 "그 doc_id 위에서"라고 쓸 곳이 없다. 없는 곳을
        # 가리키지 않도록 문장을 갈라 둔다(값이 없으면 가리키는 말 자체를 빼고 사실만 적는다).
        where = f"다른 문서(doc_id {holders}건)" if holders else "다른 문서"
        absorbed = (f"{counted}이 가리키던 대장 행 {documents}건이 지금은 {where} 아래에 있고, "
                    "이 doc_id 에는 대장 행이 남지 않았습니다")
        return f"{absorbed}. 그 doc_id 위에서 다시 판단하십시오" if holders else absorbed

    if cause == _CAUSE_ROW_MOVED:
        # `drift.moved` 는 정의상 이 경위의 원인 그 자체(이동 쌍 짝짓기 결과)이므로 여기서만 쓴다.
        # 역방향 확인 — 다른 두 경위만 있는 적재는 `moved == 0` 이라 이 절 자체가 만들어지지 않는다.
        # 그래서 "0건 이동했고"를 쓰는 일은 생기지 않는다.
        # **"고아"라고 쓰지 않는다**: 옛 행이 고아가 되는지는 이 값들이 답하지 않는다(시트명 변경 경로는
        # 고아가 되지 않는다 — 실측 P3). 우리가 아는 것은 "행이 다른 doc_id 아래로 옮겨졌다"뿐이다.
        return (f"대장 행은 그대로인데 우리 식별 규칙이 그 행을 새 doc_id 로 옮겼습니다"
                f"(이번 적재의 이동 {len(drift.moved)}건). {counted}이 옛 doc_id 에 남아 있습니다 — "
                f"옮겨간 새 doc_id 위에서 같은 판단을 {_redecide_verb(lost)}하십시오")

    # 경위를 모르는 항목(생산자가 새 cause 를 추가했는데 이 문구가 따라오지 못한 경우). 아는 척하지 않는다.
    return (f"{counted}이 이번 적재의 식별 드리프트에 걸렸습니다"
            f"(경위 {cause!r} — 이 문구가 설명할 수 없는 경위입니다. lost_decisions 를 직접 보십시오)")


def _identity_drift_review_title(drift: IdentityDriftReport) -> str:
    """CM 큐에 뜨는 한 줄. **경위(`cause`)마다 다르게 쓴다.**

    하나로 뭉뚱그린 옛 문구("doc_id 가 N건 이동했고 … 고아 문서에 남았습니다 … 새 doc_id 위에서 다시
    확정하십시오")는 병합 경로에서 세 군데가 거짓이었다: ① 행도 `reviewed_by` 도 살아 있어 고아가 아니다
    ② 다시 확정할 **새 doc_id 가 없다** ③ `moved == 0` 인 적재에 "0건 이동했고"라고 적었다.

    **개정 2 — 그 정정판(개정 1)의 제목도 두 군데가 거짓이었다**(ADR 0009 §5-3). ① 옛 `orphaned` 절이
    "고아 문서에 남았습니다"라고 적는데, 판정은 §5-2 (가)에서 이미 고아를 보지 않기로 고쳤고 시트명 변경
    경로의 옛 행은 실제로 고아가 되지 않는다(실측 P3 `moved=8`, `is_orphaned=False`). ② 옛
    `merge_overwritten` 절이 "서로 다른 대장 행이 한 doc_id 로 **병합**돼"로 시작하는데, 새 조건이 잡는 주
    경로에는 병합이 없다(실측 R1 `merged=0`) — CM 이 있지도 않은 충돌 묶음을 찾게 된다.

    그래서 각 절은 **경위 이름이 아니라 관측한 값**으로 쓴다(`_identity_drift_clause`). 이 저장소는
    "화면·문구가 사실과 다른" 결함을 반복해 겪었고(존재한 적 없는 되돌리기 엔드포인트를 약속한 승인
    다이얼로그, 그 거짓 문구를 계약으로 고정한 웹 테스트 169건 전원 통과), ADR 0009 §Deferred 2 가 문구
    정정을 미루면서 "§5-2 가 분리하면 해결된다"고 적은 바로 그 §5-2 의 제목이 같은 종류의 거짓을 갖고
    태어났다. **경위가 섞이면 각 경위를 건수와 함께 나란히 적는다** — 합치는 순간 다시 거짓이 된다."""
    by_cause: dict[str, list[LostDecision]] = {}
    for lost in drift.lost_decisions:
        # 역방향 확인 — 모르는(또는 빈) `cause` 는 `_CAUSE_UNSPECIFIED` 로 **따로** 모은다.
        # `_CAUSE_ROW_MOVED` 로 떨어뜨리면 ADR 0009 §5-4 가 고치려는 바로 그 거짓이 재생산된다.
        by_cause.setdefault(lost.get("cause") or _CAUSE_UNSPECIFIED, []).append(lost)

    ordered = [c for c in _CAUSE_ORDER if c in by_cause] + sorted(set(by_cause) - set(_CAUSE_ORDER))
    clauses = [_identity_drift_clause(cause, by_cause[cause], drift) for cause in ordered]
    body = ". 또한 ".join(clauses) if clauses else "식별 규칙이 움직였습니다(오염된 CM 판단은 없습니다)"

    # 되돌릴 곳은 **지문이 답한다**(ADR 0009 §5-2 서두: 지문은 판정 조건이 아니라 "어디를 되돌려야
    # 하는가" 하나를 답하는 보고 값이다). 한정어 역방향 확인 — 여기서 늘 "config 를 되돌리십시오"라고
    # 적으면 config 를 한 글자도 바꾸지 않은 경로(워크북 시트명 변경: `fingerprint_changed=False`)에서
    # 거짓이 되고, CM 은 바뀐 적 없는 config 를 뒤지게 된다. 반대로 지문이 달라졌는데 "대장 파일을
    # 보라"고 적으면 진짜 원인(우리 config)을 가린다. 이전 지문을 모르면(첫 적재) 어느 쪽도 단정하지 않는다.
    if drift.previous_fingerprint is None:
        where = "이전 지문이 없어 식별 표면 config 와 대장 파일(시트명 등) 중 어느 쪽이 움직였는지 알 수 없습니다"
    elif drift.previous_fingerprint != drift.current_fingerprint:
        where = "식별 표면 config 가 바뀌었습니다 — 되돌리고 대장을 다시 올리십시오"
    else:
        where = ("식별 표면 config 는 그대로입니다(지문 동일) — 대장 파일 쪽 입력"
                 "(워크북 시트명 등)이 바뀌지 않았는지 확인하십시오")
    return f"문서 식별 드리프트: {body} — 확인용 요청입니다(매핑은 복구되지 않습니다). {where}"


def open_identity_drift_review(session: Session, project_id: str,
                               drift: IdentityDriftReport) -> str | None:
    """ADR 0009 §5-2·§5-3. 식별 드리프트를 CM 검토 큐에 올린다. **적재당 최대 1건.**

    **사람이 잃어버린 판단이 실제로 있을 때만 만든다.** `drift.lost_decisions` 가 비어 있으면 `None` 을
    돌려주고 아무것도 만들지 않는다 — 새 협력사 별칭을 추가한 주마다 CM 큐가 오염되면 운영자는 config 를
    되돌리는 대신 **탐지를 끄는 방향**으로 움직인다. 잃을 것이 없을 때는 job 경고(`DOCUMENT_IDENTITY_DRIFT`)
    까지가 적절한 크기다.

    **해소에 부수 효과가 없다(§5-3).** `services/api/usecases.resolve_review` 의 공통 폴백이
    `status`/`resolution_note`/`resolved_by` 만 기록하고, 이 kind 에 매핑을 되살리는 분기를 붙이는 설계는
    반려한다 — 시스템이 사람의 확정을 복원하는 것이라 ADR 0001 불변식과 충돌한다. 제목이 "복구되지
    않습니다"라고 먼저 말하는 이유가 이것이다.

    **중복 생성 금지**(`_sync_pending_document_mapping_reviews` 와 같은 관례): 같은 `current_fingerprint`
    로 열려 있는 요청이 이미 있으면 새로 만들지 않고 최신 관찰로 갱신한 뒤 그 id 를 돌려준다. config 를
    되돌렸다 다시 바꾸는 왕복은 지문이 달라지므로 두 번 뜬다 — 두 번 다 진짜 사건이라 의도한 동작이다
    (계획 0003 §10-3).

    `confidence=1.0`: 이것은 **판정이 아니라 관측**이다. 지문이 달라졌고 제목 원문이 같은 고아 ↔ 신규
    쌍이 실제로 있다는 사실에 불확실성이 없다(CLAUDE.md §3 규칙 3 의 confidence 는 "얼마나 확신하는가"이지
    "얼마나 심각한가"가 아니다).

    반환값은 만들었거나 갱신한 `review_request_id`, 만들지 않았으면 `None`.
    """
    if not drift.lost_decisions:
        return None

    sources: dict[str, Any] = {
        "previous_fingerprint": drift.previous_fingerprint,
        "current_fingerprint": drift.current_fingerprint,
        "moved": drift.moved,
        "merged": drift.merged,
        "lost_decisions": drift.lost_decisions,
    }
    evidence = Evidence(
        source_type="document",
        # Evidence.source_id 는 공란을 허용하지 않는다(ADR 0001 §5). 드리프트를 드러낸 것은 이번 대장
        # 업로드이므로 그 file_id 가 1순위이고, 호출자가 넘기지 못했을 때만 프로젝트로 떨어진다 —
        # 근거 없는 요청을 만드느니 덜 정밀한 근거라도 남긴다.
        source_id=drift.file_id or project_id,
        method=_IDENTITY_DRIFT_METHOD,
        note=_IDENTITY_DRIFT_WARNING_CODE,
        extra={"moved_count": len(drift.moved), "merged_count": len(drift.merged),
               "lost_decision_count": len(drift.lost_decisions),
               "previous_fingerprint": drift.previous_fingerprint,
               "current_fingerprint": drift.current_fingerprint},
    )
    title = _identity_drift_review_title(drift)

    for row in db.open_reviews(session, project_id, kind="document_identity_drift"):
        if (row.conflicting_sources or {}).get("current_fingerprint") != drift.current_fingerprint:
            continue
        row.title = title
        row.conflicting_sources = sources
        row.evidence = evidence.model_dump(mode="json")
        session.flush()
        return row.review_request_id

    review = ReviewRequest(
        project_id=project_id, kind="document_identity_drift", activity_id=None, global_id=None,
        title=title, conflicting_sources=sources, confidence=1.0, evidence=evidence, assignee_role="cm",
    )
    db.save_review_request(session, review)
    return str(review.review_request_id)


def _unmapped_document_warnings(session: Session, project_id: str, documents: Sequence[Document],
                                cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """과제 2 선택지 2, 과제 3(9차 리뷰 후속) — 어떤 Activity 에도 매핑 후보가 없는 상태를 경고로 노출한다.

    **임계**(과제 3): "매핑이 단 한 건도 없을 때"만 발화한다. 대장을 공정표보다 먼저 올리면(순서 역전)
    Activity 자체가 없어 매핑이 정확히 0건이 되지만, 정상 순서로 올려도 title_matching 임계값(§4 규칙 1)
    을 넘지 못하는 문서는 늘 일부 있다(픽스처 기준 10건 중 4건) — 그 정상적 부분 미매핑까지 매번 경고
    하면 상시 경고가 되어 실제 순서 역전 신호가 묻힌다. 그래서 "문서는 있는데 프로젝트 전체에 매핑이
    하나도 없다"로 임계를 좁힌다: 순서 역전은 반드시 이 조건을 만족하고, 정상 업로드는(일부만 매핑돼도)
    이 조건을 만족하지 않는다.

    **관례**(과제 3): code·메시지 원문을 파이썬 리터럴로 박지 않는다 — `RegisterWarning`
    (`importers/document_register.py`)이 이미 지키는 관례(`document_possibly_renamed`가
    `cfg["import_warnings"]`에서 메시지를 읽는 것과 같은 방식, `services/ingest/persistence.py`)를
    그대로 따라 `config/document_register.yaml`의 `import_warnings[DOCUMENT_UNMAPPED]`에서 기본 메시지를
    읽고 건수·context 만 코드에서 덧붙인다.

    `services/api/jobs.py`의 `_warning()`과 같은 `{code, message, context}` 모양을 직접 반환하므로(api 를
    import 하지 않기 위해) 호출자가 `JobRow.warnings`에 그대로 extend 하면 된다."""
    if not documents:
        return []
    mapped_doc_ids = {m.doc_id for m in db.document_mappings_for_project(session, project_id)}
    if mapped_doc_ids:
        return []   # 일부라도 매핑됐으면(정상 업로드에서 흔하다) 신호가 아니다 — 과제 3 임계
    by_type: dict[str, int] = {}
    for d in documents:
        by_type[d.doc_type.value] = by_type.get(d.doc_type.value, 0) + 1
    detail = ", ".join(f"{t}={n}" for t, n in sorted(by_type.items()))
    base_message = str(cfg["import_warnings"][_UNMAPPED_WARNING_CODE])
    message = f"{base_message} (unmapped_count={len(documents)}, by_doc_type: {detail})"
    return [{"code": _UNMAPPED_WARNING_CODE, "message": message,
            "context": {"unmapped_count": len(documents), "by_doc_type": by_type,
                        "doc_ids": [d.doc_id for d in documents][:50]}}]


def map_project_documents(session: Session, project_id: str) -> DocumentMappingSyncResult:
    """DB 에서 문서·Activity 를 읽어 매핑을 산출·저장하고(항상 needs_review=True로 upsert),
    document_mapping 검토요청을 함께 동기화한다(생성·중복 방지·고아 문서 자동 종료 — 과제 1·2).

    **재업로드에 안전하다**: 대장을 다시 올려 이 함수가 다시 호출돼도(주간 재업로드가 정상 운영
    절차다 — ADR 0007 Consequences) 이미 열린 document_mapping 검토요청은 중복 생성되지 않는다.

    **호출 순서가 뒤집혀도(대장 → 공정표) 안전하다**: Activity 가 아직 없으면 매핑은 0건이지만
    `warnings`에 "매핑되지 않은 문서 n건"이 실린다(과제 2). 공정표가 나중에 올라온 뒤 이 함수를
    **다시 호출하면** 그때는 실제 매핑이 생성된다 — `services/api/jobs.py`의 `run_schedule`이
    스케줄 저장 직후 이 함수를 한 번 더 호출하도록 바꾸는 것을 권한다(과제 2 선택지 1, api 소유)."""
    cfg = _load_document_register_config()
    tokens_cfg = _compile_discriminative_tokens(cfg["title_matching"].get("discriminative_tokens", []))
    documents = [db.document_row_to_model(r) for r in db.load_documents(session, project_id, include_orphaned=False)]
    activities = [db.activity_row_to_model(a) for a in db.load_activities(session, project_id)]
    computed = map_documents_to_activities(documents, activities, cfg)
    mappings = _drop_already_confirmed(session, project_id, computed)   # 확정된 매핑은 재계산으로 덮어쓰지 않는다
    db.save_document_mappings(session, project_id, mappings)
    docs_by_id = {d.doc_id: d for d in documents}
    created = _sync_pending_document_mapping_reviews(session, project_id, mappings, docs_by_id)
    closed = _close_reviews_for_orphaned_documents(session, project_id)
    # 9차 리뷰: 확정된 매핑이 재계산 후보에서 조용히 사라지는 것(예: Activity 이름 변경으로 판별 토큰
    # 하드 배제)을 침묵시키지 않는다 — 되돌리지 않고 CM 재확인 요청을 다시 연다.
    reopened = _reopen_reviews_for_invalidated_confirmations(session, project_id, documents, activities, cfg, tokens_cfg)
    warnings = _unmapped_document_warnings(session, project_id, documents, cfg)
    return DocumentMappingSyncResult(mappings=mappings, created_review_ids=created, closed_review_ids=closed,
                                     reopened_review_ids=reopened, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# readiness/verification 공용: 확정 필수 문서 + 미확정 매핑 수 집계 (ADR 0007 §5-2)
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class DocumentEvidence:
    """`required_doc_types` 에 속하고 `needs_review=False`·`is_orphaned=False`인 확정 문서(중복 제거)와,
    같은 Activity 집합에 걸린 `needs_review=True` 매핑 수(문서 종류 무관 — ADR §5-2 규칙 5)."""
    confirmed_required: list[DocumentRow] = field(default_factory=list)
    pending_count: int = 0


def confirmed_required_documents(session: Session, project_id: str, activity_ids: Sequence[str],
                                 doc_cfg: dict[str, Any]) -> DocumentEvidence:
    if not activity_ids:
        return DocumentEvidence()
    required_types = set(doc_cfg.get("required_doc_types", ["TFA"]))
    ignore_orphaned = bool(doc_cfg.get("ignore_orphaned_documents", True))

    mappings = db.document_mappings_for_activities(session, project_id, list(activity_ids))
    # 반려된 매핑은 needs_review=False 지만(§ reject_document_mapping — "사람이 이미 판단했다") "확정"이
    # 아니다. 여기서 걸러내지 않으면 CM 이 "이 문서는 무관하다"고 반려한 매핑이 도면 승인 AND 조건의
    # 증거로 도로 들어가 버린다(10차 리뷰 후속).
    confirmed = [m for m in mappings if not m.needs_review and not is_rejected_mapping(m.evidence)]
    pending_count = sum(1 for m in mappings if m.needs_review)

    doc_ids = [m.doc_id for m in confirmed]
    docs_by_id = db.documents_by_ids(session, project_id, doc_ids)
    required_confirmed: dict[str, DocumentRow] = {}
    for m in confirmed:
        d = docs_by_id.get(m.doc_id)
        if d is None or d.doc_type not in required_types:
            continue
        if ignore_orphaned and d.is_orphaned:
            continue   # 규칙 6: is_orphaned=True 문서는 분모·분자 어디에도 넣지 않는다
        required_confirmed[d.doc_id] = d
    return DocumentEvidence(list(required_confirmed.values()), pending_count)


__all__ = [
    "DocumentEvidence", "DocumentMappingSyncResult", "IdentityDriftCause", "IdentityDriftReport",
    "LostDecision", "close_document_mapping_review", "confirmed_required_documents", "is_rejected_mapping",
    "map_documents_to_activities", "map_project_documents", "open_identity_drift_review",
    "reject_document_mapping",
]
