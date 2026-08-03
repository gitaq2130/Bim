"use client";

import Link from "next/link";
import { Bell, ChevronRight, User } from "lucide-react";
import { useStore } from "@/lib/store";

export default function MyPage() {
  const agendas = useStore((s) => s.agendas);
  const tracking = agendas.filter((a) => a.trace?.state === "관찰중");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center border-b border-line px-4">
        <span className="text-[20px] font-extrabold tracking-tight">마이페이지</span>
      </div>

      <div className="flex items-center gap-4 border-b border-line px-4 py-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-3 text-text-2">
          <User size={28} />
        </div>
        <div>
          <div className="text-[17px] font-bold">김대리</div>
          <div className="mt-0.5 text-[13px] text-text-2">건축 공무팀 · 고창CDC 현장</div>
        </div>
      </div>

      {tracking.length > 0 && (
        <div className="px-4 pt-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-text-2">
            <Bell size={15} className="text-accent" />
            6개월 추적 알림
          </div>
          <div className="flex flex-col gap-3">
            {tracking.map((a) => (
              <Link
                key={a.no}
                href={`/agenda/${a.no}/trace`}
                className="rounded-2xl border border-line-2 bg-surface-2/90 p-3.5 backdrop-blur active:opacity-80"
              >
                <div className="flex items-center gap-2 text-[12px] font-bold text-text-2">
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-accent text-[11px] font-extrabold text-[#231a02]">
                    <Bell size={13} />
                  </span>
                  안건톡
                  <span className="ml-auto font-semibold text-text-3">지금</span>
                </div>
                <div className="mt-2 text-[14px] font-bold leading-relaxed">
                  [안건 #{a.no}] 6개월이 지났습니다. {a.title} 부위, 이상 없으신가요?
                </div>
                <div className="mt-2 flex items-center gap-1 text-[13px] font-bold text-accent">
                  확인하기
                  <ChevronRight size={15} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-5 text-[13px] text-text-3">
        완료된 안건은 6개월 후 자동으로 추적 알림이 발송되어, 조치 결과의 유효성을 재확인합니다.
      </div>
    </div>
  );
}
