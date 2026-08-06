"use client";

import { useRef, useState } from "react";
import { FileText, Pin, User } from "lucide-react";
import AgendaCard from "./AgendaCard";
import TechCaseCard from "./TechCaseCard";
import MessageContextMenu from "./MessageContextMenu";
import type { Message } from "@/lib/types";

const STRIPE = {
  backgroundImage:
    "repeating-linear-gradient(45deg,#22222a,#22222a 8px,#1b1b21 8px,#1b1b21 16px)",
};

export default function MessageItem({
  message,
  interactive = false,
  matched = false,
  current = false,
  msgRef,
  unreadCount = 0,
}: {
  message: Message;
  interactive?: boolean;
  matched?: boolean;
  current?: boolean;
  msgRef?: (el: HTMLDivElement | null) => void;
  unreadCount?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPress = () => {
    if (!interactive || message.kind !== "text") return;
    timer.current = setTimeout(() => setMenuOpen(true), 450);
  };
  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  if (message.kind === "system") {
    return (
      <div className="my-0.5 self-center rounded-full bg-surface-2 px-3 py-1 text-[12px] text-text-3">
        {message.text}
      </div>
    );
  }

  if (message.kind === "agenda-card") {
    return <AgendaCard agendaNo={message.agendaNo!} />;
  }

  if (message.kind === "tech-case") {
    return <TechCaseCard agendaNo={message.agendaNo!} />;
  }

  const outgoing = message.outgoing;

  return (
    <div
      ref={msgRef}
      className={`flex max-w-[82%] gap-2.5 ${outgoing ? "flex-row-reverse self-end" : "self-start"}`}
    >
      {!outgoing && (
        <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl bg-surface-3 text-text-2">
          <User size={20} />
        </div>
      )}
      <div className={`flex min-w-0 flex-col gap-1 ${outgoing ? "items-end" : ""}`}>
        {!outgoing && message.sender && (
          <span className="ml-0.5 text-[12px] font-semibold text-text-2">{message.sender}</span>
        )}

        {message.kind === "text" && (
          <div className="relative">
            <div
              onMouseDown={startPress}
              onMouseUp={cancelPress}
              onMouseLeave={cancelPress}
              onTouchStart={startPress}
              onTouchEnd={cancelPress}
              className={`select-none rounded-2xl px-3.5 py-[11px] text-[15px] leading-relaxed ${
                outgoing
                  ? "rounded-tr-[4px] bg-bubble-out"
                  : "rounded-tl-[4px] bg-bubble-in"
              } ${
                message.isDecisionBasis
                  ? "rounded-l-[4px]! border-l-[3px] border-accent bg-[rgba(245,166,35,.06)]"
                  : ""
              } ${matched ? "outline outline-2 outline-offset-2 outline-[#f59e0b]" : ""} ${
                current ? "bg-[rgba(245,158,11,.28)]!" : ""
              }`}
            >
              {message.text}
            </div>
            {message.isDecisionBasis && (
              <span className="mt-1 flex items-center gap-1 text-[11px] font-extrabold text-accent">
                <Pin size={12} />
                결정근거
              </span>
            )}
          </div>
        )}

        {message.kind === "photo" && (
          <div
            className="flex h-[130px] w-[180px] items-end rounded-xl border border-line p-2"
            style={STRIPE}
          >
            <span className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
              {message.photoLabel}
            </span>
          </div>
        )}

        {message.kind === "file" && (
          <div className="flex w-[230px] items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-surface-3 text-text-2">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{message.fileName}</div>
              <div className="mt-0.5 text-[12px] text-text-3">{message.fileSize}</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 self-end">
          {unreadCount > 0 && (
            <span className="text-[11px] font-extrabold text-[#ffd60a]">{unreadCount}</span>
          )}
          <span className="text-[11px] text-text-3">{message.time}</span>
        </div>
      </div>

      {menuOpen && (
        <MessageContextMenu message={message} onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}
