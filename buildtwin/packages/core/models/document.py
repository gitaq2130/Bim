"""문서관리대장 모델 (ADR 0007, ADR 0009). 대장은 현장의 정본이고 BuildTwin은 읽기만 한다.

핵심 세 가지:
- 승인 상태(`DocumentApprovalStatus`)는 `ObjectState`와 **무관**하며 어떤 상태 전이도 일으키지 않는다(§3-1).
  공란·해석 불가는 `UNKNOWN`이고 절대 승인으로 추측하지 않는다.
- 문서 ↔ Activity 매핑은 confidence 값과 무관하게 **항상** 사람 확인을 요구한다(ADR 0007 §4 규칙 5).
- **식별(identity)과 대조(matching)의 제목 정규화는 다른 함수다**(ADR 0009). 식별용은 이 모듈에 동결돼
  있고 `config/`를 읽지 않는다. 대조용(`title_normalized`)은 `config/document_register.yaml`
  `title_matching.normalize` 가 소유하며 자유롭게 튜닝할 수 있다 — 튜닝해도 `doc_id` 는 움직이지 않는다.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from .evidence import Evidence
from .state import ObjectState

# ─────────────────────────────────────────────────────────────────────────────
# 식별용 제목 정규화 — 동결(ADR 0009 §3). config 를 읽지 않는다.
# ─────────────────────────────────────────────────────────────────────────────
#: `doc_id` 산출 규칙의 버전. **재료·정규화가 바뀌면 반드시 올린다.** 버전이 `doc_id` 문자열에 그대로
#: 실려 있어야, 재적재가 "새 문서가 들어왔다"인지 "같은 문서의 키 규칙이 바뀌었다"인지 구분할 수 있다
#: (ADR 0009 §4). 올리는 변경은 마이그레이션과 세트다 — 값만 올리고 끝내는 PR 은 reviewer 가 반려한다.
DOC_ID_SCHEME = 1

_IDENTITY_WHITESPACE_RE = re.compile(r"\s+")


def identity_title(title: str) -> str:
    """`doc_id` 재료가 되는 제목 정규화. **인코딩 차이만 흡수하고 내용은 절대 건드리지 않는다**(ADR 0009 §3).

    하는 일은 셋뿐이다:
    1. `unicodedata.normalize("NFKC", ...)` — 전각/반각(（Z1）·Ｚ), 논브레이킹 스페이스처럼 엑셀에서
       IME 상태에 따라 저절로 섞여 들어오는 **표기 인코딩** 차이를 흡수한다. 사람이 고쳐 쓴 것이 아니다.
    2. 연속 공백 → 한 칸, 앞뒤 공백 제거.
    3. `casefold()` — 유니코드 대소문자 무시(`lower()` 보다 정확).

    **하지 않는 일**: 괄호·하이픈·머리말·확장자 제거, 잡음 토큰 삭제. 그런 것은 전부 `config` 의
    `title_matching.normalize`(대조용)가 하고, 이 함수는 절대 하지 않는다. 근거(ADR 0009 §3, 실측):

    - 보수적으로 두면 실패 모드는 **분리**다 — 대장 제목이 실제로 편집되면 같은 문서가 새 `doc_id` 를
      얻고, 기존 문서는 고아가 되며 `document_possibly_renamed` 경고가 뜬다. **눈에 보이고 되돌릴 수 있다.**
    - 공격적으로 두면 실패 모드는 **병합**이다 — 서로 다른 두 문서가 같은 `doc_id` 를 갖고, 뒤 행이 앞
      행을 덮어써 한 행만 남는다. 실측에서 반려(REJECTED) 문서가 승인(APPROVED) 문서 뒤로 사라졌고,
      그 살아남은 `approval_status` 가 `drawing_approval` 논리곱의 입력이 됐다. **아무 경고도 없다.**
    - 둘 다 실패 모드지만 대칭이 아니다. 확신이 없을 때는 사람 확인이 필요한 쪽으로 틀려야 한다 —
      ADR 0001("AI는 추정까지")·ADR 0007 §3-2("승인으로 추측하지 않는다")와 같은 방향이다.
    """
    return _IDENTITY_WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", title)).strip().casefold()


def compute_doc_id(doc_type: str, sender_normalized: str, seq_normalized: str | None, title: str) -> str:
    """ADR 0007 §2-1 + ADR 0009 §4. **`doc_id` 를 만드는 유일하게 승인된 경로다.**

    마지막 인자는 **원문 제목**이다(정규화된 제목이 아니다) — 호출자가 자기 나름대로 정규화한 문자열을
    끼워 넣을 수 없게 하려는 것이 이 시그니처의 목적이다. 정규화는 이 함수 안에서 `identity_title` 로만
    일어난다. `services/progress/importers/document_register.py` 는 자체 `_compute_doc_id` 를 두지 않고
    이 함수를 부른다.

    `discipline` 은 여전히 재료가 아니다(ADR 0007 §2-1 규칙 1 — 신뢰 불가 필드는 정체성에 관여하지 않는다).
    """
    material = f"{doc_type}|{sender_normalized}|{seq_normalized or ''}|{identity_title(title)}"
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
    return f"doc-v{DOC_ID_SCHEME}-{digest}"


class DocumentType(str, Enum):
    """시트명 → 종류 표는 config/document_register.yaml. 알 수 없는 시트는 OTHER."""

    TFA = "TFA"          # 승인/검토/참조 요청서 — 시공상세도 승인. readiness 의 필수 문서 기본값
    TFR = "TFR"          # 자료제출서
    FI = "FI"            # 현장지시
    SCAR = "SCAR"        # 시정조치요구
    NCR = "NCR"          # 부적합보고
    DN = "DN"            # 통보
    VE = "VE"            # 설계변경/가치공학
    RFI = "RFI"          # 질의회신
    OTHER = "other"


class DocumentApprovalStatus(str, Enum):
    """대장 `처리결과` 원문(`result_raw`)을 정규화한 값. 원문은 지우지 않고 따로 보관한다."""

    APPROVED = "APPROVED"
    APPROVED_WITH_COMMENTS = "APPROVED_WITH_COMMENTS"   # 기본적으로 승인으로 보지 않는다(§3-3)
    REJECTED = "REJECTED"
    RESUBMIT_REQUIRED = "RESUBMIT_REQUIRED"
    IN_REVIEW = "IN_REVIEW"
    UNKNOWN = "UNKNOWN"                                  # 공란·해석 불가. 승인으로 추측하지 않는다


# ADR 0007 §3-1: 승인 상태는 객체 상태와 다른 축이다. 값이 겹치면 둘을 혼동한 코드가
# 조용히 통과하므로(예: approval_status 를 상태 전이에 넘기는 실수) 교집합을 금지한다.
assert not ({s.value for s in DocumentApprovalStatus} & {s.value for s in ObjectState})


class Document(BaseModel):
    """대장 한 행. `(project_id, doc_id)`로 식별하며 doc_id 단독 조회는 금지(§2-3)."""

    project_id: str
    doc_id: str
    doc_type: DocumentType
    sender: str
    sender_normalized: str
    discipline_raw: str | None = None        # 신뢰 불가 필드(§4 규칙 2). 단독 매핑 근거가 될 수 없다
    discipline_normalized: str | None = None
    seq_raw: str | None = None
    seq_normalized: str | None = None
    doc_number: str | None = None            # 표시·검색 전용. 되파싱하지 않는다(§2-4)
    title: str
    # 대조용 정규화 텍스트(config `title_matching.normalize`). **`doc_id` 재료가 아니다**(ADR 0009 §2) —
    # 매칭 임계값을 다시 재려고 이 설정을 튜닝해도 문서 정체성은 움직이지 않는다.
    title_normalized: str
    # 식별용 정규화 텍스트. `title` 에서 `identity_title()` 로 **항상 파생**되며 호출자가 준 값은 무시한다
    # (ADR 0009 §3-2 — 동결의 강제 지점). 컬럼으로도 저장해 마이그레이션·감사가 "이 행이 어떤 문자열로
    # 해시됐는가"를 되짚을 수 있게 한다.
    title_identity: str = ""
    issued_on: str | None = None
    result_raw: str | None = None            # 처리결과 원문 그대로. 해석해 덮어쓰지 않는다
    approval_status: DocumentApprovalStatus = DocumentApprovalStatus.UNKNOWN
    approval_confidence: float = Field(ge=0.0, le=1.0)
    approval_evidence: Evidence
    completed_on: str | None = None
    file_id: str
    sheet_name: str
    source_row: int = Field(ge=1)            # 대장 원본 기준 1-based 행 번호
    needs_review: bool = False               # 처리결과를 해석하지 못했을 때 True(§3 규칙 3)
    is_orphaned: bool = False                # 최근 업로드에 없던 문서. 삭제하지 않고 표시만(§2-2)

    @model_validator(mode="after")
    def _derive_title_identity(self) -> Document:
        """`title_identity` 를 **언제나** `title` 에서 다시 계산한다(ADR 0009 §3-2).

        호출자가 넘긴 값을 신뢰하지 않는 이유: 이 필드는 `doc_id` 의 재료이고, 재료를 호출자가 고를 수
        있으면 동결은 관례일 뿐 강제가 아니다. 파서든 DB 읽기든 테스트 헬퍼든 같은 `title` 이면 같은
        `title_identity` 가 나온다 — `doc_id` 는 그 위에서만 계산된다(`compute_doc_id`).

        `doc_id` 자체는 파생시키지 않는다. DB 에서 읽어 온 행을 모델로 되돌릴 때 `doc_id` 를 다시 계산하면,
        `DOC_ID_SCHEME` 가 올라간 순간 **읽기만 해도 정체성이 바뀌어** 마이그레이션 없이 조용히 키가
        움직인다 — ADR 0009 가 막으려는 바로 그 사고다.
        """
        object.__setattr__(self, "title_identity", identity_title(self.title))
        return self


class ActivityDocumentMapping(BaseModel):
    """문서 ↔ Activity 매핑. 문서 ↔ 객체 직접 매핑은 만들지 않는다(§4-1 규칙 1)."""

    activity_id: str
    doc_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    needs_review: bool = True
    reviewed_by: str | None = None

    @model_validator(mode="after")
    def _always_needs_review(self) -> ActivityDocumentMapping:
        """confidence 와 무관하게 항상 사람 확인을 요구한다(§4 규칙 5).

        `MAPPING_REVIEW_THRESHOLD`(0.7)를 쓰지 않는다 — 유사도 0.99여도 ZONE·차수 토큰 하나만 다른
        별개 문서일 수 있고(§4 규칙 3), 틀린 매핑은 착수 가능 판단을 오염시킨다. ADR 0001의
        "스캔 AI는 ESTIMATED_DONE 까지, CONFIRMED 는 cm 만"과 같은 구조다.
        """
        self.needs_review = self.reviewed_by is None
        return self
