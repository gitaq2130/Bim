"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pin } from "lucide-react";
import RoomContextMenu from "@/components/RoomContextMenu";
import RoomIcon from "@/components/RoomIcon";
import { useStore } from "@/lib/store";
import type { Room } from "@/lib/types";

export default function RoomListItem({ room }: { room: Room }) {
  const router = useRouter();
  const activeCount = useStore((s) => s.activeAgendaCount(room.id));
  const lastMessage = useStore((s) => s.roomPreviewText(room.id));
  const [menuTop, setMenuTop] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const startPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (room.type !== "trade") return;
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
          router.push(`/room?id=${room.id}`);
        }}
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
            {room.pinned && <Pin size={13} className="flex-none fill-text-3 text-text-3" />}
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
      </div>
      {menuTop !== null && (
        <RoomContextMenu room={room} top={menuTop} onClose={() => setMenuTop(null)} />
      )}
    </>
  );
}
