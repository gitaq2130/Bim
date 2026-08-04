"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export default function EditableChip({
  icon: Icon,
  value,
  placeholder,
  onChange,
}: {
  icon: LucideIcon;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-surface-2 py-1 pl-3.5 pr-1.5">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          onBlur={commit}
          className="w-24 bg-transparent text-[14px] font-semibold text-text focus:outline-none"
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent text-[#1a1204]"
        >
          <Check size={14} />
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-3.5 py-2 text-[14px] font-semibold ${
        value ? "border-line-2 bg-surface-2 text-text-2" : "border-line-2 text-text-3"
      }`}
    >
      <Icon size={16} className="text-text-3" />
      {value || placeholder}
    </button>
  );
}
