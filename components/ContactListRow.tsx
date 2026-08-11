"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Check, User } from "lucide-react";
import type { Contact } from "@/lib/types";

export interface ContactSelection {
  selected: boolean;
  disabled?: boolean;
  onToggle: (contact: Contact) => void;
}

export default function ContactListRow({
  contact: c,
  groupBy = "trade",
  onLongPress,
  selection,
}: {
  contact: Contact;
  groupBy?: "trade" | "company";
  onLongPress?: (contact: Contact, rowEl: HTMLElement) => void;
  /** 제공되면 프로필로 이동하는 대신 체크박스 선택 모드로 동작한다 (REV12 참여자 초대 화면). */
  selection?: ContactSelection;
}) {
  const router = useRouter();
  const badgeText =
    groupBy === "trade" ? c.company : [c.tradeGroup, c.trade].filter(Boolean).join(" · ");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const startPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (!onLongPress || selection) return;
    firedRef.current = false;
    const target = e.currentTarget as HTMLElement;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress(c, target);
    }, 450);
  };
  const cancelPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  return (
    <div
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onClick={() => {
        if (selection) {
          if (!selection.disabled) selection.onToggle(c);
          return;
        }
        if (firedRef.current) {
          firedRef.current = false;
          return;
        }
        router.push(`/profile?id=${c.id}`);
      }}
      className={`flex min-h-[66px] items-center gap-3.5 px-4 py-[11px] active:bg-surface-2 ${
        selection?.disabled ? "pointer-events-none opacity-40" : ""
      }`}
    >
      {selection && (
        <span
          className={`flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border-[1.5px] ${
            selection.selected ? "border-accent bg-accent text-[#1a1300]" : "border-line-2 text-transparent"
          }`}
        >
          <Check size={13} />
        </span>
      )}
      <div
        className={`flex h-[46px] w-[46px] flex-none items-center justify-center rounded-full bg-surface-3 text-text-2 ${
          c.bizCardRegistered ? "" : "opacity-40"
        }`}
      >
        <User size={23} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[7px]">
          <span className={`text-[15.5px] font-bold ${c.bizCardRegistered ? "" : "text-text-2"}`}>
            {c.name}
          </span>
          {!c.bizCardRegistered && (
            <span className="rounded-full border border-line bg-surface-3 px-2 py-[2px] text-[11px] font-bold text-text-3">
              명함 미등록
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[13px] text-text-3">
          {[c.rank, c.trade].filter(Boolean).join(" · ")}
        </div>
      </div>
      <span className="flex-none rounded-[7px] border border-line bg-surface-2 px-[9px] py-[3px] text-[11px] font-bold text-text-2">
        {badgeText}
      </span>
    </div>
  );
}
