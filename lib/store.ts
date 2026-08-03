"use client";

import { create } from "zustand";
import { seedAgendas, seedMessages, seedRooms } from "./seed";
import type {
  Agenda,
  AgendaStatus,
  CompleteForm,
  Message,
  Room,
} from "./types";

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

interface AgendaTalkState {
  rooms: Room[];
  messages: Message[];
  agendas: Agenda[];
  nextAgendaNo: number;
  draft: DraftAgenda;
  updateDraft: (partial: Partial<DraftAgenda>) => void;
  resetDraft: () => void;

  activeAgendaCount: (roomId: string) => number;
  agendaByNo: (no: number) => Agenda | undefined;
  roomMessages: (roomId: string) => Message[];
  roomById: (roomId: string) => Room | undefined;

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
  respondTrace: (
    no: number,
    response: "이상없음" | "재발" | "확인어려움"
  ) => number | null;
}

export const useStore = create<AgendaTalkState>((set, get) => ({
  rooms: seedRooms,
  messages: seedMessages,
  agendas: seedAgendas,
  nextAgendaNo: 168,
  draft: emptyDraft,
  updateDraft: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),
  resetDraft: () => set({ draft: emptyDraft }),

  activeAgendaCount: (roomId) =>
    get().agendas.filter(
      (a) => a.parentRoomId === roomId && !a.status.startsWith("완료")
    ).length,

  agendaByNo: (no) => get().agendas.find((a) => a.no === no),
  roomMessages: (roomId) => get().messages.filter((m) => m.roomId === roomId),
  roomById: (roomId) => get().rooms.find((r) => r.id === roomId),

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
}));
