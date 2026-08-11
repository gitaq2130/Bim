"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import FloorplanPane from "@/components/site-detail/FloorplanPane";
import DailyDashboardPane from "@/components/site-detail/daily/DailyDashboardPane";
import SummarySection from "@/components/site-dashboard/SummarySection";
import WeeklyTableSection from "@/components/site-dashboard/WeeklyTableSection";
import TradeCardsSection from "@/components/site-dashboard/TradeCardsSection";
import TradeDonutSection from "@/components/site-dashboard/TradeDonutSection";
import { useStore } from "@/lib/store";

type Pane = "plan" | "dash" | "daily";

function SiteDetailPageInner() {
  const siteId = useSearchParams().get("id") ?? "site-gochang";
  const initialPane = useSearchParams().get("tab") === "dash" ? "dash" : "plan";
  const router = useRouter();
  const [pane, setPane] = useState<Pane>(initialPane);
  const site = useStore((s) => s.siteById(siteId));
  const allTrades = useStore((s) => s.trades);
  const tradeRequests = useStore((s) => s.tradeRequests);
  const weeklyPlan = useStore((s) => s.weeklyPlan);
  const weeklyActual = useStore((s) => s.weeklyActual);
  const weeklyTotalRow = useStore((s) => s.weeklyTotalRow);

  const trades = useMemo(
    () => allTrades.filter((t) => t.siteId === siteId),
    [allTrades, siteId]
  );
  const pendingCount = useMemo(
    () => tradeRequests.filter((r) => r.siteId === siteId && r.status === "pending").length,
    [tradeRequests, siteId]
  );

  if (!site) return null;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[16px] font-extrabold">{site.name}</span>
      </div>

      <div className="flex flex-none border-b border-line px-2">
        {(
          [
            ["plan", "도면"],
            ["dash", "공정현황"],
            ["daily", "일일현황"],
          ] as [Pane, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPane(key)}
            className={`flex-1 border-b-2 py-[13px] text-center text-[14px] font-bold ${
              pane === key ? "border-accent text-text" : "border-transparent text-text-3"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {pane === "plan" && <FloorplanPane site={site} />}
      {pane === "dash" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SummarySection site={site} />
          <div className="mx-4 mt-6 border-t border-line" />
          <WeeklyTableSection
            trades={trades}
            totalRow={weeklyTotalRow}
            weekPlan={weeklyPlan}
            weekActual={weeklyActual}
            asOfDate={site.asOfDate ?? "2026. 8. 6"}
          />
          <div className="mx-4 mt-6 border-t border-line" />
          <TradeCardsSection trades={trades} pendingCount={pendingCount} />
          <div className="mx-4 border-t border-line" />
          <TradeDonutSection trades={trades} />
        </div>
      )}
      {pane === "daily" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DailyDashboardPane site={site} />
        </div>
      )}
    </div>
  );
}

export default function SiteDetailPage() {
  return (
    <Suspense>
      <SiteDetailPageInner />
    </Suspense>
  );
}
