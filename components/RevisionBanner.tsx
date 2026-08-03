"use client";

import { AlertTriangle, X } from "lucide-react";
import { useStore } from "@/lib/store";

export default function RevisionBanner({
  agendaNo,
  from,
  to,
}: {
  agendaNo: number;
  from: string;
  to: string;
}) {
  const dismiss = useStore((s) => s.dismissRevision);

  return (
    <div className="relative mx-3.5 mt-3 flex flex-none items-center gap-2.5 rounded-xl border border-[rgba(245,158,11,.32)] bg-[rgba(245,158,11,.1)] px-3.5 py-3">
      <AlertTriangle size={20} className="flex-none text-st-review" />
      <span className="flex-1 text-[13px] font-semibold leading-snug">
        검토하신 부위의 도면이 개정되었습니다{" "}
        <b className="font-extrabold text-[#ffcf7a]">
          {from} → {to}
        </b>
      </span>
      <button
        onClick={() => dismiss(agendaNo)}
        className="h-[34px] flex-none rounded-[9px] bg-st-review px-3.5 text-[13px] font-extrabold text-[#241708]"
      >
        변경 확인
      </button>
      <button
        onClick={() => dismiss(agendaNo)}
        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-line-2 bg-surface-3 text-text-2"
      >
        <X size={14} />
      </button>
    </div>
  );
}
