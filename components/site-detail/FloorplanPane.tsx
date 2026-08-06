"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import ZoneInfoCard from "./ZoneInfoCard";
import { shiftKoreanDate, weekdayKo } from "@/lib/koreanDate";
import { useStore } from "@/lib/store";
import type { Site, Zone, ZoneLayer } from "@/lib/types";

export default function FloorplanPane({ site }: { site: Site }) {
  const router = useRouter();
  const allZones = useStore((s) => s.zones);
  const [date, setDate] = useState(site.asOfDate ?? "2026. 8. 6");
  const [layers, setLayers] = useState<Record<ZoneLayer, boolean>>({ stack: true, work: true });
  const [selected, setSelected] = useState<Zone | null>(null);

  const zones = useMemo(
    () => allZones.filter((z) => z.siteId === site.id && z.date === date),
    [allZones, site.id, date]
  );

  const planLabel = `${site.name.replace(" 신축공사", "")} 배치도 · A~C동`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-center gap-4 border-b border-line bg-surface px-3 py-2.5">
        <button
          onClick={() => {
            setDate((d) => shiftKoreanDate(d, -1));
            setSelected(null);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-2 active:bg-surface-2"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="flex items-center gap-1.5 text-[14px] font-bold text-text">
          <Calendar size={15} className="text-text-3" />
          {date} ({weekdayKo(date)})
        </span>
        <button
          onClick={() => {
            setDate((d) => shiftKoreanDate(d, 1));
            setSelected(null);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-2 active:bg-surface-2"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-[#111318]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#181a20,#181a20 1px,transparent 1px,transparent 42px),repeating-linear-gradient(90deg,#181a20,#181a20 1px,transparent 1px,transparent 42px)",
        }}
        onClick={() => setSelected(null)}
      >
        <span className="absolute left-3.5 top-3 z-10 rounded-[5px] bg-black/50 px-2.5 py-1 font-mono text-[11px] text-text-3">
          {planLabel}
        </span>
        <div className="absolute left-[26px] top-[60px] h-[150px] w-[150px] rounded-[3px] border-2 border-[#2f333d]" />
        <div className="absolute right-[26px] top-[60px] h-[150px] w-[150px] rounded-[3px] border-2 border-[#2f333d]" />

        {zones.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-10 text-center text-[13px] font-semibold text-text-3">
            이 날짜에 등록된 구역이 없습니다
          </div>
        )}

        {zones
          .filter((z) => layers[z.layer])
          .map((z) => (
            <button
              key={z.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelected((cur) => (cur?.id === z.id ? null : z));
              }}
              className={`absolute flex items-end rounded p-1.5 text-left ${
                z.layer === "stack"
                  ? "border-2 border-[#f59e0b] bg-[rgba(245,158,11,.28)]"
                  : "border-2 border-[#3b82f6] bg-[rgba(59,130,246,.3)]"
              }`}
              style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%` }}
            >
              <span
                className={`truncate rounded-[5px] px-1.5 py-0.5 text-[10px] font-extrabold ${
                  z.layer === "stack" ? "bg-[#f59e0b] text-[#141414]" : "bg-[#3b82f6] text-white"
                }`}
              >
                {z.layer === "stack" ? `야적 · ${z.materialType}` : z.workContent}
              </span>
            </button>
          ))}

        {selected && (
          <div
            className="absolute z-30 w-[220px] rounded-2xl border border-line-2 bg-surface-3 p-[15px] shadow-[0_20px_50px_-10px_rgba(0,0,0,.7)]"
            style={{
              left: `${Math.min(selected.x, 42)}%`,
              top: `${Math.min(selected.y + selected.height + 3, 55)}%`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ZoneInfoCard zone={selected} date={date} onClose={() => setSelected(null)} />
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/site-detail/zone-draw?id=${site.id}&date=${encodeURIComponent(date)}`);
          }}
          className="absolute bottom-[18px] right-[18px] z-20 flex h-[50px] items-center gap-1.5 rounded-full bg-accent px-5 text-[15px] font-extrabold text-[#1a1a1a] shadow-[0_12px_30px_-6px_rgba(255,214,10,.5)]"
        >
          <Plus size={18} />
          구역 추가하기
        </button>
      </div>

      <div className="flex flex-none gap-2.5 border-t border-line bg-surface px-4 py-3">
        <LayerToggle
          label="야적"
          color="#f59e0b"
          on={layers.stack}
          onClick={() => setLayers((l) => ({ ...l, stack: !l.stack }))}
        />
        <LayerToggle
          label="작업·장비"
          color="#3b82f6"
          on={layers.work}
          onClick={() => setLayers((l) => ({ ...l, work: !l.work }))}
        />
      </div>
    </div>
  );
}

function LayerToggle({
  label,
  color,
  on,
  onClick,
}: {
  label: string;
  color: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] font-bold ${
        on ? "text-text" : "text-text-3"
      }`}
    >
      <span className="h-3 w-3 flex-none rounded-[3px]" style={{ background: color }} />
      {label}
      <span
        className="relative ml-auto h-6 w-10 flex-none rounded-full border transition-colors"
        style={{ borderColor: on ? color : "var(--line-2)", background: on ? color : "var(--surface-3)" }}
      >
        <span
          className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-all ${
            on ? "left-[18px]" : "left-[2px]"
          }`}
        />
      </span>
    </button>
  );
}
