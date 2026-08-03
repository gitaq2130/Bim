"use client";

import Link from "next/link";
import RoomIcon from "@/components/RoomIcon";
import { useStore } from "@/lib/store";
import type { Room } from "@/lib/types";

export default function RoomListItem({ room }: { room: Room }) {
  const activeCount = useStore((s) => s.activeAgendaCount(room.id));
  const lastMessage = useStore((s) => {
    const msgs = s.roomMessages(room.id).filter((m) => m.kind !== "system");
    const last = msgs[msgs.length - 1];
    if (!last) return "";
    if (last.kind === "text") return `${last.sender ? last.sender + ": " : ""}${last.text}`;
    if (last.kind === "photo") return "사진을 보냈습니다";
    if (last.kind === "file") return `파일: ${last.fileName}`;
    if (last.kind === "agenda-card") return "안건이 등록되었습니다";
    return "";
  });
  return (
    <Link
      href={`/room?id=${room.id}`}
      className="flex min-h-[76px] items-center gap-3.5 border-b border-white/[0.03] px-4 py-3.5 active:bg-surface-2"
    >
      <div className="relative flex h-[52px] w-[52px] flex-none items-center justify-center rounded-2xl bg-surface-3 text-text-2">
        <RoomIcon name={room.icon} size={26} />
        {room.memberCount && room.type !== "dm" ? (
          <span className="absolute -bottom-1 -right-1 rounded-lg border border-line bg-surface px-[5px] py-[2px] text-[10px] font-bold text-text-2">
            {room.memberCount}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[16px] font-bold">{room.name}</span>
        </div>
        <div className="mt-[3px] max-w-[210px] overflow-hidden text-ellipsis whitespace-nowrap text-[14px] text-text-2">
          {lastMessage}
        </div>
        {activeCount > 0 && (
          <span className="mt-2 inline-flex items-center gap-[5px] rounded-full border border-st-review/30 bg-st-review/10 px-[9px] py-[3px] text-[12px] font-bold text-st-review">
            <span className="h-1.5 w-1.5 rounded-full bg-st-review" />
            진행중 안건 {activeCount}건
          </span>
        )}
      </div>
      <div className="flex flex-none flex-col items-end gap-2">
        <span className="text-[12px] text-text-3">{room.time}</span>
        {room.unread ? (
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-unread px-[6px] text-[12px] font-extrabold text-white">
            {room.unread}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
