"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  MapPin,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";

const STRIPE = {
  backgroundImage:
    "repeating-linear-gradient(45deg,#24242c,#24242c 9px,#1c1c22 9px,#1c1c22 18px)",
};

function TracePageInner() {
  const no = Number(useSearchParams().get("no") ?? "");
  const router = useRouter();
  const agenda = useStore((s) => s.agendaByNo(no));
  const respondTrace = useStore((s) => s.respondTrace);
  const [done, setDone] = useState<null | { spawned: number | null }>(null);

  if (!agenda || !agenda.techCase) {
    return (
      <div className="flex h-full items-center justify-center text-text-2">
        추적 대상 안건을 찾을 수 없습니다.
      </div>
    );
  }

  const respond = (r: "이상없음" | "재발" | "확인어려움") => {
    const spawned = respondTrace(no, r);
    setDone({ spawned });
  };

  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <CheckCircle2 size={40} className="text-st-done" />
        <div className="text-[17px] font-bold">응답이 접수되었습니다</div>
        <div className="text-[13px] text-text-2">응답 결과는 이 사례의 신뢰등급에 반영됩니다</div>
        {done.spawned && (
          <button
            onClick={() => router.push(`/agenda?no=${done.spawned}`)}
            className="mt-2 h-12 rounded-2xl bg-accent px-6 text-[15px] font-extrabold text-[#1a1204]"
          >
            새 안건 #{done.spawned} 확인하기
          </button>
        )}
        <button onClick={() => router.push("/mypage")} className="text-[13px] font-semibold text-text-3 underline">
          마이페이지로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center border-b border-line px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <X size={22} />
        </button>
        <span className="flex-1 text-center text-[18px] font-extrabold">6개월 추적</span>
        <span className="w-11" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="h-[120px]" style={STRIPE} />
          <div className="flex gap-2.5 border-b border-line px-3.5 py-[11px] text-[13px]">
            <span className="w-11 flex-none font-extrabold text-text-2">문제</span>
            <span className="flex-1 text-text">{agenda.techCase.problem}</span>
          </div>
          <div className="flex gap-2.5 border-b border-line px-3.5 py-[11px] text-[13px]">
            <span className="w-11 flex-none font-extrabold text-text-2">조치</span>
            <span className="flex-1 text-text">{agenda.techCase.decision}</span>
          </div>
          <div className="flex gap-2.5 px-3.5 py-[11px] text-[13px]">
            <span className="w-11 flex-none font-extrabold text-text-2">결과</span>
            <span className="flex-1 text-text">{agenda.techCase.result}</span>
          </div>
        </div>

        <div className="relative mt-3 flex h-[110px] items-end rounded-2xl border border-line p-2.5" style={STRIPE}>
          <span
            className="absolute -translate-x-1/2 -translate-y-full text-st-review drop-shadow-[0_3px_5px_rgba(0,0,0,.6)]"
            style={{ left: `${agenda.pin?.x ?? 44}%`, top: `${agenda.pin?.y ?? 40}%` }}
          >
            <MapPin size={26} />
          </span>
          <span className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
            {agenda.floorplanLabel ?? "위치 미지정"}
          </span>
        </div>

        <div className="my-5 text-center text-[17px] font-extrabold">
          해당 부위에 현재 이상이 있습니까?
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={() => respond("이상없음")}
            className="flex h-[54px] items-center justify-center gap-2.5 rounded-2xl border border-st-done bg-[rgba(34,197,94,.14)] text-[16px] font-bold text-[#8bea9f]"
          >
            <CheckCircle2 size={19} />
            이상 없음
          </button>
          <button
            onClick={() => respond("재발")}
            className="flex h-[54px] items-center justify-center gap-2.5 rounded-2xl border border-unread bg-[rgba(229,72,77,.14)] text-[16px] font-bold text-[#ff9ea1]"
          >
            <AlertTriangle size={19} />
            재발 확인됨 → 새 안건 등록
          </button>
          <button
            onClick={() => respond("확인어려움")}
            className="flex h-[54px] items-center justify-center gap-2.5 rounded-2xl border border-line-2 bg-surface-2 text-[16px] font-bold text-text-2"
          >
            <HelpCircle size={19} />
            확인 어려움
          </button>
        </div>
        <div className="pb-6 pt-4 text-center text-[12px] font-semibold text-text-3">
          응답 결과는 이 사례의 신뢰등급에 반영됩니다
        </div>
      </div>
    </div>
  );
}

export default function TracePage() {
  return (
    <Suspense>
      <TracePageInner />
    </Suspense>
  );
}
