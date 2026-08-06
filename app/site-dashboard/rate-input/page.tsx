"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, CheckCircle2, Info, X } from "lucide-react";
import { TRADE_COLORS } from "@/lib/types";
import { useStore } from "@/lib/store";

function RateInputPageInner() {
  const tradeId = useSearchParams().get("trade") ?? "";
  const router = useRouter();
  const trades = useStore((s) => s.trades);
  const trade = trades.find((t) => t.id === tradeId);
  const site = useStore((s) => (trade ? s.siteById(trade.siteId) : undefined));

  const [weekPlan, setWeekPlan] = useState(trade ? String(trade.weekPlan) : "");
  const [weekActual, setWeekActual] = useState(trade ? String(trade.weekActual) : "");
  const [cumPlan, setCumPlan] = useState(trade ? String(trade.cumPlan) : "");
  const [cumActual, setCumActual] = useState(trade ? String(trade.cumActual) : "");
  const [saved, setSaved] = useState(false);

  if (!trade) return null;
  const color = TRADE_COLORS[trade.name] ?? "#6c707c";

  // REV9 주석: 이 화면은 입력 UI까지만 구현. 실제 저장(대시보드 반영) 로직은 다음 REV로 이월.
  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <X size={22} />
        </button>
        <span className="flex-1 text-center text-[18px] font-extrabold">공정률 입력</span>
        <div className="w-11" />
      </div>

      <div className="flex items-center justify-between px-5 pb-4 pt-1">
        <div className="flex items-center gap-1.5 text-[16px] font-extrabold">
          <span className="h-[10px] w-[10px] rounded-[3px]" style={{ background: color }} />
          {trade.name}
        </div>
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-3">
          <Calendar size={13} />
          기준일 {site?.asOfDate}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5">
        <div className="mb-2 text-[12px] font-extrabold text-text-3">주간</div>
        <div className="flex gap-2.5">
          <NumField label="주간 계획 (%)" value={weekPlan} onChange={setWeekPlan} placeholder="예) 3.1" />
          <NumField label="주간 실적 (%)" value={weekActual} onChange={setWeekActual} placeholder="예) 3.0" />
        </div>

        <div className="mb-2 mt-5 text-[12px] font-extrabold text-text-3">누계</div>
        <div className="flex gap-2.5">
          <NumField label="누계 계획 (%)" value={cumPlan} onChange={setCumPlan} placeholder="예) 64.1" />
          <NumField label="누계 실적 (%)" value={cumActual} onChange={setCumActual} placeholder="예) 63.2" />
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-text-3">
          <Info size={13} />
          입력값은 다음 기준일 집계에 반영됩니다.
        </div>
      </div>

      <button
        onClick={save}
        className="mx-4 mb-5 h-[52px] flex-none rounded-2xl bg-accent text-[17px] font-extrabold text-[#231a02]"
      >
        저장
      </button>

      {saved && (
        <div className="absolute bottom-[92px] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-2 bg-surface-3 px-[18px] py-3 text-[14px] font-extrabold text-st-done shadow-[0_12px_30px_-8px_rgba(0,0,0,.7)]">
          <CheckCircle2 size={18} />
          저장되었습니다
        </div>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex-1">
      <div className="mb-1.5 text-[12px] font-bold text-text-3">{label}</div>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-line-2 bg-surface-2 px-3.5 text-[15px] text-text placeholder:text-text-3 focus:outline-none"
      />
    </div>
  );
}

export default function RateInputPage() {
  return (
    <Suspense>
      <RateInputPageInner />
    </Suspense>
  );
}
