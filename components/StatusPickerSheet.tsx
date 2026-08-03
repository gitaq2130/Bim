"use client";

import BottomSheet from "./BottomSheet";
import StatusBadge from "./StatusBadge";
import { STATUS_CYCLE } from "@/lib/status";
import type { AgendaStatus } from "@/lib/types";

export default function StatusPickerSheet({
  open,
  onClose,
  current,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  current: AgendaStatus;
  onSelect: (status: AgendaStatus) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-1 pb-1 pt-1 text-[19px] font-extrabold">상태를 변경할까요?</div>
      <div className="flex flex-col gap-2.5 pt-3">
        {STATUS_CYCLE.map((status) => (
          <button
            key={status}
            onClick={() => {
              onSelect(status);
              onClose();
            }}
            className={`flex items-center justify-between rounded-2xl border px-4 py-4 ${
              status === current ? "border-line-2 bg-surface-2" : "border-line"
            }`}
          >
            <StatusBadge status={status} />
            {status === current && <span className="text-[13px] font-semibold text-text-3">현재 상태</span>}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
