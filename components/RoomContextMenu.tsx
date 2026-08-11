"use client";

import { useRouter } from "next/navigation";
import { Bell, BellOff, Info, Pin, PinOff, Star, UserPlus } from "lucide-react";
import { useStore } from "@/lib/store";
import RoomIcon from "./RoomIcon";
import type { Room } from "@/lib/types";

export default function RoomContextMenu({
  room,
  top,
  onClose,
}: {
  room: Room;
  top: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toggleRoomFavorite = useStore((s) => s.toggleRoomFavorite);
  const toggleRoomPinned = useStore((s) => s.toggleRoomPinned);
  const toggleRoomMuted = useStore((s) => s.toggleRoomMuted);

  const items = [
    { icon: Info, label: "채팅방 정보 설정", onClick: onClose },
    {
      icon: UserPlus,
      label: "참여자 초대",
      accent: false,
      onClick: () => {
        onClose();
        router.push(`/room/invite?id=${room.id}`);
      },
    },
    {
      icon: Star,
      label: room.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가",
      accent: !!room.favorite,
      onClick: () => {
        toggleRoomFavorite(room.id);
        onClose();
      },
    },
    {
      icon: room.pinned ? PinOff : Pin,
      label: room.pinned ? "상단 고정 해제" : "상단 고정",
      accent: false,
      onClick: () => {
        toggleRoomPinned(room.id);
        onClose();
      },
    },
    {
      icon: room.muted ? BellOff : Bell,
      label: room.muted ? "알림 켜기" : "알림 끄기",
      accent: false,
      onClick: () => {
        toggleRoomMuted(room.id);
        onClose();
      },
    },
  ];

  return (
    <div className="absolute inset-0 z-[70] bg-[rgba(6,6,8,.6)]" onClick={onClose}>
      <div
        style={{ top }}
        className="animate-pop-in absolute inset-x-4 z-[71] max-h-[calc(100%-24px)] overflow-y-auto rounded-2xl border border-line-2 bg-surface-3 shadow-[0_20px_50px_-10px_rgba(0,0,0,.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-surface-2 text-text-2">
            <RoomIcon name={room.icon} size={18} />
          </div>
          <span className="text-[15px] font-extrabold">{room.name}</span>
        </div>
        {items.map(({ icon: Icon, label, onClick, accent }) => (
          <button
            key={label}
            onClick={onClick}
            className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left text-[15px] font-semibold last:border-none active:bg-surface-2"
          >
            <Icon size={18} className={accent ? "fill-accent text-accent" : "text-text-2"} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
