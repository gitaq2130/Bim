"use client";

import { User } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { useStore } from "@/lib/store";

export default function AssigneeSheet({
  open,
  onClose,
  agendaNo,
}: {
  open: boolean;
  onClose: () => void;
  agendaNo: number;
}) {
  const contacts = useStore((s) => s.contacts);
  const setAgendaAssignee = useStore((s) => s.setAgendaAssignee);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-1 pb-4 pt-0.5 text-[19px] font-extrabold">담당자를 지정할까요?</div>
      <div className="flex flex-col gap-2">
        {contacts.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setAgendaAssignee(agendaNo, c.id);
              onClose();
            }}
            className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-surface-2"
          >
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-surface-3 text-text-2">
              <User size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[15px] font-semibold">{c.name}</span>
              <span className="ml-1.5 text-[12.5px] text-text-3">
                {c.rank} · {c.company}
              </span>
            </div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
