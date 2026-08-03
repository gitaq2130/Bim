"use client";

import { ChevronDown } from "lucide-react";
import { STATUS_STYLES } from "@/lib/status";
import type { AgendaStatus } from "@/lib/types";

export default function StatusBadge({
  status,
  onClick,
  size = "md",
}: {
  status: AgendaStatus;
  onClick?: () => void;
  size?: "sm" | "md";
}) {
  const style = STATUS_STYLES[status];
  const Comp = onClick ? "button" : "span";

  return (
    <Comp
      onClick={onClick}
      style={{ color: style.text, background: style.bg, border: `1px solid ${style.border}` }}
      className={`inline-flex items-center gap-1 rounded-full font-extrabold ${
        size === "sm" ? "px-[10px] py-[3px] text-[11px]" : "px-3 py-1 text-[12px]"
      }`}
    >
      {status}
      {onClick && <ChevronDown size={13} />}
    </Comp>
  );
}
