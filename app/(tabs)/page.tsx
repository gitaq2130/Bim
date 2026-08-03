"use client";

import { Search, Settings2 } from "lucide-react";
import RoomListItem from "@/components/RoomListItem";
import { useStore } from "@/lib/store";

export default function HomePage() {
  const rooms = useStore((s) => s.rooms);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2 pl-[18px]">
        <span className="text-[20px] font-extrabold tracking-tight">채팅</span>
        <span className="flex-1" />
        <button className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2">
          <Search size={22} />
        </button>
        <button className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2">
          <Settings2 size={22} />
        </button>
      </div>

      <div className="px-4 pb-1.5 pt-3">
        <div className="flex h-11 items-center gap-2 rounded-xl bg-surface-2 px-3.5 text-[15px] text-text-3">
          <Search size={18} />
          채팅방 검색
        </div>
      </div>

      <div>
        {rooms.map((room) => (
          <RoomListItem key={room.id} room={room} />
        ))}
      </div>
    </div>
  );
}
