"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { useStore } from "@/lib/store";

export default function SimilarCasesSheet({
  open,
  onClose,
  agendaNo,
}: {
  open: boolean;
  onClose: () => void;
  agendaNo: number;
}) {
  const router = useRouter();
  const agendas = useStore((s) => s.agendas);
  const cases = useMemo(
    () => agendas.filter((a) => a.techCase && a.no !== agendaNo),
    [agendas, agendaNo]
  );

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-1 pb-4 pt-0.5 text-[19px] font-extrabold">유사사례</div>
      <div className="flex flex-col gap-2">
        {cases.length === 0 && (
          <div className="px-1 py-4 text-[14px] text-text-3">유사사례가 아직 없습니다.</div>
        )}
        {cases.map((c) => (
          <button
            key={c.no}
            onClick={() => {
              onClose();
              router.push(`/agenda/${c.no}`);
            }}
            className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-surface-2"
          >
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-surface-3 text-text-2">
              <Layers size={20} />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[12px] font-bold text-text-3">
                {c.techCase!.caseNo}
              </div>
              <div className="truncate text-[14px] font-semibold">{c.title}</div>
            </div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
