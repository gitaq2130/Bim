"use client";

import { BarChart3 } from "lucide-react";
import WeeklyChart from "./WeeklyChart";
import { TRADE_COLORS } from "@/lib/types";
import type { Trade, WeeklyTotalRow } from "@/lib/types";

function rate(actual: number, plan: number) {
  if (plan === 0) return 0;
  return Math.round((actual / plan) * 1000) / 10;
}

function rateClass(pct: number) {
  if (pct >= 95) return "text-st-done";
  if (pct >= 80) return "text-st-review";
  return "text-unread";
}

export default function WeeklyTableSection({
  trades,
  totalRow,
  weekPlan,
  weekActual,
  asOfDate,
}: {
  trades: Trade[];
  totalRow: WeeklyTotalRow;
  weekPlan: number[];
  weekActual: number[];
  asOfDate: string;
}) {
  return (
    <section className="px-4 pt-6">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-extrabold text-text-2">
        <BarChart3 size={15} />
        주별 실적
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[11px] whitespace-nowrap">
          <thead>
            <tr>
              <th rowSpan={2} className="sticky left-0 z-10 border-b border-line-2 bg-surface-2 px-2.5 py-1.5 text-left font-bold text-text-2">
                공종
              </th>
              <th colSpan={3} className="border-b border-line-2 bg-surface-2 px-2.5 py-1.5 font-bold text-text-2">
                전전주 누계
              </th>
              <th colSpan={3} className="border-b border-line-2 bg-surface-2 px-2.5 py-1.5 font-bold text-text-2">
                전주 주간
              </th>
              <th colSpan={3} className="border-b border-line-2 bg-surface-2 px-2.5 py-1.5 font-bold text-text-2">
                전주 누계
              </th>
              <th rowSpan={2} className="border-b border-line-2 bg-surface-2 px-2.5 py-1.5 font-bold text-text-2">
                비고
              </th>
            </tr>
            <tr>
              {["계획", "실적", "달성", "계획", "실적", "달성", "계획", "실적", "달성"].map((h, i) => (
                <th key={i} className="border-b border-line-2 bg-surface-2 px-2.5 py-1.5 font-bold text-text-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const prevRate = rate(t.prevCumActual, t.prevCumPlan);
              const weekRate = rate(t.weekActual, t.weekPlan);
              const cumRate = rate(t.cumActual, t.cumPlan);
              return (
                <tr key={t.id}>
                  <td className="sticky left-0 z-10 border-b border-line bg-surface px-2.5 py-1.5 text-left font-bold text-text">
                    <span
                      className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] align-middle"
                      style={{ background: TRADE_COLORS[t.name] ?? "#6c707c" }}
                    />
                    {t.name}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5 font-semibold text-text-2">{t.prevCumPlan}</td>
                  <td className="border-b border-line px-2.5 py-1.5 font-semibold text-text-2">{t.prevCumActual}</td>
                  <td className={`border-b border-line px-2.5 py-1.5 font-semibold ${rateClass(prevRate)}`}>
                    {t.isNew ? "—" : `${prevRate}%`}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5 font-semibold text-text-2">{t.weekPlan}</td>
                  <td className="border-b border-line px-2.5 py-1.5 font-semibold text-text-2">{t.weekActual}</td>
                  <td className={`border-b border-line px-2.5 py-1.5 font-semibold ${rateClass(weekRate)}`}>
                    {t.isNew ? "—" : `${weekRate}%`}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5 font-semibold text-text-2">{t.cumPlan}</td>
                  <td className="border-b border-line px-2.5 py-1.5 font-semibold text-text-2">{t.cumActual}</td>
                  <td className={`border-b border-line px-2.5 py-1.5 font-semibold ${rateClass(cumRate)}`}>
                    {t.isNew ? "—" : `${cumRate}%`}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5 font-semibold text-text-2">
                    {t.isNew ? "신규" : (t.note ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-3">
              <td className="sticky left-0 z-10 bg-surface-3 px-2.5 py-1.5 text-left font-extrabold text-text">합계</td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">{totalRow.prevCumPlan}</td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">{totalRow.prevCumActual}</td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">
                {rate(totalRow.prevCumActual, totalRow.prevCumPlan)}%
              </td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">{totalRow.weekPlan}</td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">{totalRow.weekActual}</td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">
                {rate(totalRow.weekActual, totalRow.weekPlan)}%
              </td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">{totalRow.cumPlan}</td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">{totalRow.cumActual}</td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">
                {rate(totalRow.cumActual, totalRow.cumPlan)}%
              </td>
              <td className="px-2.5 py-1.5 font-extrabold text-text">—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-text-2">
          <Legend swatch="#6c707c" bar label="주간계획" />
          <Legend swatch="#ffd60a" bar label="주간실적" />
          <Legend swatch="#6c707c" label="누계계획" />
          <Legend swatch="#ef4444" label="누계실적" />
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface p-2">
          <WeeklyChart weekPlan={weekPlan} weekActual={weekActual} asOfDate={asOfDate} />
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] font-semibold text-text-3">
          <span>좌: 주간 공정율(%)</span>
          <span>우: 누계 공정율(%)</span>
        </div>
      </div>
    </section>
  );
}

function Legend({ swatch, label, bar }: { swatch: string; label: string; bar?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {bar ? (
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: swatch }} />
      ) : (
        <span className="h-[2px] w-3" style={{ background: swatch }} />
      )}
      {label}
    </span>
  );
}
