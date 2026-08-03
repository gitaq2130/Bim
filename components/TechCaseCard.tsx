"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useStore } from "@/lib/store";
import type { TechCase } from "@/lib/types";

const ROWS: { key: keyof Omit<TechCase, "caseNo" | "approval">; label: string }[] = [
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
  const [openRow, setOpenRow] = useState<string | null>(null);

  const techCase = agenda?.techCase;
  if (!techCase) return null;

  return (
    <div className="w-full self-stretch overflow-hidden rounded-[18px] border border-st-done bg-surface-2">
      <div className="border-b border-line bg-[rgba(34,197,94,.08)] p-4">
        <div className="flex items-center gap-2 text-[15px] font-extrabold">
          <CheckCircle2 size={19} className="text-st-done" />
          기술사례 초안이 생성되었습니다
        </div>
        <div className="mt-2 font-mono text-[13px] font-bold text-text-2">{techCase.caseNo}</div>
      </div>

      {ROWS.map(({ key, label }) => {
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
        <button
          disabled={techCase.approval !== "pending"}
          onClick={() => setApproval(agendaNo, "approved")}
          className="h-[46px] flex-1 rounded-xl border border-st-done bg-st-done text-[15px] font-extrabold text-[#08210f] disabled:opacity-60"
        >
          {techCase.approval === "approved" ? "승인됨" : "승인"}
        </button>
        <button className="h-[46px] flex-1 rounded-xl border border-line-2 bg-surface-3 text-[15px] font-extrabold text-text">
          수정
        </button>
        <button
          disabled={techCase.approval !== "pending"}
          onClick={() => setApproval(agendaNo, "rejected")}
          className="h-[46px] flex-1 rounded-xl border border-line-2 bg-surface-3 text-[15px] font-extrabold text-[#f2777a] disabled:opacity-60"
        >
          {techCase.approval === "rejected" ? "반려됨" : "반려"}
        </button>
      </div>
    </div>
  );
}
