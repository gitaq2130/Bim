/**
 * TanStack Query 훅. 경로는 .claude/agents/api.md "필수 엔드포인트" 표 기준.
 * 서버 상태는 여기(Query 캐시)에만 존재한다.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./client";
import type {
  ActivityDocumentMapping,
  AlignmentInput,
  ConfirmDocumentMappingRequest,
  DailyReport,
  DailyReportCreate,
  Document,
  DocumentDetail,
  DocumentsQuery,
  DrawingEntitiesResponse,
  DrawingSummary,
  EntityObjectMapping,
  Job,
  LoginRequest,
  LoginResponse,
  ModelSummary,
  ObjectDetail,
  ObjectsQuery,
  Paginated,
  BimObjectView,
  PlanSection,
  Project,
  ProjectCreate,
  ProjectMember,
  ProjectMemberCreate,
  ProjectRole,
  ReadinessScore,
  ResolveReviewRequest,
  ReviewKind,
  ReviewRequest,
  ReviewStatus,
  ScanSummary,
  ScanVerdict,
  StartableSet,
  StateTransition,
  TransitionRequest,
  UploadResponse,
  WeeklySummary,
} from "./types";

export const queryKeys = {
  projects: ["projects"] as const,
  project: (pid: string) => ["projects", pid] as const,
  job: (jobId: string) => ["jobs", jobId] as const,
  objects: (pid: string, q?: ObjectsQuery) => ["projects", pid, "objects", q ?? {}] as const,
  /** (project_id, global_id) 복합 키 (ADR 0005) — 같은 IFC가 여러 프로젝트에 있어도 캐시가 섞이지 않는다 */
  objectDetail: (pid: string, gid: string) => ["objects", pid, gid] as const,
  models: (pid: string) => ["projects", pid, "models"] as const,
  drawings: (pid: string) => ["projects", pid, "drawings"] as const,
  scans: (pid: string) => ["projects", pid, "scans"] as const,
  drawingEntities: (did: string) => ["drawings", did, "entities"] as const,
  drawingMappings: (did: string) => ["drawings", did, "mappings"] as const,
  planSection: (mid: string, level: string) => ["models", mid, "plan-section", level] as const,
  scanVerdicts: (sid: string) => ["scans", sid, "verdicts"] as const,
  reviews: (pid: string, kind?: ReviewKind | "", status?: ReviewStatus | "") =>
    ["projects", pid, "review-requests", kind ?? "", status ?? ""] as const,
  members: (pid: string) => ["projects", pid, "members"] as const,
  /** ADR 0007 §2-3: 문서는 (project_id, doc_id) 복합 키 — 캐시 키도 항상 둘 다 담는다 */
  documents: (pid: string, q?: DocumentsQuery) => ["projects", pid, "documents", q ?? {}] as const,
  document: (pid: string, docId: string) => ["projects", pid, "documents", docId] as const,
  /**
   * 목록과 상세를 **함께** 무효화하기 위한 공통 접두사(13차 리뷰). `documents(pid)` 는 4번째 원소가
   * 질의 객체 `{}` 라, TanStack 의 부분 일치가 그것을 상세 키의 `docId`(문자열)와 비교해 실패한다 —
   * 즉 목록 키로 무효화해도 상세는 갱신되지 않는다. 문서 전체를 뒤집는 뮤테이션(매핑 재생성 등)은
   * 이 접두사를 쓴다.
   */
  documentsRoot: (pid: string) => ["projects", pid, "documents"] as const,
  readiness: (aid: string) => ["activities", aid, "readiness"] as const,
  startable: (pid: string) => ["projects", pid, "startable"] as const,
  weeklySummary: (pid: string) => ["projects", pid, "weekly-summary"] as const,
};

/** 배열 또는 {items,total} 어느 쪽이 와도 Paginated 로 정규화 */
function toPaginated<T>(data: T[] | Paginated<T>): Paginated<T> {
  if (Array.isArray(data)) return { items: data, total: data.length };
  return data;
}

// ---- auth ----
export function useLogin() {
  return useMutation({
    mutationFn: (body: LoginRequest) => api.post<LoginResponse>("/auth/login", body, { anonymous: true }),
  });
}

// ---- projects ----
export function useProjects(enabled = true) {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => toPaginated(await api.get<Project[] | Paginated<Project>>("/projects")).items,
    enabled,
  });
}
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectCreate) => api.post<Project>("/projects", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects }),
  });
}

/** GET /projects/{id} — 프로젝트 상세. `my_role`(ADR 0006)의 근거 쿼리이므로 useProjectRole 이 이걸 감싼다. */
export function useProject(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.project(projectId ?? ""),
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: !!projectId,
  });
}

export interface ProjectRoleResult {
  /** 이 프로젝트에서 호출자의 역할. 로딩/비멤버/admin 은 null. 서버 my_role 을 그대로 옮긴 값 — Zustand 로 복제하지 않는다(ADR 0006 §3 규칙 4). */
  role: ProjectRole | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * 프로젝트별 역할 소스(ADR 0006). 화면의 모든 역할 판단은 전역 `auth.role` 대신 이 훅을 읽는다.
 * `useProject`(TanStack Query)를 그대로 감싸므로, 같은 projectId 를 보는 다른 컴포넌트(RequireProjectAccess 등)와
 * 캐시를 공유해 중복 요청이 생기지 않는다.
 */
export function useProjectRole(projectId: string | null | undefined): ProjectRoleResult {
  const q = useProject(projectId);
  return { role: q.data?.my_role ?? null, isLoading: q.isPending, isError: q.isError, error: q.error };
}

// ---- files / jobs ----
export function useUploadFile(projectId: string) {
  return useMutation({
    mutationFn: ({ file, kind }: { file: File; kind?: string }) => {
      const fd = new FormData();
      fd.append("file", file, file.name);
      if (kind) fd.append("kind", kind);
      return api.post<UploadResponse>(`/projects/${projectId}/files`, fd);
    },
  });
}

export const isJobTerminal = (j?: Job | null) => !!j && (j.status === "done" || j.status === "failed");

export function useJob(jobId: string | null | undefined, intervalMs = 1500) {
  return useQuery({
    queryKey: queryKeys.job(jobId ?? ""),
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (isJobTerminal(q.state.data) ? false : intervalMs),
  });
}

// ---- objects ----
export function useObjects(projectId: string | null | undefined, q: ObjectsQuery = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.objects(projectId ?? "", q),
    queryFn: async () =>
      toPaginated(await api.get<BimObjectView[] | Paginated<BimObjectView>>(`/projects/${projectId}/objects`, { ...q })),
    enabled: !!projectId && enabled,
  });
}

/** API 페이지네이션 상한(le=2000, docs/api.md). useAllObjects 는 이 크기로 페이지를 넘긴다 */
export const OBJECTS_PAGE_SIZE = 2000;
/** 방어적 루프 상한: page_size(2000) * 25 = 최대 50,000건까지 수집 후 truncated=true 로 중단 */
export const MAX_OBJECTS_PAGES = 25;

export interface AllObjectsResult {
  items: BimObjectView[];
  total: number;
  /** MAX_OBJECTS_PAGES 에 도달해 total 만큼 다 가져오지 못한 경우 true */
  truncated: boolean;
}

/**
 * 객체 목록을 `{items,total,page,page_size}` 페이지네이션 응답을 따라 total 만큼 모두 모을 때까지 순차 조회한다.
 * page/page_size 는 항상 이 훅이 관리하므로 q 에는 넣지 않는다. 결과는 TanStack Query 캐시에만 있고 Zustand 로 복제하지 않는다.
 */
export function useAllObjects(
  projectId: string | null | undefined,
  q: Omit<ObjectsQuery, "page" | "page_size"> = {},
  enabled = true,
) {
  return useQuery<AllObjectsResult>({
    queryKey: [...queryKeys.objects(projectId ?? "", q), "all"] as const,
    queryFn: async () => {
      let items: BimObjectView[] = [];
      let total = 0;
      let truncated = false;
      for (let page = 1; ; page += 1) {
        const res = toPaginated(
          await api.get<BimObjectView[] | Paginated<BimObjectView>>(`/projects/${projectId}/objects`, {
            ...q,
            page,
            page_size: OBJECTS_PAGE_SIZE,
          }),
        );
        items = items.concat(res.items);
        total = res.total;
        if (res.items.length === 0 || items.length >= total) break;
        if (page >= MAX_OBJECTS_PAGES) {
          truncated = true;
          break;
        }
      }
      return { items, total, truncated };
    },
    enabled: !!projectId && enabled,
  });
}

/**
 * 객체 상세 조회. `(project_id, global_id)`가 키(ADR 0005) — 같은 GlobalId가 여러 프로젝트에
 * 존재할 수 있으므로 project_id 를 쿼리 파라미터로 함께 보낸다. 안 보내면 서버가 모호성 409 를 낸다.
 * projectId 는 라우트 파라미터에서 가져온 값을 그대로 넘긴다(전역 상태로 옮기지 않음).
 */
export function useObjectDetail(
  projectId: string | null | undefined,
  globalId: string | null | undefined,
  options?: Partial<UseQueryOptions<ObjectDetail>>,
) {
  return useQuery<ObjectDetail>({
    queryKey: queryKeys.objectDetail(projectId ?? "", globalId ?? ""),
    queryFn: () =>
      api.get<ObjectDetail>(`/objects/${encodeURIComponent(globalId ?? "")}`, { project_id: projectId ?? undefined }),
    enabled: !!globalId && !!projectId,
    ...options,
  });
}

export function useTransition(projectId: string, globalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransitionRequest) =>
      api.post<StateTransition>(`/objects/${encodeURIComponent(globalId)}/transitions`, body, {
        query: { project_id: projectId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.objectDetail(projectId, globalId) });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// ---- models / drawings / scans (프로젝트 자원 목록) ----
export function useModels(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.models(projectId ?? ""),
    queryFn: async () => toPaginated(await api.get<ModelSummary[] | Paginated<ModelSummary>>(`/projects/${projectId}/models`)).items,
    enabled: !!projectId,
  });
}
export function useDrawings(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.drawings(projectId ?? ""),
    queryFn: async () =>
      toPaginated(await api.get<DrawingSummary[] | Paginated<DrawingSummary>>(`/projects/${projectId}/drawings`)).items,
    enabled: !!projectId,
  });
}
export function useScans(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.scans(projectId ?? ""),
    queryFn: async () => toPaginated(await api.get<ScanSummary[] | Paginated<ScanSummary>>(`/projects/${projectId}/scans`)).items,
    enabled: !!projectId,
  });
}

export function useDrawingEntities(drawingId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.drawingEntities(drawingId ?? ""),
    queryFn: () => api.get<DrawingEntitiesResponse>(`/drawings/${drawingId}/entities`),
    enabled: !!drawingId,
  });
}
export function useDrawingMappings(drawingId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.drawingMappings(drawingId ?? ""),
    queryFn: async () =>
      toPaginated(await api.get<EntityObjectMapping[] | Paginated<EntityObjectMapping>>(`/drawings/${drawingId}/mappings`)).items,
    enabled: !!drawingId,
  });
}

export function usePlanSection(modelId: string | null | undefined, level: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.planSection(modelId ?? "", level ?? ""),
    queryFn: () => api.get<PlanSection>(`/models/${modelId}/plan-section`, { level }),
    enabled: !!modelId && !!level,
  });
}

// ---- scans ----
export function useSubmitAlignment(scanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AlignmentInput) => api.post<UploadResponse>(`/scans/${scanId}/alignment`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.scanVerdicts(scanId) }),
  });
}
export function useScanVerdicts(scanId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.scanVerdicts(scanId ?? ""),
    queryFn: async () => toPaginated(await api.get<ScanVerdict[] | Paginated<ScanVerdict>>(`/scans/${scanId}/verdicts`)).items,
    enabled: !!scanId,
  });
}

// ---- daily reports ----
export function useCreateDailyReport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ report, photos }: { report: DailyReportCreate; photos?: File[] }) => {
      // multipart: report(JSON 문자열) + photos(파일 N개). 사진이 없으면 JSON 본문.
      if (!photos || photos.length === 0) return api.post<DailyReport>(`/projects/${projectId}/daily-reports`, report);
      const fd = new FormData();
      fd.append("report", JSON.stringify(report));
      for (const p of photos) fd.append("photos", p, p.name);
      return api.post<DailyReport>(`/projects/${projectId}/daily-reports`, fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", projectId] }),
  });
}

// ---- review requests ----
export function useReviewRequests(projectId: string | null | undefined, kind?: ReviewKind | "", status?: ReviewStatus | "") {
  return useQuery({
    queryKey: queryKeys.reviews(projectId ?? "", kind, status),
    queryFn: async () =>
      toPaginated(
        await api.get<ReviewRequest[] | Paginated<ReviewRequest>>(`/projects/${projectId}/review-requests`, {
          kind: kind || undefined,
          status: status || undefined,
        }),
      ).items,
    enabled: !!projectId,
  });
}
/**
 * 검토요청 해소(승인/반려/보류). **무효화 범위는 `useConfirmDocumentMapping` 과 같아야 한다**(12차 리뷰).
 *
 * `document_mapping` 승인은 서버에서 `_confirm_document_mapping_row` 를 실제로 실행하고(전용 확정
 * 엔드포인트와 **같은 본체**), 반려는 매핑 행에 영구 반려 표시를 남긴다. 둘 다 문서 상세(`mappings`)와
 * drawing_approval readiness 를 바꾼다. 그런데 이 훅은 review-requests 만 무효화하고 있었다:
 * 반려 직후 화면의 매핑 상태가 낡은 "확정"으로 남아, ReviewsPage 카드가 반려 안내도 재확인 안내도
 * 띄우지 못하고 **아무 말도 하지 않았다**. 되돌릴 수 없는 행위를 한 바로 그 순간·그 화면에서 그 결과가
 * 보이지 않았다는 뜻이다 — 이 사이클이 반복한 "조용한 죽음"의 화면 쪽 형태다.
 *
 * 서버에서 두 확정 경로의 방어를 공유 본체로 합친 것과 같은 이유로, 화면에서도 두 경로의 무효화 범위를
 * 맞춘다. doc_id 는 응답 evidence.source_id 에 실려 온다(ADR 0007 §4 규칙 7).
 */
export function useResolveReview(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewRequestId, ...body }: ResolveReviewRequest & { reviewRequestId: string }) =>
      api.post<ReviewRequest>(`/review-requests/${reviewRequestId}/resolve`, body),
    onSuccess: (review) => {
      qc.invalidateQueries({ queryKey: ["projects", projectId, "review-requests"] });
      qc.invalidateQueries({ queryKey: ["objects"] });
      // document_mapping 해소는 문서 상세의 매핑 행과 readiness 를 바꾼다.
      const docId = review?.evidence?.source_type === "document" ? review.evidence.source_id : undefined;
      if (docId) qc.invalidateQueries({ queryKey: queryKeys.document(projectId, docId) });
      qc.invalidateQueries({ queryKey: queryKeys.weeklySummary(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.startable(projectId) });
      qc.invalidateQueries({ queryKey: ["activities"] });   // readiness 키가 ["activities", aid, "readiness"] 라 접두사로 건다
    },
  });
}

// ---- readiness / startable / summary ----
export function useReadiness(activityId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.readiness(activityId ?? ""),
    queryFn: () => api.get<ReadinessScore>(`/activities/${activityId}/readiness`),
    enabled: !!activityId,
  });
}
export function useStartable(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.startable(projectId ?? ""),
    queryFn: () => api.get<StartableSet>(`/projects/${projectId}/startable`),
    enabled: !!projectId,
  });
}
export function useWeeklySummary(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.weeklySummary(projectId ?? ""),
    queryFn: () => api.get<WeeklySummary>(`/projects/${projectId}/weekly-summary`),
    enabled: !!projectId,
  });
}

// ---- 멤버십 (ADR 0006 §4 — admin 전용) ----
export function useProjectMembers(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.members(projectId ?? ""),
    queryFn: async () =>
      toPaginated(await api.get<ProjectMember[] | Paginated<ProjectMember>>(`/projects/${projectId}/members`)).items,
    enabled: !!projectId,
  });
}
export function useAddProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectMemberCreate) => api.post<ProjectMember>(`/projects/${projectId}/members`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members(projectId) }),
  });
}
export function useRemoveProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.del<void>(`/projects/${projectId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members(projectId) }),
  });
}

// ---- 문서관리대장 (ADR 0007) ----
// 경로·쿼리·응답 모양은 services/api/routers/documents.py, schemas/documents.py 기준(api 에이전트 구현 확인됨).
export function useDocuments(projectId: string | null | undefined, q: DocumentsQuery = {}) {
  return useQuery({
    queryKey: queryKeys.documents(projectId ?? "", q),
    queryFn: async () => toPaginated(await api.get<Document[] | Paginated<Document>>(`/projects/${projectId}/documents`, { ...q })),
    enabled: !!projectId,
  });
}

/**
 * 문서 상세 = 문서 한 건 + 그 문서에 걸린 Activity 매핑 전부(DocumentDetail). (project_id, doc_id) 복합 키
 * (ADR 0005/0007과 같은 프로젝트 범위 원칙) — doc_id 단독 조회 금지, project_id 를 쿼리로 함께 보낸다.
 */
export function useDocument(projectId: string | null | undefined, docId: string | null | undefined) {
  return useQuery<DocumentDetail>({
    queryKey: queryKeys.document(projectId ?? "", docId ?? ""),
    queryFn: () => api.get<DocumentDetail>(`/documents/${encodeURIComponent(docId ?? "")}`, { project_id: projectId ?? undefined }),
    enabled: !!projectId && !!docId,
  });
}

/**
 * 문서↔Activity 매핑 확정(needs_review=False, reviewed_by 기록) — cm만(ADR 0007 §4 규칙 5·§7). confidence
 * 값과 무관하게 항상 사람 확인을 요구하므로 이 훅 외에 "일괄 확정" 경로는 만들지 않는다.
 * 확정은 drawing_approval readiness 를 바꿀 수 있어 요약·착수가능 쿼리도 함께 무효화한다.
 */
export function useConfirmDocumentMapping(projectId: string, docId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, note }: { activityId: string; note?: string }) =>
      api.post<ActivityDocumentMapping>(
        `/documents/mappings/${encodeURIComponent(activityId)}/${encodeURIComponent(docId)}/confirm`,
        { note: note || null } satisfies ConfirmDocumentMappingRequest,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.document(projectId, docId) });
      qc.invalidateQueries({ queryKey: queryKeys.weeklySummary(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.startable(projectId) });
      // 확정은 서버에서 close_document_mapping_review 로 그 검토요청을 approved 로 닫는다(13차 리뷰).
      // 빠뜨리면 staleTime 안에 검토 큐로 갔을 때 이미 닫힌 요청이 열림+버튼으로 남고, 누르면
      // 409 review_already_resolved 가 난다. useResolveReview 와 범위가 같아야 한다는 선언이
      // 이 훅 쪽에서 지켜지지 않고 있었다.
      qc.invalidateQueries({ queryKey: ["projects", projectId, "review-requests"] });
      qc.invalidateQueries({ queryKey: ["activities"] });   // readiness 키가 ["activities", aid, "readiness"]
    },
  });
}

/**
 * 문서↔Activity 매핑 후보 (재)생성 — cm만(ADR 0007 §7 규칙 2). 결과는 항상 needs_review=True.
 *
 * 서버 `map_project_documents` 는 매핑 행과 `document_mapping` ReviewRequest 를 **둘 다** 만든다.
 * 이 버튼은 DocumentDetailPage 안에 있고 그 화면은 매핑 목록을 `useDocument`, 재확인 배지를
 * `useReviewRequests` 로 그린다 — 즉 버튼이 바꾸는 대상이 정확히 그 화면이다. 그런데 목록 키
 * (`documents(pid)`, 끝이 `{}`)로만 무효화하고 있어 **자기 화면이 갱신되지 않았다**(13차 리뷰):
 * `staleTime: 10_000` 이라 컴포넌트가 마운트된 채로는 사실상 무기한 낡는다. 12차가 잡은 결함과
 * 같은 구조이므로 접두사 키로 목록·상세를 함께 뒤집고 검토요청도 무효화한다.
 */
export function useGenerateDocumentMappings(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ActivityDocumentMapping[]>(`/projects/${projectId}/documents/mappings`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documentsRoot(projectId) });
      qc.invalidateQueries({ queryKey: ["projects", projectId, "review-requests"] });
    },
  });
}
