"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronLeft, MapPinned } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { useStore } from "@/lib/store";

const STRIPE = {
  backgroundImage:
    "repeating-linear-gradient(45deg,#24242c,#24242c 7px,#1c1c22 7px,#1c1c22 14px)",
};

type Filter = "전체" | "진행중" | "완료";

function AgendaListPageInner() {
  const roomId = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const room = useStore((s) => s.roomById(roomId));
  const allAgendas = useStore((s) => s.agendas);
  const agendas = useMemo(
    () => allAgendas.filter((a) => a.parentRoomId === roomId),
    [allAgendas, roomId]
  );
  const [filter, setFilter] = useState<Filter>("전체");

  const inProgress = agendas.filter((a) => !a.status.startsWith("완료")).length;
  const done = agendas.filter((a) => a.status.startsWith("완료")).length;
  const newThisWeek = agendas.filter(
    (a) => a.createdLabel.includes("오늘") || a.createdLabel.includes("방금")
  ).length;

  const filtered = useMemo(() => {
    if (filter === "전체") return agendas;
    if (filter === "진행중") return agendas.filter((a) => !a.status.startsWith("완료"));
    return agendas.filter((a) => a.status.startsWith("완료"));
  }, [agendas, filter]);

  if (!room) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[17px] font-extrabold">{room.name} · 안건 리스트</span>
        <span className="flex-1" />
        <button
          onClick={() => router.push(`/room/floorplan?id=${roomId}`)}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
        >
          <MapPinned size={22} />
        </button>
      </div>

      <div className="flex flex-none gap-2.5 p-4">
        <div className="flex-1 rounded-2xl border border-line bg-surface-2 px-3 py-3.5">
          <div className="text-[26px] font-extrabold leading-none text-st-action">{inProgress}</div>
          <div className="mt-1.5 text-[12px] font-semibold text-text-2">진행중</div>
        </div>
        <div className="flex-1 rounded-2xl border border-line bg-surface-2 px-3 py-3.5">
          <div className="text-[26px] font-extrabold leading-none text-st-done">{done}</div>
          <div className="mt-1.5 text-[12px] font-semibold text-text-2">완료</div>
        </div>
        <div className="flex-1 rounded-2xl border border-line bg-surface-2 px-3 py-3.5">
          <div className="text-[26px] font-extrabold leading-none">{newThisWeek}</div>
          <div className="mt-1.5 text-[12px] font-semibold text-text-2">이번 주 신규</div>
        </div>
      </div>

      <div className="flex flex-none gap-2 px-4 pb-3">
        {(["전체", "진행중", "완료"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex h-[34px] items-center rounded-full border px-4 text-[14px] font-semibold ${
              filter === f ? "border-text bg-text text-bg font-extrabold" : "border-line bg-surface-2 text-text-2"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map((a) => (
          <Link
            key={a.no}
            href={`/agenda?no=${a.no}`}
            className={`relative flex min-h-[78px] items-center gap-3 border-b border-white/[0.04] px-4 py-3.5 active:bg-surface-2 ${
              a.isDormant ? "border-l-[3px] border-l-st-review" : ""
            }`}
          >
            <div className="h-14 w-14 flex-none rounded-xl border border-line" style={STRIPE} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12px] font-bold text-text-3">#{a.no}</div>
              <div className="mt-0.5 truncate text-[15px] font-bold">{a.title}</div>
              <div className="mt-[7px] flex items-center gap-2">
                {a.isDormant ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-st-review">
                    <AlertTriangle size={13} />
                    {a.updatedLabel}
                  </span>
                ) : (
                  <span className="text-[12px] text-text-3">{a.updatedLabel}</span>
                )}
              </div>
            </div>
            <StatusBadge status={a.status} size="sm" />
          </Link>
        ))}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-[14px] text-text-3">해당하는 안건이 없습니다.</div>
        )}
      </div>
    </div>
  );
}

export default function AgendaListPage() {
  return (
    <Suspense>
      <AgendaListPageInner />
    </Suspense>
  );
}
