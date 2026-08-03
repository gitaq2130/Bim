import type { AgendaStatus } from "./types";

export const STATUS_STYLES: Record<
  AgendaStatus,
  { text: string; bg: string; border: string }
> = {
  사전검토: {
    text: "#c4b5fd",
    bg: "rgba(139,92,246,.16)",
    border: "rgba(139,92,246,.42)",
  },
  검토중: {
    text: "#ffcf7a",
    bg: "rgba(245,158,11,.16)",
    border: "rgba(245,158,11,.4)",
  },
  조치중: {
    text: "#9cc4ff",
    bg: "rgba(59,130,246,.16)",
    border: "rgba(59,130,246,.4)",
  },
  완료: {
    text: "#8bea9f",
    bg: "rgba(34,197,94,.16)",
    border: "rgba(34,197,94,.4)",
  },
  "완료·관찰중": {
    text: "#7dd3fc",
    bg: "rgba(14,165,233,.16)",
    border: "rgba(14,165,233,.42)",
  },
  "완료·검증됨": {
    text: "#8bea9f",
    bg: "rgba(34,197,94,.18)",
    border: "rgba(34,197,94,.5)",
  },
};

export const STATUS_CYCLE: AgendaStatus[] = ["검토중", "조치중", "완료"];
