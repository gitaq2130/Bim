"use client";

import { Info } from "lucide-react";
import type { Site } from "@/lib/types";

export default function SummarySection({ site }: { site: Site }) {
  const planPct = site.overallPlanPct ?? 0;
  const actualPct = site.overallActualPct ?? 0;
  const timelinePct = site.timelinePct ?? 0;
  const diff = Math.round((actualPct - planPct) * 10) / 10;

  return (
    <section className="px-4 pt-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-bold text-text-3">준공까지</div>
          <div className="text-[26px] font-extrabold leading-none">D-{site.dDay}</div>
        </div>
        <div className="text-[12px] font-semibold text-text-3">기준일 {site.asOfDate}</div>
      </div>

      <div className="mt-5">
        <div className="relative h-3 overflow-visible rounded-full bg-[var(--surface-3)]">
          <div
            className="h-full rounded-full"
            style={{ width: `${timelinePct}%`, background: "linear-gradient(90deg,#3b82f6,#14b8a6)" }}
          />
          <span
            className="absolute -top-6 -translate-x-1/2 whitespace-nowrap text-[15px] font-extrabold text-text"
            style={{ left: `${timelinePct}%` }}
          >
            {timelinePct}%
          </span>
        </div>
        <div className="mt-2.5 flex justify-between text-[11px] font-semibold text-text-3">
          <span>착공 {site.startDate}</span>
          <span>준공예정 {site.endDatePlanned}</span>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div
          className="flex h-[150px] w-[150px] flex-none items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(var(--accent) ${actualPct}%, var(--surface-3) 0)`,
          }}
        >
          <div className="flex h-[110px] w-[110px] flex-col items-center justify-center rounded-full bg-[var(--bg)] text-center">
            <span className="text-[24px] font-extrabold leading-none">
              {actualPct}
              <i className="ml-0.5 text-[12px] font-bold not-italic text-text-2">%</i>
            </span>
            <span className="mt-1 text-[10.5px] font-semibold text-text-3">종합 공정율</span>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3.5">
          <Gauge label="계획" pct={planPct} color="#14b8a6" />
          <Gauge label="실행" pct={actualPct} color="#3b82f6" />
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text-3">
            <Info size={13} />
            계획 대비 {diff > 0 ? "+" : ""}
            {diff}%p
          </div>
        </div>
      </div>
    </section>
  );
}

function Gauge({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-bold text-text-2">{label}</span>
        <span className="text-[15px] font-extrabold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
