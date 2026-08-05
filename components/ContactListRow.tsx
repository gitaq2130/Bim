"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "lucide-react";
import ContactSummaryCard from "@/components/ContactSummaryCard";
import type { Contact } from "@/lib/types";

export default function ContactListRow({ contact: c }: { contact: Contact }) {
  const router = useRouter();
  const [menuTop, setMenuTop] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const startPress = (e: React.MouseEvent | React.TouchEvent) => {
    firedRef.current = false;
    const target = e.currentTarget as HTMLElement;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setMenuTop(target.getBoundingClientRect().bottom + 6);
    }, 450);
  };
  const cancelPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  return (
    <>
      <div
        onMouseDown={startPress}
        onMouseUp={cancelPress}
        onMouseLeave={cancelPress}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onClick={() => {
          if (firedRef.current) {
            firedRef.current = false;
            return;
          }
          router.push(`/profile?id=${c.id}`);
        }}
        className="flex min-h-[66px] items-center gap-3.5 px-4 py-[11px] active:bg-surface-2"
      >
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
          {c.company}
        </span>
      </div>
      {menuTop !== null && (
        <ContactSummaryCard contact={c} top={menuTop} onClose={() => setMenuTop(null)} />
      )}
    </>
  );
}
