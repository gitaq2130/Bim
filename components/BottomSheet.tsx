"use client";

import type { ReactNode } from "react";

export default function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="animate-scrim-in absolute inset-0 z-[60] mx-auto flex max-w-[480px] flex-col justify-end bg-[rgba(6,6,8,.6)]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up max-h-[85%] overflow-y-auto rounded-t-[24px] border-t border-line-2 bg-surface px-4 pb-7 pt-2.5"
      >
        <div className="mx-auto mb-3.5 mt-1.5 h-[5px] w-10 rounded-full bg-line-2" />
        {children}
      </div>
    </div>
  );
}
