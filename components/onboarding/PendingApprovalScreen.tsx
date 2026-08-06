"use client";

import { Hourglass } from "lucide-react";
import { useStore } from "@/lib/store";
import type { UserRegistration, UserRole } from "@/lib/types";

const ROLE_LABEL: Record<UserRole, string> = {
  owner: "발주처",
  hanmi: "한미글로벌",
  contractor: "시공사",
  subcontractor: "협력사",
};

export default function PendingApprovalScreen({
  registration,
}: {
  registration: UserRegistration;
}) {
  const cancelRegistration = useStore((s) => s.cancelRegistration);

  return (
    <div className="flex h-full flex-col items-center justify-between bg-bg px-8 py-16">
      <div />
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(255,214,10,.12)] text-accent">
          <Hourglass size={40} />
        </div>
        <div className="text-[22px] font-extrabold">승인 대기 중입니다</div>

        <div className="mt-2 w-full max-w-[280px] rounded-2xl border border-line bg-surface-2 p-4 text-left text-[13.5px]">
          <SummaryRow label="역할" value={ROLE_LABEL[registration.role]} />
          <SummaryRow label="현장" value={registration.siteName} />
          {registration.trade && <SummaryRow label="공종" value={registration.trade} />}
          {registration.process && <SummaryRow label="공정" value={registration.process} />}
          <SummaryRow label="업체명" value={registration.companyName ?? "-"} />
          <SummaryRow label="승인 요청 대상" value={registration.approvalTarget} last />
        </div>

        <div className="mt-1 text-[12.5px] leading-relaxed text-text-3">
          담당자가 승인하면 자동으로 이용하실 수 있습니다
        </div>
      </div>

      <button onClick={cancelRegistration} className="text-[13px] font-semibold text-text-3 underline">
        신청 취소
      </button>
    </div>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 ${last ? "" : "border-b border-line"}`}>
      <span className="text-text-3">{label}</span>
      <span className="font-bold text-text">{value}</span>
    </div>
  );
}
