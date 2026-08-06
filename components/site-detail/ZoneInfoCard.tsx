"use client";

import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Zone } from "@/lib/types";

export default function ZoneInfoCard({
  zone,
  date,
  onClose,
}: {
  zone: Zone;
  date: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const removeZone = useStore((s) => s.removeZone);
  const isStack = zone.layer === "stack";

  return (
    <div>
      <div className="flex items-center gap-2 text-[14px] font-extrabold">
        <span className="h-3 w-3 rounded-[3px]" style={{ background: isStack ? "#f59e0b" : "#3b82f6" }} />
        {isStack ? "야적 구역" : "작업·장비 구역"}
      </div>
      <div className="mt-2.5 flex flex-col gap-2">
        {isStack ? (
          <>
            <Row k="자재 종류" v={zone.materialType ?? "-"} />
            <Row k="수량" v={zone.quantity ?? "-"} />
            <Row k="반입일" v={zone.broughtInDate ?? "-"} />
          </>
        ) : (
          <>
            <Row k="작업 내용" v={zone.workContent ?? "-"} />
            <Row k="투입 장비" v={zone.equipment ?? "-"} />
            <Row k="작업 인원" v={zone.workerCount ?? "-"} />
          </>
        )}
      </div>
      <div className="mt-3 border-t border-line pt-2.5 text-[11px] text-text-3">
        {zone.registeredAt} · {zone.registeredBy} 등록
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() =>
            router.push(
              `/site-detail/zone-draw?id=${zone.siteId}&date=${encodeURIComponent(date)}&zoneId=${zone.id}`
            )
          }
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface-2 text-[13px] font-bold text-text-2"
        >
          <Pencil size={14} />
          수정
        </button>
        <button
          onClick={() => {
            removeZone(zone.id);
            onClose();
          }}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-[rgba(242,119,122,.3)] bg-surface-2 text-[13px] font-bold text-[#f2777a]"
        >
          <Trash2 size={14} />
          삭제
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-text-3">{k}</span>
      <span className="font-semibold text-text">{v}</span>
    </div>
  );
}
