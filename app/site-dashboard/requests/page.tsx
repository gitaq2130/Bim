"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Inbox, ShieldCheck, User } from "lucide-react";
import { TRADE_COLORS } from "@/lib/types";
import { useStore } from "@/lib/store";

function TradeRequestsPageInner() {
  const siteId = useSearchParams().get("id") ?? "site-gochang";
  const router = useRouter();
  const allRequests = useStore((s) => s.tradeRequests);
  const requests = useMemo(
    () => allRequests.filter((r) => r.siteId === siteId && r.status === "pending"),
    [allRequests, siteId]
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[17px] font-extrabold">공정 추가 요청</span>
      </div>

      <div className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[12.5px] font-semibold text-text-3">
        <ShieldCheck size={14} />
        원청 시공사 소장 · 승인 권한
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2">
        <div className="mb-2.5 flex items-center gap-1.5 text-[12px] font-extrabold text-text-2">
          승인 대기
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-3 px-1.5 text-[11px] font-extrabold text-text">
            {requests.length}
          </span>
        </div>

        {requests.map((r) => (
          <button
            key={r.id}
            onClick={() => router.push(`/site-dashboard/requests/detail?id=${r.id}`)}
            className="mb-3 flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5 text-left active:border-accent"
          >
            <div className="flex flex-none items-center gap-1.5 text-[13px] font-extrabold">
              <span
                className="h-[9px] w-[9px] rounded-[3px]"
                style={{ background: TRADE_COLORS[r.tradeName] ?? "#6c707c" }}
              />
              {r.tradeName}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-extrabold">{r.companyName}</div>
              <div className="mt-1 flex items-center gap-1 text-[12px] text-text-3">
                <User size={12} />
                {r.applicantName} {r.applicantRank}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[12px] text-text-3">
                <Clock size={12} />
                {r.requestedAt} 신청
              </div>
            </div>
            <ChevronRight size={18} className="flex-none text-text-3" />
          </button>
        ))}

        {requests.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-text-3">
            <Inbox size={28} />
            <span className="text-[14px]">대기 중인 요청이 없습니다</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TradeRequestsPage() {
  return (
    <Suspense>
      <TradeRequestsPageInner />
    </Suspense>
  );
}
