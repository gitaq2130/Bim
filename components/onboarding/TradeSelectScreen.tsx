"use client";

import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { CONTRACTOR_TRADES } from "@/lib/types";
import type { ContractorTrade } from "@/lib/types";

export default function TradeSelectScreen({
  onSelect,
  onBack,
}: {
  onSelect: (trade: ContractorTrade) => void;
  onBack: () => void;
}) {
  const draft = useStore((s) => s.onboardingDraft);
  const allContractors = useStore((s) => s.contractors);
  const takenTrades = useMemo(
    () =>
      new Set(
        allContractors
          .filter((c) => c.siteId === draft.siteId && c.status === "approved")
          .map((c) => c.trade)
      ),
    [allContractors, draft.siteId]
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
      </div>
      <div className="px-6 pb-6 pt-2">
        <div className="text-[22px] font-extrabold">소속 공종을 선택하세요</div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5">
        {CONTRACTOR_TRADES.map((trade) => {
          const taken = takenTrades.has(trade);
          return (
            <button
              key={trade}
              disabled={taken}
              onClick={() => onSelect(trade)}
              className={`flex h-[110px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-line bg-surface-2 ${
                taken ? "opacity-45" : "active:border-accent"
              }`}
            >
              <span className="text-[17px] font-extrabold">{trade}</span>
              {taken && (
                <span className="rounded-full border border-line-2 bg-surface-3 px-2 py-[2px] text-[11px] font-bold text-text-3">
                  이미 등록됨
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
