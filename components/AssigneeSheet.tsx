"use client";

import { User } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { useStore } from "@/lib/store";

const NAMES = ["현장소장", "품질팀장", "시공팀장", "협력사 담당자", "안전관리자"];

export default function AssigneeSheet({
  open,
  onClose,
  agendaNo,
}: {
  open: boolean;
  onClose: () => void;
  agendaNo: number;
}) {
  const sendSystem = useStore((s) => s.sendSystem);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-1 pb-4 pt-0.5 text-[19px] font-extrabold">담당자를 지정할까요?</div>
      <div className="flex flex-col gap-2">
        {NAMES.map((name) => (
          <button
            key={name}
            onClick={() => {
              sendSystem(`agenda-${agendaNo}`, `담당자가 ${name}(으)로 지정되었습니다`);
              onClose();
            }}
            className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-surface-2"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-3 text-text-2">
              <User size={18} />
            </div>
            <span className="text-[15px] font-semibold">{name}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
