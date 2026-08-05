"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Settings2 } from "lucide-react";
import RoomListItem from "@/components/RoomListItem";
import SearchReveal from "@/components/SearchReveal";
import { useStore } from "@/lib/store";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

export default function HomePage() {
  const router = useRouter();
  const rooms = useStore((s) => s.rooms);
  const roomPreviewText = useStore((s) => s.roomPreviewText);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const q = debouncedQuery.trim().toLowerCase();

  const filteredRooms = q
    ? rooms.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          roomPreviewText(r.id).toLowerCase().includes(q)
      )
    : rooms;

  const pinnedRooms = filteredRooms.filter((r) => r.pinned);
  const unpinnedRooms = filteredRooms.filter((r) => !r.pinned);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2 pl-[18px]">
        <span className="text-[20px] font-extrabold tracking-tight">채팅</span>
        <span className="flex-1" />
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
        >
          <Search size={22} />
        </button>
        <button
          onClick={() => router.push("/mypage")}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
        >
          <Settings2 size={22} />
        </button>
      </div>

      <SearchReveal
        open={searchOpen}
        value={query}
        onChange={setQuery}
        placeholder="채팅방 검색"
        onClose={closeSearch}
      />

      {q && filteredRooms.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[14px] text-text-3">
          검색 결과가 없습니다
        </div>
      ) : (
        <div>
          {pinnedRooms.length > 0 && (
            <>
              <div className="px-4 pb-1.5 pt-3 text-[12px] font-extrabold text-text-2">
                고정된 채팅방
              </div>
              {pinnedRooms.map((room) => (
                <RoomListItem key={room.id} room={room} />
              ))}
              <div className="h-2 border-b border-line bg-surface" />
            </>
          )}
          {unpinnedRooms.map((room) => (
            <RoomListItem key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}
