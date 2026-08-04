"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ClipboardList, Menu, Search } from "lucide-react";
import ChatInput from "@/components/ChatInput";
import MessageItem from "@/components/MessageItem";
import RoomIcon from "@/components/RoomIcon";
import SearchReveal from "@/components/SearchReveal";
import { useStore } from "@/lib/store";
import { useAutoScrollToBottom } from "@/lib/useAutoScroll";

function RoomPageInner() {
  const roomId = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const room = useStore((s) => s.roomById(roomId));
  const allMessages = useStore((s) => s.messages);
  const messages = useMemo(
    () => allMessages.filter((m) => m.roomId === roomId),
    [allMessages, roomId]
  );
  const activeCount = useStore((s) => s.activeAgendaCount(roomId));
  const scrollRef = useAutoScrollToBottom(messages.length);
  const [searchOpen, setSearchOpen] = useState(false);

  if (!room) {
    return (
      <div className="flex h-full items-center justify-center text-text-2">
        존재하지 않는 채팅방입니다.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2 pl-1">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <RoomIcon name={room.icon} size={18} className="text-text-3" />
        <span className="text-[20px] font-extrabold tracking-tight">{room.name}</span>
        {room.memberCount && <span className="ml-0.5 text-[13px] font-semibold text-text-2">{room.memberCount}</span>}
        <span className="flex-1" />
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
        >
          <Search size={22} />
        </button>
        {activeCount > 0 || room.type === "trade" ? (
          <Link
            href={`/room/agenda-list?id=${roomId}`}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
          >
            <Menu size={22} />
          </Link>
        ) : null}
      </div>

      <SearchReveal open={searchOpen} placeholder="대화 내용 검색" onClose={() => setSearchOpen(false)} />

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-bg px-3.5 pb-2 pt-4 [&>*]:shrink-0"
      >
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
        {messages.length === 0 && (
          <div className="mt-10 flex flex-col items-center gap-2 text-text-3">
            <ClipboardList size={28} />
            <span className="text-[14px]">대화를 시작해보세요</span>
          </div>
        )}
      </div>

      <ChatInput roomId={roomId} />
    </div>
  );
}

export default function RoomPage() {
  return (
    <Suspense>
      <RoomPageInner />
    </Suspense>
  );
}
