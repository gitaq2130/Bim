"use client";

import { useMemo } from "react";
import { ChevronLeft, HardHat } from "lucide-react";
import { useStore } from "@/lib/store";

export default function ParentContractorSelectScreen({
  onSelect,
  onBack,
}: {
  onSelect: (contractorId: string) => void;
  onBack: () => void;
}) {
  const draft = useStore((s) => s.onboardingDraft);
  const allContractors = useStore((s) => s.contractors);
  const contractors = useMemo(
    () => allContractors.filter((c) => c.siteId === draft.siteId && c.status === "approved"),
    [allContractors, draft.siteId]
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
      </div>
      <div className="px-6 pb-6 pt-2">
        <div className="text-[22px] font-extrabold">소속 원청사를 선택하세요</div>
      </div>
      <div className="flex flex-col gap-3 px-5">
        {contractors.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface-2 p-4 text-left"
          >
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-surface-3 text-text-2">
              <HardHat size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-extrabold">{c.companyName}</div>
              <div className="mt-0.5 text-[13px] text-text-2">{c.trade}</div>
            </div>
          </button>
        ))}
        {contractors.length === 0 && (
          <div className="py-16 text-center text-[14px] text-text-3">
            이 현장에 등록된 시공사가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
