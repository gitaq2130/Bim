/**
 * TanStack Query 훅. 경로는 .claude/agents/api.md "필수 엔드포인트" 표 기준.
 * 서버 상태는 여기(Query 캐시)에만 존재한다.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./client";
import type {
  AlignmentInput,
  DailyReport,
  DailyReportCreate,
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
export function useResolveReview(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewRequestId, ...body }: ResolveReviewRequest & { reviewRequestId: string }) =>
      api.post<ReviewRequest>(`/review-requests/${reviewRequestId}/resolve`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", projectId, "review-requests"] });
      qc.invalidateQueries({ queryKey: ["objects"] });
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
