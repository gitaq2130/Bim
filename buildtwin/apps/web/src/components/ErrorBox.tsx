import { ApiError, type KnownApiErrorCode } from "../api/client";

/**
 * 서버 에러 코드 → 한국어 안내 문구. 각 문구는 "무엇이 잘못됐는지" + "다음에 뭘 해야 하는지"를 담는다.
 * status 코드만 보고 원인을 추측하지 않는다 — 같은 409 라도 code 에 따라 원인이 다르다.
 *
 * `CODE_MESSAGES` 를 `Record<KnownApiErrorCode, string>` 로 선언해뒀기 때문에, `KnownApiErrorCode`
 * 유니온(client.ts)에 있는 멤버를 이 표에서 빠뜨리면 컴파일이 실패한다 — 다만 이건 "유니온 ↔ 이 표"
 * 사이의 정합성만 강제한다. **서버가 새 code 를 추가한다고 이 컴파일 에러가 저절로 걸리지는 않는다.**
 * `KnownApiErrorCode` 유니온 자체가 client.ts 상단 TODO 대로 수작업 동기화 목록이라, 새 code 를
 * 그 유니온에 추가하는 걸 잊으면 여기 표도 손대지 않은 채 조용히 통과한다 — 런타임에는 `ApiError.code`
 * (더 넓은 `(string & {})` 타입)로만 들어오고, 아래 `errorText` 의 `in` 체크에서 표에 없는 값으로 걸러져
 * 3번 분기(서버 detail 그대로 노출)로 폴백한다. UX 는 깨지지 않지만 원인별 안내문은 못 보여준다 —
 * 이번에 `admin_cannot_be_member` 가 빠졌던 게 정확히 이 경로였다.
 * 새 서버 code 는 `docs/glossary.md` "오류 응답 code 어휘" 표(정본)와 대조해 `KnownApiErrorCode`
 * 유니온에 먼저 추가해야 비로소 이 표의 exhaustiveness 체크가 걸린다. (후속 과제: 그 대조 자체를
 * 자동화하는 파이프라인은 지금 범위 밖 — client.ts TODO 참고.)
 */
const CODE_MESSAGES: Record<KnownApiErrorCode, string> = {
  // ADR 0005: 같은 GlobalId 객체가 여러 프로젝트에 존재해 서버가 어느 프로젝트인지 특정할 수 없을 때.
  ambiguous_global_id: "이 객체(GlobalId)는 여러 프로젝트에 존재합니다. 프로젝트를 다시 선택한 뒤 시도하세요.",
  // 상태기계 상 허용되지 않는 전이를 시도했을 때.
  invalid_transition: "현재 상태에서는 이 작업을 수행할 수 없습니다. 화면을 새로고침해 최신 상태를 확인하세요.",
  // 열린 검토요청이 있어 다른 전이가 막혔을 때.
  transition_blocked_by_review: "이 객체에 처리되지 않은 검토요청이 있어 전이할 수 없습니다. 먼저 검토요청 페이지에서 처리하세요.",
  // 다른 CM 이 이미 같은 검토요청을 처리했을 때.
  review_already_resolved: "다른 담당자가 이미 이 검토요청을 처리했습니다. 목록을 새로고침해 최신 상태를 확인하세요.",
  // 검측 확정(CONFIRMED) 처리 중 서버 검증에 실패했을 때.
  inspection_confirm_failed: "검측 확정 처리에 실패했습니다. 입력한 근거(evidence)를 확인한 뒤 다시 시도하세요.",
  // 동일 식별자의 프로젝트가 이미 존재할 때.
  duplicate_project: "이미 같은 이름/식별자의 프로젝트가 존재합니다. 다른 이름을 사용하거나 기존 프로젝트를 확인하세요.",
  // 회원가입 시 이미 등록된 이메일을 지정했을 때.
  duplicate_user_email: "이미 등록된 이메일입니다. 다른 이메일을 사용하거나 로그인하세요.",
  // 대상 객체를 찾을 수 없을 때.
  object_not_found: "대상 객체를 찾을 수 없습니다. 삭제되었거나 아직 반영되지 않았을 수 있습니다.",
  // 검측 검토요청이 가리키던 객체가 이후 삭제/재업로드로 사라졌을 때(orphan).
  review_object_not_found: "이 검토요청이 가리키는 객체를 찾을 수 없습니다(삭제되었거나 재업로드로 바뀌었을 수 있습니다). 목록을 새로고침하세요.",
  // 매핑 확정 대상 객체가 그 프로젝트에 없을 때(직접 확정 또는 매핑 검토요청 승인 경로 공통).
  mapping_target_not_found: "매핑 확정 대상 객체를 찾을 수 없습니다. 도면과 후보 객체를 다시 확인하세요.",
  // review_request_id 에 해당하는 검토요청이 없을 때.
  review_request_not_found: "해당 검토요청을 찾을 수 없습니다. 목록을 새로고침해 최신 상태를 확인하세요.",
  // drawing_id 에 해당하는 도면이 없을 때(도면 조회, 또는 매핑 검토요청 승인 중 참조 도면이 삭제된 경우 포함).
  drawing_not_found: "해당 도면을 찾을 수 없습니다. 삭제되었거나 아직 반영되지 않았을 수 있습니다.",
  // model_id 에 해당하는 3D 모델이 없을 때.
  model_not_found: "해당 3D 모델을 찾을 수 없습니다.",
  // 모델의 메시 번들(JSON)이 아직 생성/저장되지 않았을 때.
  mesh_not_found: "이 모델의 3D 메시가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.",
  // 모델의 OBJ 내보내기가 아직 생성/저장되지 않았을 때.
  model_obj_not_found: "이 모델의 OBJ 내보내기가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.",
  // job_id 에 해당하는 작업(파싱/정합 등 비동기 작업)이 없을 때.
  job_not_found: "해당 작업을 찾을 수 없습니다.",
  // file_id 에 해당하는 파일 행이 없을 때.
  file_not_found: "해당 파일을 찾을 수 없습니다.",
  // 파일 행은 있으나 실제 저장된 콘텐츠가 없을 때.
  file_content_not_found: "파일 정보는 있으나 실제 콘텐츠를 찾을 수 없습니다. 다시 업로드하세요.",
  // scan_id 에 해당하는 포인트클라우드 스캔이 없을 때.
  scan_not_found: "해당 스캔을 찾을 수 없습니다.",
  // ADR 0006: 존재 여부와 무관하게, 호출자가 멤버가 아닌 프로젝트에 접근했을 때. 전용 안내 패널(RequireProjectAccess)이
  // 보통 먼저 잡아내지만, 다른 화면에서 원인 코드로만 올 경우를 대비해 문구를 남겨둔다.
  project_not_found: "이 프로젝트에 접근 권한이 없습니다.",
  // activity_id 에 해당하는 공정 Activity 가 없을 때(Readiness 조회).
  activity_not_found: "해당 공정 Activity를 찾을 수 없습니다.",
  // 지정한 층에 기하 정보가 있는 객체가 없어 평면 단면을 만들 수 없을 때.
  plan_section_not_found: "이 층에는 단면을 생성할 기하 정보가 없습니다. 다른 층을 선택하세요.",
  // 역할 기반 접근 제어에 의해 거부되었을 때(404 forbidden 과 별개로 code 로 명확히 올 때).
  forbidden_role: "권한이 없습니다. 이 작업은 허용된 역할만 수행할 수 있습니다.",
  // 업로드 파일 종류를 인식할 수 없거나 처리할 파이프라인이 없을 때.
  unsupported_file_kind: "지원하지 않는 파일 형식입니다. IFC/DXF 등 지원되는 형식인지 확인하세요.",
  // multipart 작업일보 업로드에 report JSON 필드가 없을 때.
  daily_report_missing_field: "작업일보 데이터가 누락되었습니다. 다시 시도하세요.",
  // 작업일보 본문이 스키마 검증에 실패했을 때.
  daily_report_invalid: "작업일보 입력값이 올바르지 않습니다. 필수 항목을 확인하세요.",
  // 스캔 정합 입력이 기준점·마커 최소 조건(각 3개 이상)을 채우지 못했을 때.
  alignment_input_insufficient: "정합 기준점/마커가 부족합니다(각 최소 3개 필요). 기준점을 추가로 입력하세요.",
  // 인증 실패(토큰 없음/무효/만료, 알 수 없는 사용자). errorText 의 401 폴백과 문구를 맞춘다.
  unauthorized: "로그인이 필요합니다. 다시 로그인하세요.",
  // NotFound 의 중립 기본값 — 호출부가 구체적 code 를 지정하지 않은 404 안전망(오늘은 관측되지 않음).
  not_found: "대상을 찾을 수 없습니다.",
  // ApiError 의 중립 기본값 — 호출부가 구체적 code 를 지정하지 않은 400 안전망.
  bad_request: "요청이 올바르지 않습니다. 입력값을 확인하세요.",
  // Conflict 의 중립 기본값 — 호출부가 구체적 code 를 지정하지 않은 409 안전망.
  conflict: "요청을 처리할 수 없습니다(충돌). 최신 상태를 확인한 뒤 다시 시도하세요.",
  // Unprocessable 의 중립 기본값 — 호출부가 구체적 code 를 지정하지 않은 422 안전망.
  unprocessable_entity: "요청을 처리할 수 없습니다. 입력값을 확인하세요.",
  // UnsupportedMedia 의 중립 기본값 — 호출부가 구체적 code 를 지정하지 않은 415 안전망.
  unsupported_media_type: "지원하지 않는 파일 형식입니다.",
  // 매핑 검토요청 처리 중 저장된 conflicting_sources 를 파싱할 수 없을 때(서버 데이터 손상, 5xx).
  mapping_review_data_corrupt: "서버에 저장된 검토요청 데이터에 문제가 있어 처리할 수 없습니다. 관리자에게 문의하세요.",
  // 멤버 추가 시 대상 user_id 가 존재하지 않을 때.
  user_not_found: "해당 사용자 ID를 찾을 수 없습니다.",
  // 이미 멤버인 사용자를 다시 추가하려 할 때.
  duplicate_member: "이미 이 프로젝트의 멤버입니다.",
  // 존재하지 않는 멤버를 제거하려 할 때.
  member_not_found: "해당 멤버를 찾을 수 없습니다.",
  // ADR 0006 §2-1: 멤버 추가 대상 user_id 가 전역 admin 계정일 때. admin 은 어떤 프로젝트의 멤버도 될 수 없다.
  admin_cannot_be_member:
    "admin 계정은 프로젝트 멤버로 추가할 수 없습니다. 현장 판단이 필요하면 별도의 cm 계정을 발급하세요.",
  // ADR 0007 §8: (project_id, doc_id) 로 문서를 찾을 수 없을 때. 문서 조회는 언제나 두 키를 함께 건다.
  document_not_found: "해당 문서를 찾을 수 없습니다. 삭제되었거나 최근 대장 재업로드로 바뀌었을 수 있습니다.",
  // 업로드한 대장(xlsx)에서 헤더 행을 찾지 못했거나 필수 컬럼(제목)이 없어 어떤 시트도 읽지 못했을 때.
  // 사용자가 고칠 수 있는 오류이므로 무엇을 확인해야 하는지 알려준다.
  document_register_invalid:
    "문서관리대장 파일을 읽을 수 없습니다. 헤더 행(문서발생일/발신/공종/번호/제목 등)이 1~10행 안에 있는지, " +
    "그리고 '제목' 컬럼이 각 시트에 있는지 확인한 뒤 다시 업로드하세요.",
  // 문서↔Activity 매핑 생성·확정이 가리키는 doc_id 또는 activity_id 가 그 프로젝트에 없을 때.
  document_mapping_target_not_found: "매핑 대상 문서 또는 공정 Activity를 찾을 수 없습니다. 목록을 새로고침해 확인하세요.",
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    // 1) code 가 있으면 원인별 한국어 문구로 분기한다 (status 코드만으로는 원인을 고르지 않는다).
    //    e.code 는 알려지지 않은 서버 코드도 표현할 수 있는 넓은 타입이라, in 체크로 런타임에
    //    KnownApiErrorCode 멤버십을 확인한 뒤에만 표에서 찾는다(찾지 못하면 3번 분기로 폴백).
    if (e.code && e.code in CODE_MESSAGES) return CODE_MESSAGES[e.code as KnownApiErrorCode];
    // 2) code 가 없는(구버전/알 수 없는) 에러: 로그인/권한처럼 흔한 두 상태만 문구를 보정하고,
    if (e.status === 401) return "로그인이 필요합니다 (401).";
    if (e.status === 403) return "권한이 없습니다 (403). 이 작업은 허용된 역할만 수행할 수 있습니다.";
    // 3) 그 외에는 서버가 준 detail(e.message)을 상태코드와 함께 그대로 보여준다 — 원인을 지어내지 않는다.
    return `${e.message} (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {errorText(error)}
    </div>
  );
}
