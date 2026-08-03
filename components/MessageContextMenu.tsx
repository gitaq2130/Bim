"use client";

import { Copy, Pin, Reply, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/types";

export default function MessageContextMenu({
  message,
  onClose,
}: {
  message: Message;
  onClose: () => void;
}) {
  const toggleDecisionBasis = useStore((s) => s.toggleDecisionBasis);

  const items = [
    { icon: Reply, label: "답장", onClick: onClose },
    { icon: Copy, label: "복사", onClick: onClose },
    {
      icon: Pin,
      label: message.isDecisionBasis ? "결정근거 태그 해제" : "결정근거로 태그",
      accent: true,
      onClick: () => {
        toggleDecisionBasis(message.id);
        onClose();
      },
    },
    { icon: Trash2, label: "삭제", danger: true, onClick: onClose },
  ];

  return (
    <div
      className="animate-scrim-in fixed inset-0 z-[60] mx-auto flex max-w-[480px] flex-col justify-center bg-[rgba(6,6,8,.68)] px-6"
      onClick={onClose}
    >
      <div className="animate-pop-in mb-3 max-w-[82%] self-start">
        <div className="rounded-2xl rounded-tl-[4px] bg-bubble-in px-3.5 py-[11px] text-[15px] leading-relaxed">
          {message.text}
        </div>
      </div>
      <div
        className="animate-pop-in w-[220px] self-start overflow-hidden rounded-2xl border border-line-2 bg-surface-3 shadow-[0_20px_50px_-10px_rgba(0,0,0,.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map(({ icon: Icon, label, onClick, danger, accent }) => (
          <button
            key={label}
            onClick={onClick}
            className={`flex w-full items-center gap-3 border-b border-line px-[18px] py-[15px] text-left text-[15px] font-semibold last:border-none active:bg-surface-2 ${
              danger ? "text-[#f2777a]" : "text-text"
            }`}
          >
            <Icon size={19} className={danger ? "text-[#f2777a]" : accent ? "text-accent" : "text-text-2"} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
