"use client";

import { MessageSquareText } from "lucide-react";

export default function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-between bg-bg px-8 py-16">
      <div />
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-accent text-[#231a02]">
          <MessageSquareText size={40} />
        </div>
        <div className="text-[28px] font-extrabold tracking-tight">안건톡</div>
        <div className="text-[14px] font-semibold leading-relaxed text-text-2">
          현장의 판단이 조직의 자산이 됩니다
        </div>
      </div>
      <button
        onClick={onStart}
        className="h-[56px] w-full rounded-2xl bg-accent text-[17px] font-extrabold text-[#231a02]"
      >
        시작하기
      </button>
    </div>
  );
}
