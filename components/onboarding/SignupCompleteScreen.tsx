"use client";

import { CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import type { UserRole } from "@/lib/types";

const ROLE_LABEL: Record<UserRole, string> = {
  owner: "발주처",
  hanmi: "한미글로벌",
  contractor: "시공사",
  subcontractor: "협력사",
};

export default function SignupCompleteScreen() {
  const draft = useStore((s) => s.onboardingDraft);
  const site = useStore((s) => (draft.siteId ? s.siteById(draft.siteId) : undefined));
  const submitRegistration = useStore((s) => s.submitRegistration);

  return (
    <div className="flex h-full flex-col items-center justify-between bg-bg px-8 py-16">
      <div />
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(34,197,94,.14)] text-st-done">
          <CheckCircle2 size={44} />
        </div>
        <div className="text-[22px] font-extrabold">가입이 완료되었습니다</div>
        <div className="mt-1 rounded-2xl border border-line bg-surface-2 px-5 py-4 text-[14px] font-semibold text-text-2">
          {draft.role && ROLE_LABEL[draft.role]} · {site?.name}
        </div>
      </div>
      <button
        onClick={submitRegistration}
        className="h-[56px] w-full rounded-2xl bg-accent text-[17px] font-extrabold text-[#231a02]"
      >
        시작하기
      </button>
    </div>
  );
}
