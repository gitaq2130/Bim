"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { useStore } from "@/lib/store";
import type { TechCase } from "@/lib/types";

type FieldKey = keyof Omit<TechCase, "caseNo" | "approval">;

const ROWS: { key: FieldKey; label: string }[] = [
  { key: "problem", label: "문제" },
  { key: "cause", label: "원인" },
  { key: "alternatives", label: "검토 대안" },
  { key: "decision", label: "최종 결정" },
  { key: "rationale", label: "결정 근거" },
  { key: "result", label: "조치 결과" },
  { key: "prevention", label: "재발방지" },
];

export default function TechCaseCard({ agendaNo }: { agendaNo: number }) {
  const agenda = useStore((s) => s.agendaByNo(agendaNo));
  const setApproval = useStore((s) => s.setTechCaseApproval);
  const updateTechCase = useStore((s) => s.updateTechCase);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<FieldKey, string> | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  const techCase = agenda?.techCase;
  if (!techCase) return null;

  const startEdit = () => {
    setDraft({
      problem: techCase.problem,
      cause: techCase.cause,
      alternatives: techCase.alternatives,
      decision: techCase.decision,
      rationale: techCase.rationale,
      result: techCase.result,
      prevention: techCase.prevention,
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
  };

  const save = () => {
    if (draft) updateTechCase(agendaNo, draft);
    setEditing(false);
    setDraft(null);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2200);
  };

  return (
    <div
      className={`relative w-full self-stretch overflow-hidden rounded-[18px] border bg-surface-2 ${
        editing ? "border-accent" : "border-st-done"
      }`}
    >
      <div className="border-b border-line bg-[rgba(34,197,94,.08)] p-4">
        <div className="flex items-center gap-2 text-[15px] font-extrabold">
          <CheckCircle2 size={19} className="text-st-done" />
          {editing ? "기술사례 초안" : "기술사례 초안이 생성되었습니다"}
          {editing && (
            <span className="ml-auto inline-flex items-center gap-[5px] rounded-full border border-[rgba(255,214,10,.4)] bg-[rgba(255,214,10,.14)] px-2.5 py-1 text-[11px] font-extrabold text-[#ffe14d]">
              <Pencil size={13} />
              수정 중
            </span>
          )}
        </div>
        <div className="mt-2 font-mono text-[13px] font-bold text-text-2">{techCase.caseNo}</div>
      </div>

      {editing && draft
        ? ROWS.map(({ key, label }) => (
            <div key={key} className="border-b border-line px-4 py-3">
              <div className="mb-1.5 text-[12px] font-extrabold text-text-2">{label}</div>
              <textarea
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                rows={2}
                className="w-full rounded-[10px] border-[1.5px] border-accent bg-[rgba(255,214,10,.05)] p-2.5 text-[13.5px] leading-relaxed text-text shadow-[0_0_0_3px_rgba(255,214,10,.12)] focus:outline-none"
              />
            </div>
          ))
        : ROWS.map(({ key, label }) => {
            const value = techCase[key];
            const open = openRow === key;
            return (
              <button
                key={key}
                onClick={() => setOpenRow(open ? null : key)}
                className="flex w-full items-start gap-2.5 border-b border-line px-4 py-[13px] text-left active:bg-surface-3"
              >
                <span className="w-[72px] flex-none text-[13px] font-extrabold">{label}</span>
                <span className={`flex-1 text-[13px] text-text-2 ${open ? "" : "truncate"}`}>{value}</span>
                {open ? (
                  <ChevronUp size={16} className="mt-0.5 flex-none text-text-3" />
                ) : (
                  <ChevronDown size={16} className="mt-0.5 flex-none text-text-3" />
                )}
              </button>
            );
          })}

      <div className="flex gap-2.5 p-4">
        {editing ? (
          <>
            <button
              onClick={save}
              className="h-[46px] flex-1 rounded-xl border border-st-done bg-st-done text-[15px] font-extrabold text-[#08210f]"
            >
              저장
            </button>
            <button
              onClick={cancelEdit}
              className="h-[46px] flex-1 rounded-xl border border-line-2 bg-surface-3 text-[15px] font-extrabold text-text-2"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button
              disabled={techCase.approval !== "pending"}
              onClick={() => setApproval(agendaNo, "approved")}
              className="h-[46px] flex-1 rounded-xl border border-st-done bg-st-done text-[15px] font-extrabold text-[#08210f] disabled:opacity-60"
            >
              {techCase.approval === "approved" ? "승인됨" : "승인"}
            </button>
            <button
              onClick={startEdit}
              className="h-[46px] flex-1 rounded-xl border border-line-2 bg-surface-3 text-[15px] font-extrabold text-text"
            >
              수정
            </button>
            <button
              disabled={techCase.approval !== "pending"}
              onClick={() => setApproval(agendaNo, "rejected")}
              className="h-[46px] flex-1 rounded-xl border border-line-2 bg-surface-3 text-[15px] font-extrabold text-[#f2777a] disabled:opacity-60"
            >
              {techCase.approval === "rejected" ? "반려됨" : "반려"}
            </button>
          </>
        )}
      </div>

      {savedToast && (
        <div className="animate-pop-in absolute bottom-3.5 left-4 right-4 flex items-center gap-2 rounded-xl border border-st-done bg-[#122a1a] px-3.5 py-3 text-[13.5px] font-bold text-[#8bea9f] shadow-[0_10px_24px_-8px_rgba(0,0,0,.7)]">
          <CheckCircle2 size={18} />
          수정사항이 저장되었습니다
        </div>
      )}
    </div>
  );
}
