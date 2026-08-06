"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";

const PROCESS_SUGGESTIONS = ["철근콘크리트", "철골", "외장판넬", "토공", "미장"];

export default function SubcontractorSubmitScreen({ onBack }: { onBack: () => void }) {
  const draft = useStore((s) => s.onboardingDraft);
  const updateDraft = useStore((s) => s.updateOnboardingDraft);
  const site = useStore((s) => (draft.siteId ? s.siteById(draft.siteId) : undefined));
  const parent = useStore((s) =>
    draft.parentContractorId ? s.contractors.find((c) => c.id === draft.parentContractorId) : undefined
  );
  const submitRegistration = useStore((s) => s.submitRegistration);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSubmit = draft.process.trim().length > 0 && draft.companyName.trim().length > 0;

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
      </div>

      <div className="px-6 pb-2 pt-2">
        <div className="text-[22px] font-extrabold">소속 공정을 입력하세요</div>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] font-bold text-text-2">
          {site?.name} · {parent?.companyName}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
        <div className="mb-1.5 text-[12px] font-bold text-text-3">공정명</div>
        <input
          value={draft.process}
          onChange={(e) => updateDraft({ process: e.target.value })}
          placeholder="예: 철근콘크리트"
          className="h-12 w-full rounded-xl border border-line-2 bg-surface-2 px-3.5 text-[15px] text-text placeholder:text-text-3 focus:outline-none"
        />
        <div className="mt-2.5 flex flex-wrap gap-2">
          {PROCESS_SUGGESTIONS.map((p) => (
            <button
              key={p}
              onClick={() => updateDraft({ process: p })}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
                draft.process === p
                  ? "border-accent bg-[rgba(255,214,10,.1)] text-accent"
                  : "border-line bg-surface-2 text-text-2"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mb-1.5 mt-5 text-[12px] font-bold text-text-3">업체명</div>
        <input
          value={draft.companyName}
          onChange={(e) => updateDraft({ companyName: e.target.value })}
          placeholder="예: 한양기공"
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
              {parent?.companyName} 소장에게 승인 요청을 보냈습니다
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
