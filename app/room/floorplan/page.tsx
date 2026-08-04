"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  LocateFixed,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { useStore } from "@/lib/store";
import { PIN_CATEGORY_COLOR, statusToPinCategory, type PinCategory } from "@/lib/status";
import type { Agenda } from "@/lib/types";

const FLOOR_LABELS: Record<string, string> = {
  "room-arch": "A동 3층",
  "room-civil": "토목 A구역",
  "room-mep": "B동 지하 1층",
};

const CATEGORY_ICON: Record<PinCategory, typeof Check> = {
  review: AlertCircle,
  action: Wrench,
  done: Check,
  pre: ShieldAlert,
};

const LEGEND: { category: PinCategory; label: string }[] = [
  { category: "review", label: "검토중" },
  { category: "action", label: "조치중" },
  { category: "done", label: "완료" },
  { category: "pre", label: "사전검토" },
];

interface PinGroup {
  x: number;
  y: number;
  agendas: Agenda[];
}

const STRIPE_TH = {
  backgroundImage:
    "repeating-linear-gradient(45deg,#24242c,#24242c 7px,#1c1c22 7px,#1c1c22 14px)",
};

function FloorplanPageInner() {
  const roomId = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const room = useStore((s) => s.roomById(roomId));
  const allAgendas = useStore((s) => s.agendas);
  const [selected, setSelected] = useState<PinGroup | null>(null);

  const groups = useMemo<PinGroup[]>(() => {
    const map = new Map<string, PinGroup>();
    for (const a of allAgendas) {
      if (a.parentRoomId !== roomId || !a.pin) continue;
      const key = `${a.pin.x},${a.pin.y}`;
      const existing = map.get(key);
      if (existing) existing.agendas.push(a);
      else map.set(key, { x: a.pin.x, y: a.pin.y, agendas: [a] });
    }
    return Array.from(map.values());
  }, [allAgendas, roomId]);

  if (!room) return null;

  const floorLabel = FLOOR_LABELS[roomId] ?? room.name;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <span className="text-[17px] font-extrabold">{floorLabel} · 안건 위치</span>
        <span className="flex-1" />
        <button className="mr-1 flex h-[38px] items-center gap-[5px] rounded-[10px] border border-line-2 bg-surface-2 px-[13px] text-[14px] font-bold text-text">
          {floorLabel}
          <ChevronDown size={16} className="text-text-2" />
        </button>
      </div>

      <div
        onClick={() => setSelected(null)}
        className="relative flex-1 overflow-hidden bg-[#111318]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#181a20,#181a20 1px,transparent 1px,transparent 42px),repeating-linear-gradient(90deg,#181a20,#181a20 1px,transparent 1px,transparent 42px)",
        }}
      >
        <span className="absolute left-3.5 top-3 rounded-[5px] bg-black/50 px-[9px] py-1 font-mono text-[11px] text-text-3">
          {floorLabel} 평면도 · Rev.05 (최신 승인)
        </span>
        <div className="absolute inset-x-[30px] inset-y-[80px] rounded-[3px] border-2 border-[#2f333d]" />
        <div className="absolute left-[30px] top-[80px] h-[180px] w-[150px] rounded-[3px] border-2 border-[#2f333d]" />
        <div className="absolute right-[30px] top-[200px] h-[calc(100%-290px)] w-[130px] rounded-[3px] border-2 border-[#2f333d]" />

        {groups.map((g) => {
          const isCluster = g.agendas.length > 1;
          const a = g.agendas[0];
          const category = statusToPinCategory(a.status);
          const Icon = CATEGORY_ICON[category];
          const isSelected = selected?.x === g.x && selected?.y === g.y;

          return (
            <button
              key={`${g.x},${g.y}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(isSelected ? null : g);
              }}
              className="absolute z-[5] -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${g.x}%`, top: `${g.y}%` }}
            >
              {isCluster ? (
                <div className="relative flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-bg bg-surface-3 text-[15px] font-extrabold text-text shadow-[0_3px_8px_rgba(0,0,0,.6)]">
                  <div className="absolute -inset-1 rounded-full border-2 border-line-2" />
                  {g.agendas.length}
                </div>
              ) : (
                <div
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[3px] border-bg text-[#0d0e11] shadow-[0_3px_8px_rgba(0,0,0,.6)]"
                  style={{ background: PIN_CATEGORY_COLOR[category] }}
                >
                  <Icon size={14} />
                </div>
              )}
            </button>
          );
        })}

        {selected && selected.agendas.length === 1 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute z-10 w-[200px] rounded-[14px] border border-line-2 bg-[rgba(30,32,39,.97)] p-3 shadow-[0_12px_30px_-8px_rgba(0,0,0,.8)] backdrop-blur-md"
            style={{ left: `${selected.x}%`, top: `${selected.y}%`, transform: "translate(-50%, calc(-100% - 20px))" }}
          >
            <div className="absolute -bottom-[6px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-line-2 bg-[rgba(30,32,39,.97)]" />
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="font-mono text-[12px] font-bold text-text-3">
                안건 #{selected.agendas[0].no}
              </span>
              <span className="ml-auto">
                <StatusBadge status={selected.agendas[0].status} size="sm" />
              </span>
            </div>
            <div className="text-[13.5px] font-bold leading-snug">{selected.agendas[0].title}</div>
            <button
              onClick={() => router.push(`/agenda?no=${selected.agendas[0].no}`)}
              className="mt-2.5 flex items-center gap-1 text-[12.5px] font-bold text-accent"
            >
              자세히 보기
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelected(null);
          }}
          className="absolute bottom-[74px] right-4 z-[8] flex h-12 w-12 items-center justify-center rounded-[14px] border border-line-2 bg-surface text-text shadow-[0_6px_16px_rgba(0,0,0,.5)]"
        >
          <LocateFixed size={22} />
        </button>

        {selected && selected.agendas.length > 1 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 z-20 rounded-t-[22px] border-t border-line-2 bg-surface pb-3.5 pt-2.5 shadow-[0_-12px_30px_rgba(0,0,0,.5)]"
          >
            <div className="mx-auto mb-2 h-[5px] w-10 rounded-full bg-line-2" />
            <div className="px-4 pb-2.5 text-[13px] font-extrabold text-text-2">
              이 위치의 안건 {selected.agendas.length}건
            </div>
            {selected.agendas.map((a) => (
              <button
                key={a.no}
                onClick={() => router.push(`/agenda?no=${a.no}`)}
                className="flex w-full items-center gap-2.5 px-4 py-[11px] text-left active:bg-surface-2"
              >
                <span className="h-10 w-10 flex-none rounded-[10px] border border-line" style={STRIPE_TH} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] font-bold text-text-3">#{a.no}</div>
                  <div className="truncate text-[14px] font-semibold">{a.title}</div>
                </div>
                <span className="flex-none">
                  <StatusBadge status={a.status} size="sm" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-none items-center justify-center gap-4 border-t border-line bg-surface p-3">
        {LEGEND.map(({ category, label }) => (
          <span key={category} className="flex items-center gap-1.5 text-[12px] font-semibold text-text-2">
            <span
              className="h-[11px] w-[11px] rounded-full"
              style={{ background: PIN_CATEGORY_COLOR[category] }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function FloorplanPage() {
  return (
    <Suspense>
      <FloorplanPageInner />
    </Suspense>
  );
}
