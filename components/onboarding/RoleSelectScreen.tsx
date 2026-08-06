"use client";

import { Briefcase, ChevronLeft, HardHat, Landmark, Users2 } from "lucide-react";
import type { UserRole } from "@/lib/types";

const ROLES: { role: UserRole; label: string; desc: string; icon: typeof Landmark }[] = [
  { role: "owner", label: "발주처", desc: "프로젝트를 발주한 소유주", icon: Landmark },
  { role: "hanmi", label: "한미글로벌", desc: "PM·CM 관리사", icon: Briefcase },
  { role: "contractor", label: "시공사", desc: "건축·전기·통신·소방 원청사", icon: HardHat },
  { role: "subcontractor", label: "협력사", desc: "시공사 하위 전문업체", icon: Users2 },
];

export default function RoleSelectScreen({
  selected,
  onSelect,
  onBack,
}: {
  selected: UserRole | null;
  onSelect: (role: UserRole) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
      </div>
      <div className="px-6 pb-6 pt-2">
        <div className="text-[22px] font-extrabold">당신은 누구신가요?</div>
        <div className="mt-1.5 text-[14px] text-text-2">역할에 맞는 절차로 안내해드릴게요</div>
      </div>
      <div className="flex flex-col gap-3 px-5">
        {ROLES.map(({ role, label, desc, icon: Icon }) => {
          const active = selected === role;
          return (
            <button
              key={role}
              onClick={() => onSelect(role)}
              className={`flex items-center gap-3.5 rounded-2xl border-2 bg-surface-2 p-4 text-left ${
                active ? "border-accent" : "border-line"
              }`}
            >
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-surface-3 text-text-2">
                <Icon size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-extrabold">{label}</div>
                <div className="mt-0.5 text-[13px] text-text-2">{desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
