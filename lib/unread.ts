import type { Message } from "./types";

const COUNTED_KINDS: Message["kind"][] = ["text", "photo", "file"];

export function computeUnreadCounts(
  messages: Message[],
  participantCount: number
): Map<string, number> {
  const relevant = messages.filter((m) => COUNTED_KINDS.includes(m.kind));
  const max = Math.max(0, participantCount - 1);
  const map = new Map<string, number>();
  relevant.forEach((m, i) => {
    const ratio = (i + 1) / relevant.length;
    map.set(m.id, Math.round(ratio * max));
  });
  return map;
}
