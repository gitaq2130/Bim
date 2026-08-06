"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";

export default function ContractorSubmitScreen({ onBack }: { onBack: () => void }) {
  const draft = useStore((s) => s.onboardingDraft);
  const updateDraft = useStore((s) => s.updateOnboardingDraft);
  const site = useStore((s) => (draft.siteId ? s.siteById(draft.siteId) : undefined));
  const submitRegistration = useStore((s) => s.submitRegistration);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSubmit = draft.companyName.trim().length > 0;

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
      </div>

      <div className="px-6 pb-2 pt-2">
        <div className="text-[22px] font-extrabold">업체명을 입력하세요</div>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] font-bold text-text-2">
          {site?.name} · {draft.trade}
        </div>
      </div>

      <div className="flex-1 px-5 pt-4">
        <div className="mb-1.5 text-[12px] font-bold text-text-3">업체명</div>
        <input
          value={draft.companyName}
          onChange={(e) => updateDraft({ companyName: e.target.value })}
          placeholder="예: 동부건설"
          className="h-12 w-full rounded-xl border border-line-2 bg-surface-2 px-3.5 text-[15px] text-text placeholder:text-text-3 focus:outline-none"
        />
      </div>

      <button
        disabled={!canSubmit}
        onClick={() => setConfirmOpen(true)}
        className="mx-4 mb-5 h-[52px] flex-none rounded-2xl bg-accent text-[17px] font-extrabold text-[#231a02] disabled:opacity-40"
      >
        승인 요청 보내기
      </button>

      {confirmOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(6,6,8,.66)] p-7">
          <div className="w-full max-w-[320px] rounded-2xl border border-line-2 bg-surface-3 p-5 text-center">
            <div className="text-[16px] font-extrabold leading-relaxed">
              한미글로벌 담당자에게 승인 요청을 보냈습니다
            </div>
            <button
              onClick={submitRegistration}
              className="mt-5 h-[46px] w-full rounded-xl bg-accent text-[15px] font-extrabold text-[#231a02]"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
