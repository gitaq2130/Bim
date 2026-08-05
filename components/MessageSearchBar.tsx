"use client";

import { ChevronDown, ChevronUp, Search } from "lucide-react";

export default function MessageSearchBar({
  open,
  value,
  onChange,
  current,
  total,
  onPrev,
  onNext,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!open) return null;

  const hasQuery = value.trim().length > 0;
  const countLabel = !hasQuery ? "" : total === 0 ? "결과 없음" : `${current} / ${total}`;

  return (
    <div className="animate-slide-down flex-none overflow-hidden border-b border-line bg-surface-2">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Search size={18} className="flex-none text-text-3" />
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="대화 내용 검색"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-[14px] text-text placeholder:text-text-3 focus:outline-none"
        />
        <span className="w-[54px] flex-none text-center text-[12px] text-text-3">{countLabel}</span>
        <button
          onClick={onPrev}
          disabled={total === 0}
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg text-text-2 disabled:opacity-30 active:bg-surface-3"
        >
          <ChevronUp size={18} />
        </button>
        <button
          onClick={onNext}
          disabled={total === 0}
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg text-text-2 disabled:opacity-30 active:bg-surface-3"
        >
          <ChevronDown size={18} />
        </button>
      </div>
    </div>
  );
}
