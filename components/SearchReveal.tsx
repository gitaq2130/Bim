"use client";

import { Search, X } from "lucide-react";

export default function SearchReveal({
  open,
  value,
  onChange,
  placeholder,
  onClose,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="animate-slide-down flex-none overflow-hidden border-b border-line bg-surface">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex h-11 flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3.5">
          <Search size={17} className="flex-none text-text-3" />
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full min-w-0 bg-transparent text-[14px] text-text placeholder:text-text-3 focus:outline-none"
          />
        </div>
        <button
          onClick={onClose}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
