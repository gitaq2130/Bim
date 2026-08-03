"use client";

import { ChevronRight, Clock, FileCheck2, Stamp } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { useStore } from "@/lib/store";

const OPTIONS = [
  { icon: Clock, title: "진행상황 중간보고", sub: "현재까지 논의된 내용 정리" },
  { icon: FileCheck2, title: "조치완료 보고서", sub: "사내 정식 보고서 형식" },
  { icon: Stamp, title: "발주처·감리 제출용 공문", sub: "공문 서식으로 자동 변환" },
];

export default function ReportSheet({
  open,
  onClose,
  agendaNo,
}: {
  open: boolean;
  onClose: () => void;
  agendaNo: number;
}) {
  const addReportDraft = useStore((s) => s.addAgendaReportDraft);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-1 pb-4 pt-0.5 text-[19px] font-extrabold">어떤 형식으로 작성할까요?</div>
      {OPTIONS.map(({ icon: Icon, title, sub }) => (
        <button
          key={title}
          onClick={() => {
            addReportDraft(agendaNo, title);
            onClose();
          }}
          className="mb-3 flex w-full items-center gap-3.5 rounded-2xl border border-line px-4 py-4 text-left active:bg-surface-2"
        >
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-surface-2 text-text-2">
            <Icon size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold">{title}</div>
            <div className="mt-0.5 text-[13px] text-text-2">{sub}</div>
          </div>
          <ChevronRight size={20} className="text-text-3" />
        </button>
      ))}
    </BottomSheet>
  );
}
