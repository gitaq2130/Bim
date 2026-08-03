"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Paperclip, Pin } from "lucide-react";
import type { AiSummary } from "@/lib/types";

export default function AiSummaryCard({ summary }: { summary: AiSummary }) {
  const [expanded, setExpanded] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <div className="flex-none border-b border-line-2 bg-surface-2 px-4 py-3.5">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-2 text-[14px] font-extrabold">
        <Pin size={17} className="text-accent" />
        AI 요약
        {expanded ? <ChevronUp size={18} className="ml-auto text-text-3" /> : <ChevronDown size={18} className="ml-auto text-text-3" />}
      </button>

      {expanded && (
        <>
          <div className="mt-2.5 text-[14px] leading-relaxed text-text-2">{summary.body}</div>
          {summary.openItems.length > 0 && (
            <div className="mt-3 border-t border-dashed border-line-2 pt-2.5">
              <div className="mb-1.5 text-[12px] font-bold text-text-3">미결사항</div>
              <ul>
                {summary.openItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 py-[3px] text-[13.5px] text-text">
                    <span className="h-1.5 w-1.5 flex-none rounded-full bg-st-review" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => setSourcesOpen((v) => !v)}
            className="mt-[11px] flex w-full items-center gap-1.5 text-[12px] font-semibold text-text-3"
          >
            <Paperclip size={14} />
            유사사례 {summary.sourcesCases}건 · {summary.sourcesStandard} 기반
            {sourcesOpen ? <ChevronUp size={15} className="ml-auto" /> : <ChevronDown size={15} className="ml-auto" />}
          </button>
          {sourcesOpen && (
            <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12.5px] text-text-2">
              과거 유사 안건 {summary.sourcesCases}건과 {summary.sourcesStandard}를 근거로 요약을 생성했습니다.
            </div>
          )}
        </>
      )}
    </div>
  );
}
