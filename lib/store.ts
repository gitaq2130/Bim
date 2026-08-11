"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toDepartmentValue } from "./departmentData";
import { ROOM_ICON_PRESETS } from "./roomIcons";
import { ME_ID } from "./types";
import {
  seedAgendas,
  seedContacts,
  seedContractors,
  seedMe,
  seedMessages,
  seedRooms,
  seedSites,
  seedTradeRequests,
  seedTrades,
  seedWeeklyActual,
  seedWeeklyPlan,
  seedWeeklyTotalRow,
  seedZones,
} from "./seed";
import type {
  Agenda,
  AgendaStatus,
  BizCard,
  CompleteForm,
  Contact,
  ContractorCompany,
  ContractorTrade,
  Me,
  Message,
  Room,
  Site,
  TechCase,
  Trade,
  TradeRequest,
  UserRegistration,
  UserRole,
  WeeklyTotalRow,
  Zone,
  ZoneLayer,
} from "./types";

const safeLocalStorage = {
  getItem: (name: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(name)),
  setItem: (name: string, value: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(name, value);
  },
  removeItem: (name: string) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(name);
  },
};

const ROLE_LABEL: Record<UserRole, string> = {
  owner: "발주처",
  hanmi: "한미글로벌",
  contractor: "시공사",
  subcontractor: "협력사",
};

function buildMeFromRegistration(
  current: Me,
  input: { name: string; title: string; phone: string; company: string; site: string; trade: string }
): Me {
  const bizCard: BizCard = {
    nameEn: current.bizCard?.nameEn ?? input.name.toUpperCase(),
    address: input.site,
    phone: current.bizCard?.phone ?? "",
    fax: current.bizCard?.fax ?? "",
    email: current.bizCard?.email ?? "",
    mobile: input.phone,
  };
  return {
    ...current,
    name: input.name,
    rank: input.title,
    company: input.company,
    site: input.site,
    trade: input.trade,
    bizCardRegistered: true,
    bizCard,
  };
}

function nowLabel() {
  const d = new Date();
  const h = d.getHours();
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${period} ${h12}:${m}`;
}

const DEFAULT_PARTICIPANTS = [
  "현장소장",
  "품질팀장",
  "시공팀장",
  "협력사 담당자",
  "안전관리자",
];

export interface DraftAgenda {
  photoAdded: boolean;
  description: string;
  locationChip: string;
  tradeChip: string;
  assigneeChip: string;
  floorplanLabel?: string;
  pin?: { x: number; y: number };
}

const emptyDraft: DraftAgenda = {
  photoAdded: false,
  description: "",
  locationChip: "A동 3층",
  tradeChip: "철근공사",
  assigneeChip: "",
};

export interface OnboardingDraft {
  role: UserRole | null;
  siteId: string | null;
  trade: ContractorTrade | null;
  process: string;
  companyName: string;
  parentContractorId: string | null;
  name: string;
  title: string;
  phone: string;
  dept: string;
  joinYear: string;
  specialties: string[];
}

const emptyOnboardingDraft: OnboardingDraft = {
  role: null,
  siteId: null,
  trade: null,
  process: "",
  companyName: "",
  parentContractorId: null,
  name: "",
  title: "",
  phone: "",
  dept: "",
  joinYear: "",
  specialties: [],
};

export interface NewRoomDraft {
  icon: string;
  name: string;
}

const emptyNewRoomDraft: NewRoomDraft = {
  icon: ROOM_ICON_PRESETS[0],
  name: "",
};

interface AgendaTalkState {
  rooms: Room[];
  messages: Message[];
  agendas: Agenda[];
  nextAgendaNo: number;
  draft: DraftAgenda;
  updateDraft: (partial: Partial<DraftAgenda>) => void;
  resetDraft: () => void;

  me: Me;
  contacts: Contact[];
  contactById: (id: string) => Contact | undefined;
  registerMyBizCard: (input: {
    name: string;
    rank: string;
    company: string;
    trade: string;
    bizCard: BizCard;
  }) => void;
  updateMe: (partial: Partial<Me>) => void;
  setContactNote: (id: string, note: string) => void;
  toggleContactFavorite: (id: string) => void;
  setContactBlocked: (id: string, blocked: boolean) => void;

  toggleRoomFavorite: (roomId: string) => void;
  toggleRoomPinned: (roomId: string) => void;
  toggleRoomMuted: (roomId: string) => void;

  newRoomDraft: NewRoomDraft;
  updateNewRoomDraft: (partial: Partial<NewRoomDraft>) => void;
  resetNewRoomDraft: () => void;
  createRoom: (input: { name: string; icon: string; memberIds: string[] }) => string;
  inviteMembers: (roomId: string, contactIds: string[]) => void;

  sites: Site[];
  contractors: ContractorCompany[];
  siteById: (id: string) => Site | undefined;
  registration: UserRegistration | null;
  onboardingDraft: OnboardingDraft;
  updateOnboardingDraft: (partial: Partial<OnboardingDraft>) => void;
  resetOnboardingDraft: () => void;
  submitRegistration: () => void;
  cancelRegistration: () => void;

  trades: Trade[];
  tradeRequests: TradeRequest[];
  weeklyPlan: number[];
  weeklyActual: number[];
  weeklyTotalRow: WeeklyTotalRow;
  approveTradeRequest: (requestId: string) => void;
  rejectTradeRequest: (requestId: string) => void;

  zones: Zone[];
  addZone: (input: {
    siteId: string;
    layer: ZoneLayer;
    x: number;
    y: number;
    width: number;
    height: number;
    date: string;
    materialType?: string;
    quantity?: string;
    broughtInDate?: string;
    workContent?: string;
    equipment?: string;
    workerCount?: string;
  }) => void;
  removeZone: (id: string) => void;
  updateZone: (
    id: string,
    fields: Partial<
      Pick<
        Zone,
        "layer" | "materialType" | "quantity" | "broughtInDate" | "workContent" | "equipment" | "workerCount"
      >
    >
  ) => void;

  activeAgendaCount: (roomId: string) => number;
  agendaByNo: (no: number) => Agenda | undefined;
  roomMessages: (roomId: string) => Message[];
  roomById: (roomId: string) => Room | undefined;
  roomPreviewText: (roomId: string) => string;
  setAgendaAssignee: (no: number, contactId: string) => void;

  sendText: (roomId: string, text: string) => void;
  sendPhoto: (roomId: string) => void;
  sendFile: (roomId: string, fileName: string) => void;
  sendSystem: (roomId: string, text: string) => void;

  createAgenda: (input: {
    parentRoomId: string;
    title: string;
    photoLabel?: string;
    photoCount?: number;
    floorplanLabel?: string;
    pin?: { x: number; y: number };
  }) => number;

  setAgendaStatus: (no: number, status: AgendaStatus) => void;
  dismissRevision: (no: number) => void;
  toggleDecisionBasis: (messageId: string) => void;
  addAgendaReportDraft: (no: number, formatLabel: string) => void;
  submitCompleteForm: (
    no: number,
    form: Pick<CompleteForm, "hasDisagreement" | "disagreeParties" | "priorities">
  ) => void;
  setTechCaseApproval: (
    no: number,
    approval: "approved" | "rejected"
  ) => void;
  updateTechCase: (
    no: number,
    fields: Pick<
      TechCase,
      "problem" | "cause" | "alternatives" | "decision" | "rationale" | "result" | "prevention"
    >
  ) => void;
  respondTrace: (
    no: number,
    response: "이상없음" | "재발" | "확인어려움"
  ) => number | null;
}

export const useStore = create<AgendaTalkState>()(
  persist(
    (set, get) => ({
  rooms: seedRooms,
  messages: seedMessages,
  agendas: seedAgendas,
  nextAgendaNo: 168,
  draft: emptyDraft,
  updateDraft: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),
  resetDraft: () => set({ draft: emptyDraft }),

  me: seedMe,
  contacts: seedContacts,
  contactById: (id) => get().contacts.find((c) => c.id === id),

  registerMyBizCard: ({ name, rank, company, trade, bizCard }) =>
    set((s) => ({
      me: { ...s.me, name, rank, company, trade, bizCard, bizCardRegistered: true },
    })),

  updateMe: (partial) => set((s) => ({ me: { ...s.me, ...partial } })),

  setContactNote: (id, note) =>
    set((s) => ({
      contacts: s.contacts.map((c) => (c.id === id ? { ...c, note } : c)),
    })),

  toggleContactFavorite: (id) =>
    set((s) => ({
      contacts: s.contacts.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)),
    })),

  setContactBlocked: (id, blocked) =>
    set((s) => ({
      contacts: s.contacts.map((c) => (c.id === id ? { ...c, blocked } : c)),
    })),

  toggleRoomFavorite: (roomId) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, favorite: !r.favorite } : r)),
    })),
  toggleRoomPinned: (roomId) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, pinned: !r.pinned } : r)),
    })),
  toggleRoomMuted: (roomId) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, muted: !r.muted } : r)),
    })),

  newRoomDraft: emptyNewRoomDraft,
  updateNewRoomDraft: (partial) =>
    set((s) => ({ newRoomDraft: { ...s.newRoomDraft, ...partial } })),
  resetNewRoomDraft: () => set({ newRoomDraft: emptyNewRoomDraft }),

  createRoom: ({ name, icon, memberIds }) => {
    const id = `room-${Date.now()}`;
    const members = [ME_ID, ...memberIds.filter((m) => m !== ME_ID)];
    const room: Room = {
      id,
      type: "partner",
      name,
      icon,
      memberCount: members.length,
      time: nowLabel(),
      creator: ME_ID,
      members,
    };
    set((s) => ({ rooms: [room, ...s.rooms] }));
    return id;
  },

  inviteMembers: (roomId, contactIds) =>
    set((s) => ({
      rooms: s.rooms.map((r) => {
        if (r.id !== roomId) return r;
        const newMembers = contactIds.filter((id) => !r.members.includes(id));
        if (newMembers.length === 0) return r;
        return {
          ...r,
          members: [...r.members, ...newMembers],
          memberCount: (r.memberCount ?? r.members.length) + newMembers.length,
        };
      }),
    })),

  sites: seedSites,
  contractors: seedContractors,
  siteById: (id) => get().sites.find((s) => s.id === id),
  registration: null,
  onboardingDraft: emptyOnboardingDraft,
  updateOnboardingDraft: (partial) =>
    set((s) => ({ onboardingDraft: { ...s.onboardingDraft, ...partial } })),
  resetOnboardingDraft: () => set({ onboardingDraft: emptyOnboardingDraft }),

  submitRegistration: () =>
    set((s) => {
      const d = s.onboardingDraft;
      if (!d.role || !d.siteId) return s;
      const site = s.sites.find((x) => x.id === d.siteId);
      if (!site) return s;

      if (d.role === "owner" || d.role === "hanmi") {
        const registration: UserRegistration = {
          role: d.role,
          siteId: d.siteId,
          siteName: site.name,
          approvalTarget: "",
          status: "instant",
          name: d.name,
          title: d.title,
          phone: d.phone,
          dept: toDepartmentValue(d.dept),
        };
        const me = buildMeFromRegistration(s.me, {
          name: d.name,
          title: d.title,
          phone: d.phone,
          company: ROLE_LABEL[d.role],
          site: site.name,
          trade: d.dept.trim(),
        });
        return { registration, me };
      }

      if (d.role === "contractor") {
        const registration: UserRegistration = {
          role: d.role,
          siteId: d.siteId,
          siteName: site.name,
          trade: d.trade ?? undefined,
          companyName: d.companyName,
          approvalTarget: "한미글로벌 담당자",
          status: "pending",
          name: d.name,
          title: d.title,
          phone: d.phone,
        };
        const me = buildMeFromRegistration(s.me, {
          name: d.name,
          title: d.title,
          phone: d.phone,
          company: d.companyName,
          site: site.name,
          trade: d.trade ?? "",
        });
        return { registration, me };
      }

      const parent = s.contractors.find((c) => c.id === d.parentContractorId);
      const registration: UserRegistration = {
        role: d.role,
        siteId: d.siteId,
        siteName: site.name,
        process: d.process,
        companyName: d.companyName,
        parentContractorId: d.parentContractorId ?? undefined,
        approvalTarget: parent ? `${parent.companyName} 소장` : "",
        status: "pending",
        name: d.name,
        title: d.title,
        phone: d.phone,
      };
      const me = buildMeFromRegistration(s.me, {
        name: d.name,
        title: d.title,
        phone: d.phone,
        company: d.companyName,
        site: site.name,
        trade: d.process,
      });
      return { registration, me };
    }),

  cancelRegistration: () => set({ registration: null, onboardingDraft: emptyOnboardingDraft }),

  trades: seedTrades,
  tradeRequests: seedTradeRequests,
  weeklyPlan: seedWeeklyPlan,
  weeklyActual: seedWeeklyActual,
  weeklyTotalRow: seedWeeklyTotalRow,

  approveTradeRequest: (requestId) =>
    set((s) => {
      const req = s.tradeRequests.find((r) => r.id === requestId);
      if (!req || req.status !== "pending") return s;
      const newTrade: Trade = {
        id: `tr-${requestId}`,
        siteId: req.siteId,
        name: req.tradeName,
        fixed: false,
        isNew: true,
        prevCumPlan: 0,
        prevCumActual: 0,
        weekPlan: 0,
        weekActual: 0,
        cumPlan: 0,
        cumActual: 0,
      };
      return {
        tradeRequests: s.tradeRequests.map((r) =>
          r.id === requestId ? { ...r, status: "approved" as const } : r
        ),
        trades: [...s.trades, newTrade],
      };
    }),

  rejectTradeRequest: (requestId) =>
    set((s) => ({
      tradeRequests: s.tradeRequests.map((r) =>
        r.id === requestId ? { ...r, status: "rejected" as const } : r
      ),
    })),

  zones: seedZones,
  addZone: (input) =>
    set((s) => ({
      zones: [
        ...s.zones,
        {
          id: `zone-${Date.now()}`,
          registeredAt: nowLabel(),
          registeredBy: `${s.me.name} ${s.me.rank}`,
          ...input,
        },
      ],
    })),
  removeZone: (id) =>
    set((s) => ({ zones: s.zones.filter((z) => z.id !== id) })),
  updateZone: (id, fields) =>
    set((s) => ({
      zones: s.zones.map((z) => (z.id === id ? { ...z, ...fields } : z)),
    })),

  activeAgendaCount: (roomId) =>
    get().agendas.filter(
      (a) => a.parentRoomId === roomId && !a.status.startsWith("완료")
    ).length,

  agendaByNo: (no) => get().agendas.find((a) => a.no === no),
  roomMessages: (roomId) => get().messages.filter((m) => m.roomId === roomId),
  roomById: (roomId) => get().rooms.find((r) => r.id === roomId),
  roomPreviewText: (roomId) => {
    const msgs = get().messages.filter((m) => m.roomId === roomId && m.kind !== "system");
    const last = msgs[msgs.length - 1];
    if (!last) return "";
    if (last.kind === "text") return `${last.sender ? last.sender + ": " : ""}${last.text ?? ""}`;
    if (last.kind === "photo") return "사진을 보냈습니다";
    if (last.kind === "file") return `파일: ${last.fileName ?? ""}`;
    if (last.kind === "agenda-card") return "안건이 등록되었습니다";
    return "";
  },

  sendText: (roomId, text) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `m-${Date.now()}`,
          roomId,
          kind: "text",
          text,
          time: nowLabel(),
          outgoing: true,
        },
      ],
    })),

  sendPhoto: (roomId) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `m-${Date.now()}`,
          roomId,
          kind: "photo",
          photoLabel: "사진 — 현장 촬영",
          time: nowLabel(),
          outgoing: true,
        },
      ],
    })),

  sendFile: (roomId, fileName) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `m-${Date.now()}`,
          roomId,
          kind: "file",
          fileName,
          fileSize: "1.2 MB",
          time: nowLabel(),
          outgoing: true,
        },
      ],
    })),

  sendSystem: (roomId, text) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id: `m-${Date.now()}`, roomId, kind: "system", text, time: "" },
      ],
    })),

  setAgendaAssignee: (no, contactId) =>
    set((s) => {
      const contact = s.contacts.find((c) => c.id === contactId);
      return {
        agendas: s.agendas.map((a) => (a.no === no ? { ...a, assigneeId: contactId } : a)),
        messages: contact
          ? [
              ...s.messages,
              {
                id: `m-${Date.now()}`,
                roomId: `agenda-${no}`,
                kind: "system" as const,
                text: `담당자가 ${contact.name}(으)로 지정되었습니다`,
                time: "",
              },
            ]
          : s.messages,
      };
    }),

  createAgenda: ({ parentRoomId, title, photoLabel, photoCount, floorplanLabel, pin }) => {
    const no = get().nextAgendaNo;
    const agenda: Agenda = {
      no,
      parentRoomId,
      title: title || "새 안건",
      status: "검토중",
      photoLabel,
      photoCount,
      participants: 1,
      createdLabel: "방금 등록",
      floorplanLabel,
      pin,
      updatedLabel: "방금 업데이트",
      aiSummary: {
        body: "안건 등록 직후입니다. 대화가 쌓이면 AI가 자동으로 요약을 생성합니다.",
        openItems: ["담당자 의견 대기중"],
        sourcesCases: 0,
        sourcesStandard: "해당 없음",
      },
    };

    set((s) => ({
      nextAgendaNo: s.nextAgendaNo + 1,
      agendas: [...s.agendas, agenda],
      messages: [
        ...s.messages,
        {
          id: `m-${Date.now()}`,
          roomId: parentRoomId,
          kind: "agenda-card",
          agendaNo: no,
          time: nowLabel(),
        },
        {
          id: `m-${Date.now() + 1}`,
          roomId: `agenda-${no}`,
          kind: "system",
          text: "안건방이 생성되었습니다",
          time: "",
        },
      ],
    }));

    return no;
  },

  setAgendaStatus: (no, status) =>
    set((s) => ({
      agendas: s.agendas.map((a) =>
        a.no === no ? { ...a, status, updatedLabel: "방금 업데이트" } : a
      ),
    })),

  dismissRevision: (no) =>
    set((s) => ({
      agendas: s.agendas.map((a) => (a.no === no ? { ...a, revLinked: null } : a)),
    })),

  toggleDecisionBasis: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, isDecisionBasis: !m.isDecisionBasis } : m
      ),
    })),

  addAgendaReportDraft: (no, formatLabel) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `m-${Date.now()}`,
          roomId: `agenda-${no}`,
          kind: "file",
          fileName: `${formatLabel}_안건${no}.pdf`,
          fileSize: "AI 초안 생성됨",
          time: nowLabel(),
        },
      ],
    })),

  submitCompleteForm: (no, form) =>
    set((s) => {
      const agenda = s.agendas.find((a) => a.no === no);
      if (!agenda) return s;
      const existing = agenda.completeForm;
      const completeForm: CompleteForm = {
        reactionCount: existing?.reactionCount ?? 1,
        highValue: existing?.highValue ?? false,
        hasDisagreement: form.hasDisagreement,
        disagreeParties: form.disagreeParties,
        priorities: form.priorities,
      };

      const caseNo = `CASE-2026-${no.toString().padStart(4, "0")}`;
      const decisionMsg = s.messages.find(
        (m) => m.roomId === `agenda-${no}` && m.isDecisionBasis
      );

      return {
        agendas: s.agendas.map((a) =>
          a.no === no
            ? {
                ...a,
                status: "완료",
                completeForm,
                updatedLabel: "방금 완료",
                techCase: {
                  caseNo,
                  problem: a.title,
                  cause: agenda.aiSummary?.body ?? "현장 협의를 통해 원인을 확인했습니다.",
                  alternatives: "현장 보완 vs 재시공/재작업",
                  decision: decisionMsg?.text ?? "협의를 통해 최종 조치안 확정",
                  rationale:
                    completeForm.priorities.length > 0
                      ? `${completeForm.priorities.join(" · ")} 우선`
                      : "현장 협의 결과 반영",
                  result: "조치 완료 후 재검측 적합",
                  prevention: "동일 유형 재발 방지를 위한 체크리스트 반영",
                  approval: "pending",
                },
              }
            : a
        ),
        messages: [
          ...s.messages,
          {
            id: `m-${Date.now()}`,
            roomId: agenda.parentRoomId,
            kind: "system",
            text: `안건 #${no}이(가) 완료 처리되었습니다`,
            time: "",
          },
          {
            id: `m-${Date.now() + 1}`,
            roomId: `agenda-${no}`,
            kind: "system",
            text: "안건이 완료 처리되었습니다",
            time: "",
          },
          {
            id: `m-${Date.now() + 2}`,
            roomId: `agenda-${no}`,
            kind: "tech-case",
            agendaNo: no,
            time: nowLabel(),
          },
        ],
      };
    }),

  setTechCaseApproval: (no, approval) =>
    set((s) => ({
      agendas: s.agendas.map((a) =>
        a.no === no && a.techCase
          ? { ...a, techCase: { ...a.techCase, approval } }
          : a
      ),
    })),

  updateTechCase: (no, fields) =>
    set((s) => ({
      agendas: s.agendas.map((a) =>
        a.no === no && a.techCase
          ? { ...a, techCase: { ...a.techCase, ...fields } }
          : a
      ),
    })),

  respondTrace: (no, response) => {
    const state = get();
    const agenda = state.agendas.find((a) => a.no === no);
    if (!agenda || !agenda.trace) return null;

    if (response === "재발") {
      const newNo = state.nextAgendaNo;
      const spawned: Agenda = {
        no: newNo,
        parentRoomId: agenda.parentRoomId,
        title: `${agenda.title} (재발)`,
        status: "검토중",
        participants: 1,
        participantNames: DEFAULT_PARTICIPANTS,
        createdLabel: "방금 등록 · 6개월 추적에서 재발 확인",
        updatedLabel: "방금 업데이트",
        aiSummary: {
          body: `${agenda.techCase?.caseNo ?? ""} 사례의 재발 건입니다. 과거 조치 이력을 참고하세요.`,
          openItems: ["재발 원인 재조사", "과거 조치 유효성 재검토"],
          sourcesCases: 1,
          sourcesStandard: agenda.techCase ? agenda.techCase.caseNo : "해당 없음",
        },
      };

      set((s) => ({
        nextAgendaNo: s.nextAgendaNo + 1,
        agendas: [
          ...s.agendas.map((a) =>
            a.no === no
              ? { ...a, trace: { ...a.trace!, response } }
              : a
          ),
          spawned,
        ],
        messages: [
          ...s.messages,
          {
            id: `m-${Date.now()}`,
            roomId: agenda.parentRoomId,
            kind: "agenda-card",
            agendaNo: newNo,
            time: nowLabel(),
          },
        ],
      }));
      return newNo;
    }

    set((s) => ({
      agendas: s.agendas.map((a) =>
        a.no === no
          ? {
              ...a,
              status: "완료·검증됨",
              trace: { ...a.trace!, response, state: "검증됨" },
              updatedLabel: "방금 추적 응답 완료",
            }
          : a
      ),
    }));
    return null;
  },
    }),
    {
      name: "angeontalk-storage",
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { draft, onboardingDraft, newRoomDraft, ...persisted } = state;
        return persisted;
      },
    }
  )
);
