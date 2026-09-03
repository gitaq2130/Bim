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
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy.orm import Session

from packages.core.models.document import ActivityDocumentMapping, Document
from packages.core.models.evidence import Evidence
from packages.core.models.orm import ActivityDocumentMappingRow, DocumentRow
from packages.core.models.progress import Activity
from packages.core.models.review import ReviewRequest

from . import persistence as db
from .config_loader import load_document_register_config

_UNMAPPED_WARNING_CODE = "DOCUMENT_UNMAPPED"   # config/document_register.yaml import_warnings 의 카탈로그 키(과제 3, 9차 리뷰)

# 매핑 반려 표시 (10차 리뷰 후속, reject_document_mapping 참고). `ActivityDocumentMappingRow`에 컬럼을
# 더하지 않고 기존 evidence(JSON) 안에 `extra.mapping_review_decision` 로 표시한다 — 없으면(None) 시스템이
# 제안했거나 확정된 매핑, 이 값이면 CM 이 반려한 매핑이라는 뜻이다.
_MAPPING_REVIEW_DECISION_REJECTED = "rejected"


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


def _is_rejected_mapping(evidence: dict[str, Any] | None) -> bool:
    """`row.evidence`(JSON dict)에 `reject_document_mapping`이 남긴 반려 표시가 있는지 본다.

    확정(`_confirm_document_mapping_row`, api 소유)은 이 키를 절대 쓰지 않으므로, `reviewed_by is not None`
    이면서 이 함수가 `False`를 돌려주면 확정된 매핑이고 `True`를 돌려주면 반려된 매핑이다 — 같은
    `reviewed_by` 필드를 "누가 이 매핑을 검토했는가"로 공유하고, 승인/반려 어느 쪽인지는 evidence 로
    구분한다(§4-2 규칙 6·7과 같은 결의 확장 — evidence 는 감사 기록이지 상태 저장소가 아니라고 했지만,
    반려 사유 자체가 감사해야 할 근거이므로 여기 남기는 것이 자연스럽다)."""
    return bool((evidence or {}).get("extra", {}).get("mapping_review_decision") == _MAPPING_REVIEW_DECISION_REJECTED)


def _drop_already_confirmed(session: Session, mappings: Sequence[ActivityDocumentMapping]) -> list[ActivityDocumentMapping]:
    """재계산된 후보 중, 이미 사람이 판단한(`reviewed_by is not None` — 확정이든 반려든) 기존 매핑 행이
    있으면 제외한다.

    `map_documents_to_activities`는 순수 함수라 매번 `needs_review=True`인 새 후보를 만든다(§4 규칙 5) —
    그걸 그대로 upsert 하면 대장 재업로드가 CM 이 이미 확정한 매핑을 조용히 다시 미확정으로 되돌리고,
    방금 닫은 document_mapping 검토요청까지 재생성하게 된다. 확정은 사람의 행위이고 시스템 재계산이
    되돌려서는 안 된다 — ADR 0001 불변식 2("CONFIRMED 에서 나가는 전이도 cm만")와 같은 구조다.

    **반려도 같은 이유로 여기서 걸러진다(10차 리뷰 후속, `reject_document_mapping` 참고).**
    `reject_document_mapping`이 반려된 행에도 `reviewed_by`를 채우므로 이 조건이 그대로 적용된다 —
    "CM 이 이미 이 (activity_id, doc_id) 쌍을 판단했다"는 확정이든 반려든 시스템 재계산이 뒤집어서는
    안 되는 같은 종류의 사람의 결정이기 때문이다. 별도 분기를 두지 않는다."""
    kept: list[ActivityDocumentMapping] = []
    for m in mappings:
        existing = session.get(ActivityDocumentMappingRow, (m.activity_id, m.doc_id))
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
        if _is_rejected_mapping(row.evidence):
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

    대상 매핑 행이 없거나 다른 프로젝트 소속이면 `LookupError`(호출자 사전조건 위반 — api 가 이미
    존재를 확인했어야 한다, `save_document_mapping`과 같은 관례)."""
    row = session.get(ActivityDocumentMappingRow, (activity_id, doc_id))
    if row is None or row.project_id != project_id:
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
    mappings = _drop_already_confirmed(session, computed)   # 확정된 매핑은 재계산으로 덮어쓰지 않는다
    db.save_document_mappings(session, mappings)
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
    confirmed = [m for m in mappings if not m.needs_review and not _is_rejected_mapping(m.evidence)]
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
    "DocumentEvidence", "DocumentMappingSyncResult", "close_document_mapping_review",
    "confirmed_required_documents", "map_documents_to_activities", "map_project_documents",
    "reject_document_mapping",
]
