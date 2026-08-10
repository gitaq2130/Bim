"use client";

import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { searchDepartmentSuggestions } from "@/lib/departmentData";
import type { UserRole } from "@/lib/types";

const ROLE_LABEL: Record<UserRole, string> = {
  owner: "발주처",
  hanmi: "한미글로벌",
  contractor: "시공사",
  subcontractor: "협력사",
};

const SPECIALTIES = ["구조", "공정관리", "품질", "안전", "원가", "설계"];
const YEARS = Array.from({ length: 2026 - 1990 + 1 }, (_, i) => 2026 - i);

const INPUT_CLASS =
  "h-[54px] w-full rounded-[14px] border border-line bg-surface-2 px-4 text-[17px] font-bold text-text placeholder:text-text-3 placeholder:font-semibold focus:border-accent focus:outline-none";

function formatPhoneInput(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-[18px]">
      <div className="mb-[9px] text-[13px] font-bold text-text-2">{label}</div>
      {children}
    </div>
  );
}

export default function ProfileScreen({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const draft = useStore((s) => s.onboardingDraft);
  const updateDraft = useStore((s) => s.updateOnboardingDraft);
  const site = useStore((s) => (draft.siteId ? s.siteById(draft.siteId) : undefined));
  const parent = useStore((s) =>
    draft.parentContractorId ? s.contractors.find((c) => c.id === draft.parentContractorId) : undefined
  );
  const submitRegistration = useStore((s) => s.submitRegistration);
  const [deptFocused, setDeptFocused] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOwnerHanmi = draft.role === "owner" || draft.role === "hanmi";
  const isContractor = draft.role === "contractor";

  const tradeOrProcessLabel = isContractor ? draft.trade : draft.process;
  const tradeOrProcessKey = isContractor ? "공종" : "공정";

  const deptSuggestions = useMemo(() => searchDepartmentSuggestions(draft.dept), [draft.dept]);

  const canSubmit =
    draft.name.trim().length > 0 &&
    draft.title.trim().length > 0 &&
    draft.phone.trim().length > 0 &&
    (!isOwnerHanmi || draft.dept.trim().length > 0);

  const dialogTitle = isContractor
    ? "한미글로벌 담당자에게 승인 요청을 보냈습니다"
    : `${parent?.companyName ?? ""} 소장에게 승인 요청을 보냈습니다`;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (isOwnerHanmi) onNext();
    else setConfirmOpen(true);
  };

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[17px] font-extrabold">본인 정보 입력</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-[22px]">
        <div className="mb-4 text-[22px] font-extrabold leading-tight">본인 정보를 입력해주세요</div>

        <div className="mb-5 rounded-2xl border border-line bg-surface px-4">
          <div className="flex items-center gap-3 border-b border-line py-3">
            <span className="w-[76px] flex-none text-[13px] font-bold text-text-3">역할</span>
            <span className="flex-1 text-right text-[14px] font-bold">
              {draft.role ? ROLE_LABEL[draft.role] : "—"}
            </span>
          </div>
          <div className={`flex items-center gap-3 py-3 ${!isOwnerHanmi ? "border-b border-line" : ""}`}>
            <span className="w-[76px] flex-none text-[13px] font-bold text-text-3">현장</span>
            <span className="flex-1 text-right text-[14px] font-bold">{site?.name ?? "—"}</span>
          </div>
          {!isOwnerHanmi && (
            <div className="flex items-center gap-3 py-3">
              <span className="w-[76px] flex-none text-[13px] font-bold text-text-3">{tradeOrProcessKey}</span>
              <span className="flex-1 text-right text-[14px] font-bold">{tradeOrProcessLabel || "—"}</span>
            </div>
          )}
        </div>

        <Field label="성명">
          <input
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            placeholder="예) 홍길동"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="직급">
          <input
            value={draft.title}
            onChange={(e) => updateDraft({ title: e.target.value })}
            placeholder="예) 과장"
            className={INPUT_CLASS}
          />
        </Field>

        {isOwnerHanmi && (
          <Field label="소속 부서">
            <div className="relative">
              <input
                value={draft.dept}
                onChange={(e) => updateDraft({ dept: e.target.value })}
                onFocus={() => setDeptFocused(true)}
                onBlur={() => setDeptFocused(false)}
                placeholder="예) 공무"
                autoComplete="off"
                className={INPUT_CLASS}
              />
              {deptFocused && deptSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 overflow-hidden rounded-xl border border-line-2 bg-surface-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,.6)]">
                  {deptSuggestions.map((d) => (
                    <button
                      key={d}
                      onMouseDown={() => updateDraft({ dept: d })}
                      className="block w-full border-b border-line px-3.5 py-3 text-left text-[15px] font-semibold text-text-2 last:border-b-0 active:bg-surface-2 active:text-text"
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
        )}

        <Field label="휴대전화 번호">
          <input
            value={draft.phone}
            onChange={(e) => updateDraft({ phone: formatPhoneInput(e.target.value) })}
            placeholder="010-0000-0000"
            inputMode="numeric"
            type="tel"
            className={INPUT_CLASS}
          />
        </Field>

        <div className="my-6 flex items-center gap-3 text-[12px] font-bold text-text-3">
          <span className="h-px flex-1 bg-line" />
          선택 입력
          <span className="h-px flex-1 bg-line" />
        </div>

        <Field
          label={
            <>
              입사년도 <span className="font-semibold text-text-3">(선택)</span>
            </>
          }
        >
          <select
            value={draft.joinYear}
            onChange={(e) => updateDraft({ joinYear: e.target.value })}
            className="h-[54px] w-full appearance-none rounded-[14px] border border-line bg-surface-2 px-4 text-[16px] font-bold text-text focus:border-accent focus:outline-none"
          >
            <option value="">연도 선택</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={
            <>
              전문분야 <span className="font-semibold text-text-3">(선택)</span>
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {SPECIALTIES.map((s) => {
              const on = draft.specialties.includes(s);
              return (
                <button
                  key={s}
                  onClick={() =>
                    updateDraft({
                      specialties: on ? draft.specialties.filter((x) => x !== s) : [...draft.specialties, s],
                    })
                  }
                  className={`rounded-full border px-[13px] py-2 text-[13px] font-bold ${
                    on ? "border-accent text-text" : "border-line bg-surface-2 text-text-2"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      <button
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="mx-[18px] mb-[30px] h-14 flex-none rounded-2xl bg-accent text-[17px] font-extrabold text-[#1a1204] disabled:opacity-40"
      >
        {isOwnerHanmi ? "가입 완료" : "승인 요청 보내기"}
      </button>

      {confirmOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(6,6,8,.66)] p-7">
          <div className="w-full max-w-[320px] rounded-2xl border border-line-2 bg-surface-3 p-5 text-center">
            <div className="text-[16px] font-extrabold leading-relaxed">{dialogTitle}</div>
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
