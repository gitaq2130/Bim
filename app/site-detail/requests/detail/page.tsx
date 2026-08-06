"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, Info } from "lucide-react";
import { TRADE_COLORS } from "@/lib/types";
import { useStore } from "@/lib/store";

function TradeRequestDetailPageInner() {
  const reqId = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const allRequests = useStore((s) => s.tradeRequests);
  const request = allRequests.find((r) => r.id === reqId);
  const site = useStore((s) => (request ? s.siteById(request.siteId) : undefined));
  const approveTradeRequest = useStore((s) => s.approveTradeRequest);
  const rejectTradeRequest = useStore((s) => s.rejectTradeRequest);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  if (!request) return null;

  const color = TRADE_COLORS[request.tradeName] ?? "#6c707c";
  const decided = request.status !== "pending";

  const handleApprove = () => {
    approveTradeRequest(request.id);
    setConfirmOpen(false);
    setDoneOpen(true);
    setTimeout(() => {
      setDoneOpen(false);
      router.push(`/site-detail?id=${request.siteId}&tab=dash`);
    }, 1600);
  };

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[17px] font-extrabold">요청 상세</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] font-extrabold">
          <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: color }} />
          {request.tradeName} 공정 추가
        </div>

        <div className="rounded-2xl border border-line-2 bg-surface-2 p-5">
          <div className="text-[19px] font-extrabold">{request.applicantName}</div>
          <div className="mt-0.5 text-[13px] font-semibold text-text-2">{request.applicantRank}</div>
          <div className="my-4 border-t border-line" />
          <InfoRow k="업체명" v={request.companyName} />
          <InfoRow k="신청 공정" v={request.tradeName} />
          <InfoRow k="현장명" v={site?.name ?? ""} />
          <InfoRow k="신청 일시" v={request.requestedAt} />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-surface-2 p-3.5 text-[12.5px] font-semibold leading-relaxed text-text-2">
          <Info size={15} className="mt-0.5 flex-none text-text-3" />
          승인 시 {request.companyName}이 {request.tradeName} 공정률을 직접 입력할 수 있게 됩니다.
        </div>
      </div>

      <div className="flex flex-none gap-2.5 p-4">
        <button
          disabled={decided}
          onClick={() => rejectTradeRequest(request.id)}
          className="h-[52px] flex-1 rounded-2xl border border-line-2 bg-surface-3 text-[15px] font-extrabold text-[#f2777a] disabled:opacity-45"
        >
          {request.status === "rejected" ? "거절됨" : "거절"}
        </button>
        <button
          disabled={decided}
          onClick={() => setConfirmOpen(true)}
          className="h-[52px] flex-1 rounded-2xl bg-st-done text-[15px] font-extrabold text-[#08210f] disabled:opacity-45"
        >
          {request.status === "approved" ? "승인 완료" : "승인"}
        </button>
      </div>

      {confirmOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(6,6,8,.66)] p-7">
          <div className="w-full max-w-[320px] rounded-2xl border border-line-2 bg-surface-3 p-5 text-center">
            <div className="text-[16px] font-extrabold leading-relaxed">
              {request.tradeName} 공정을 현장에 추가하시겠습니까?
            </div>
            <div className="mt-2 text-[13px] font-semibold text-text-2">
              승인 시 해당 업체가 공정률을 직접 입력할 수 있게 됩니다.
            </div>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => setConfirmOpen(false)}
                className="h-[46px] flex-1 rounded-xl border border-line-2 bg-surface-2 text-[15px] font-extrabold text-text-2"
              >
                취소
              </button>
              <button
                onClick={handleApprove}
                className="h-[46px] flex-1 rounded-xl bg-st-done text-[15px] font-extrabold text-[#08210f]"
              >
                승인
              </button>
            </div>
          </div>
        </div>
      )}

      {doneOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(6,6,8,.5)]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-line-2 bg-surface-3 px-8 py-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(34,197,94,.16)] text-st-done">
              <Check size={22} />
            </div>
            <div className="mt-1 text-[15px] font-extrabold">승인 완료</div>
            <div className="text-[12.5px] font-semibold text-text-2">
              {request.tradeName} 공정이 현장 대시보드에 추가되었습니다.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 text-[13.5px] last:border-none">
      <span className="text-text-3">{k}</span>
      <span className="font-bold text-text">{v}</span>
    </div>
  );
}

export default function TradeRequestDetailPage() {
  return (
    <Suspense>
      <TradeRequestDetailPageInner />
    </Suspense>
  );
}
