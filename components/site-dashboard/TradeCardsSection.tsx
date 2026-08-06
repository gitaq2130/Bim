"use client";

import { useRouter } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";
import { TRADE_COLORS } from "@/lib/types";
import type { Trade } from "@/lib/types";

function rate(actual: number, plan: number) {
  if (plan === 0) return 0;
  return Math.round((actual / plan) * 100);
}

export default function TradeCardsSection({
  trades,
  pendingCount,
}: {
  trades: Trade[];
  pendingCount: number;
}) {
  const router = useRouter();

  return (
    <section className="px-4 pt-6">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-extrabold text-text-2">
        <ListChecks size={15} />
        공종별 현황
        <button
          onClick={() => router.push("/site-dashboard/requests")}
          className="relative ml-auto flex h-8 items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-3 text-[12px] font-bold text-text active:border-accent"
        >
          <Plus size={15} />
          공정 추가 요청
          {pendingCount > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-unread px-1 text-[10.5px] font-extrabold text-white">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        {trades.map((t) => {
          const color = TRADE_COLORS[t.name] ?? "#6c707c";
          const pct = t.isNew ? 0 : rate(t.cumActual, t.cumPlan);
          return (
            <button
              key={t.id}
              onClick={() => router.push(`/site-dashboard/rate-input?trade=${t.id}`)}
              className="flex items-stretch gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left"
            >
              <span className="w-[5px] flex-none rounded-[3px]" style={{ background: color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-extrabold">{t.name}</span>
                  {!t.fixed && (
                    <span className="rounded-full bg-surface-3 px-[7px] py-[2px] text-[10px] font-extrabold text-text-3">
                      {t.isNew ? "하청 · 신규" : "하청"}
                    </span>
                  )}
                  <span className="ml-auto text-[14px] font-extrabold">{t.isNew ? "0%" : `${pct}%`}</span>
                </div>
                <div className="mt-1.5 text-[12px] font-semibold text-text-2">
                  {t.isNew
                    ? "계획 0.0% · 실적 0.0% · 입력 대기"
                    : `계획 ${t.cumPlan}% · 실적 ${t.cumActual}%`}
                </div>
                <div className="mt-2 h-[7px] overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${t.isNew ? 0 : pct}%`, background: color }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
