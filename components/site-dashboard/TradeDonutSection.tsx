"use client";

import { Palette, PieChart } from "lucide-react";
import { TRADE_COLORS } from "@/lib/types";
import type { Trade } from "@/lib/types";

function rate(actual: number, plan: number) {
  if (plan === 0) return 0;
  return Math.round((actual / plan) * 100);
}

export default function TradeDonutSection({ trades }: { trades: Trade[] }) {
  return (
    <section className="px-4 pb-8 pt-6">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-extrabold text-text-2">
        <PieChart size={15} />
        공종별 달성율
      </div>
      <div className="grid grid-cols-2 gap-4">
        {trades.map((t) => {
          const color = TRADE_COLORS[t.name] ?? "#6c707c";
          const pct = t.isNew ? 0 : rate(t.cumActual, t.cumPlan);
          return (
            <div key={t.id} className="flex flex-col items-center gap-2">
              <div
                className="flex h-[100px] w-[100px] items-center justify-center rounded-full"
                style={{ background: `conic-gradient(${color} ${pct}%, var(--surface-3) 0)` }}
              >
                <div className="flex h-[70px] w-[70px] items-center justify-center rounded-full bg-[var(--surface)] text-[19px] font-extrabold">
                  {pct}
                  <i className="ml-0.5 text-[12px] font-bold not-italic text-text-2">%</i>
                </div>
              </div>
              <div className="text-[12.5px] font-bold text-text-2">{t.name}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-text-3">
        <Palette size={13} />
        공종별 색상은 도면 야적·작업 레이어 범례와 동일한 팔레트를 공유합니다
      </div>
    </section>
  );
}
