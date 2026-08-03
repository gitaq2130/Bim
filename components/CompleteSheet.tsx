"use client";

import { useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  Check,
  Coins,
  Gem,
  MessageSquareWarning,
  Repeat,
  ShieldCheck,
  User,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { useStore } from "@/lib/store";

const PRIORITIES = [
  { key: "공기", icon: CalendarClock },
  { key: "원가", icon: Coins },
  { key: "품질", icon: BadgeCheck },
  { key: "안전", icon: ShieldCheck },
];

export default function CompleteSheet({
  open,
  onClose,
  agendaNo,
}: {
  open: boolean;
  onClose: () => void;
  agendaNo: number;
}) {
  const agenda = useStore((s) => s.agendaByNo(agendaNo));
  const submitCompleteForm = useStore((s) => s.submitCompleteForm);

  const [hasDisagreement, setHasDisagreement] = useState<boolean | null>(null);
  const [disagreeParties, setDisagreeParties] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);

  if (!agenda) return null;

  const reactionCount = agenda.completeForm?.reactionCount ?? 1;
  const highValue = agenda.completeForm?.highValue ?? reactionCount >= 2;
  const participants = agenda.participantNames ?? ["현장소장", "품질팀장", "시공팀장"];

  const toggleParty = (name: string) =>
    setDisagreeParties((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );

  const togglePriority = (key: string) =>
    setPriorities((prev) => {
      if (prev.includes(key)) return prev.filter((p) => p !== key);
      if (prev.length >= 2) return prev;
      return [...prev, key];
    });

  const skippedSomething = hasDisagreement === null || priorities.length === 0;

  const submit = () => {
    submitCompleteForm(agendaNo, { hasDisagreement, disagreeParties, priorities });
    setHasDisagreement(null);
    setDisagreeParties([]);
    setPriorities([]);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-1 text-[19px] font-extrabold">안건을 완료 처리합니다</div>
      <div className="px-1 pb-4 pt-0.5 text-[13px] text-text-2">{agenda.title}</div>

      <div className="mb-4">
        <div className="mb-2.5 flex items-center gap-2 text-[13px] font-extrabold text-text-2">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line-2 bg-surface-3 text-[11px] font-extrabold text-text">
            1
          </span>
          조치 이력
          <span className="ml-auto text-[11px] font-semibold text-text-3">자동 감지</span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3.5">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-surface-3 text-text-2">
            <Repeat size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold">
              {reactionCount >= 2 ? `재조치 ${reactionCount}회 발생` : "1회 조치로 완료"}
            </div>
            <div className="mt-0.5 text-[12px] text-text-3">
              {reactionCount >= 2 ? "보완 → 재검측 → 재배근" : "최초 조치로 문제 해결"}
            </div>
          </div>
          {highValue && (
            <span className="ml-auto flex flex-none items-center gap-1 rounded-full border border-[rgba(34,197,94,.4)] bg-[rgba(34,197,94,.15)] px-[11px] py-[5px] text-[12px] font-extrabold text-[#8bea9f]">
              <Gem size={13} />
              사례 가치 높음
            </span>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-2.5 flex items-center gap-2 text-[13px] font-extrabold text-text-2">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line-2 bg-surface-3 text-[11px] font-extrabold text-text">
            2
          </span>
          이견 여부
        </div>
        <div className="px-0.5 pb-2.5 text-[15px] font-bold">검토 과정에서 전문가 간 이견이 있었나요?</div>
        <div className="flex gap-2.5">
          <button
            onClick={() => setHasDisagreement(true)}
            className={`flex h-14 flex-1 items-center justify-center gap-1.5 rounded-2xl border text-[16px] font-bold ${
              hasDisagreement === true
                ? "border-st-action bg-[rgba(59,130,246,.14)] text-[#bcd7ff]"
                : "border-line bg-surface-2 text-text"
            }`}
          >
            <MessageSquareWarning size={18} />
            있었음
          </button>
          <button
            onClick={() => setHasDisagreement(false)}
            className={`h-14 flex-1 rounded-2xl border text-[16px] font-bold ${
              hasDisagreement === false
                ? "border-st-action bg-[rgba(59,130,246,.14)] text-[#bcd7ff]"
                : "border-line bg-surface-2 text-text"
            }`}
          >
            없었음
          </button>
        </div>

        {hasDisagreement === true && (
          <div className="mt-3 rounded-2xl border border-dashed border-line-2 bg-surface p-3.5">
            <div className="mb-2.5 text-[11px] font-semibold leading-relaxed text-text-3">
              이견 기록은 판단 기준을 후배에게 전달하는 자료가 됩니다 · 선택사항, 건너뛰기 가능
            </div>
            <div className="flex flex-col gap-2">
              {participants.map((name) => {
                const on = disagreeParties.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleParty(name)}
                    className={`flex items-center gap-2.5 rounded-[11px] border px-3 py-2.5 ${
                      on ? "border-st-action bg-[rgba(59,130,246,.1)]" : "border-line bg-surface-2"
                    }`}
                  >
                    <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-surface-3 text-text-3">
                      <User size={16} />
                    </span>
                    <span className="flex-1 text-left text-[14px] font-semibold">{name}</span>
                    <span
                      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] border ${
                        on ? "border-st-action bg-st-action text-white" : "border-line-2 text-transparent"
                      }`}
                    >
                      <Check size={14} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mb-2">
        <div className="mb-2.5 flex items-center gap-2 text-[13px] font-extrabold text-text-2">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line-2 bg-surface-3 text-[11px] font-extrabold text-text">
            3
          </span>
          우선 판단
          <span className="ml-auto text-[11px] font-semibold text-text-3">최대 2개 선택</span>
        </div>
        <div className="px-0.5 pb-2.5 text-[15px] font-bold">이 결정에서 우선한 것은?</div>
        <div className="grid grid-cols-2 gap-2.5">
          {PRIORITIES.map(({ key, icon: Icon }) => {
            const on = priorities.includes(key);
            return (
              <button
                key={key}
                onClick={() => togglePriority(key)}
                className={`flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border ${
                  on ? "border-accent bg-[rgba(255,214,10,.1)] text-text" : "border-line bg-surface-2 text-text-2"
                }`}
              >
                <Icon size={24} className={on ? "text-accent" : ""} />
                <span className="text-[14px] font-bold">{key}</span>
              </button>
            );
          })}
        </div>
      </div>

      {skippedSomething && (
        <div className="my-2 text-center text-[12px] font-semibold text-st-review">
          일부 항목이 비어 있습니다
        </div>
      )}
      <button
        onClick={submit}
        className="mt-1 h-[52px] w-full rounded-2xl bg-st-done text-[17px] font-extrabold text-[#08210f]"
      >
        완료 처리
      </button>
    </BottomSheet>
  );
}
