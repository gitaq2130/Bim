"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Hand, X } from "lucide-react";
import { useStore } from "@/lib/store";
import type { ZoneLayer } from "@/lib/types";

function ZoneDrawPageInner() {
  const siteId = useSearchParams().get("id") ?? "site-gochang";
  const date = useSearchParams().get("date") ?? "2026. 8. 6";
  const zoneId = useSearchParams().get("zoneId");
  const router = useRouter();
  const site = useStore((s) => s.siteById(siteId));
  const zones = useStore((s) => s.zones);
  const existing = zoneId ? zones.find((z) => z.id === zoneId) : undefined;
  const addZone = useStore((s) => s.addZone);
  const updateZone = useStore((s) => s.updateZone);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    existing ? { x: existing.x, y: existing.y, width: existing.width, height: existing.height } : null
  );
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const [layer, setLayer] = useState<ZoneLayer>(existing?.layer ?? "stack");
  const [materialType, setMaterialType] = useState(existing?.materialType ?? "");
  const [quantity, setQuantity] = useState(existing?.quantity ?? "");
  const [broughtInDate, setBroughtInDate] = useState(existing?.broughtInDate ?? date);
  const [workContent, setWorkContent] = useState(existing?.workContent ?? "");
  const [equipment, setEquipment] = useState(existing?.equipment ?? "");
  const [workerCount, setWorkerCount] = useState(existing?.workerCount ?? "");

  const toPct = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (existing) return;
    const p = toPct(e.clientX, e.clientY);
    dragStart.current = p;
    setRect({ x: p.x, y: p.y, width: 0, height: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const p = toPct(e.clientX, e.clientY);
    const x = Math.min(dragStart.current.x, p.x);
    const y = Math.min(dragStart.current.y, p.y);
    const width = Math.abs(p.x - dragStart.current.x);
    const height = Math.abs(p.y - dragStart.current.y);
    setRect({ x, y, width, height });
  };
  const onPointerUp = () => {
    dragStart.current = null;
  };

  if (!site) return null;

  const canSave = !!rect && rect.width > 2 && rect.height > 2;

  const save = () => {
    if (!rect) return;
    const fields = {
      layer,
      materialType: layer === "stack" ? materialType : undefined,
      quantity: layer === "stack" ? quantity : undefined,
      broughtInDate: layer === "stack" ? broughtInDate : undefined,
      workContent: layer === "work" ? workContent : undefined,
      equipment: layer === "work" ? equipment : undefined,
      workerCount: layer === "work" ? workerCount : undefined,
    };
    if (existing) {
      updateZone(existing.id, fields);
    } else {
      addZone({ siteId, date, ...rect, ...fields });
    }
    router.back();
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <X size={22} />
        </button>
        <span className="flex-1 text-center text-[16px] font-extrabold">
          {existing ? "구역 수정" : "구역 지정"}
        </span>
        <div className="w-11" />
      </div>

      <div
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative h-[300px] flex-none touch-none overflow-hidden bg-[#111318]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#181a20,#181a20 1px,transparent 1px,transparent 42px),repeating-linear-gradient(90deg,#181a20,#181a20 1px,transparent 1px,transparent 42px)",
        }}
      >
        <span className="absolute left-3.5 top-3 rounded-[5px] bg-black/50 px-2.5 py-1 font-mono text-[11px] text-text-3">
          {site.name.replace(" 신축공사", "")} 배치도 · A~C동
        </span>
        <div className="absolute left-[26px] top-[40px] h-[120px] w-[130px] rounded-[3px] border-2 border-[#2f333d]" />
        <div className="absolute right-[26px] top-[40px] h-[120px] w-[130px] rounded-[3px] border-2 border-[#2f333d]" />

        {!rect && !existing && (
          <div className="absolute left-1/2 top-3.5 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[rgba(20,20,24,.82)] px-3.5 py-[7px] text-[12px] font-semibold text-[#ececf0]">
            <Hand size={15} />
            도면 위를 드래그해 구역을 그리세요
          </div>
        )}

        {rect && (
          <div
            className="absolute rounded border-2 border-dashed border-accent bg-[rgba(255,214,10,.14)]"
            style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-t-[20px] bg-surface-3 px-[18px] pb-6 pt-[18px] shadow-[0_-20px_50px_-10px_rgba(0,0,0,.6)]">
        <div className="mb-4 flex rounded-xl bg-surface-2 p-1">
          <button
            onClick={() => setLayer("stack")}
            className={`flex-1 rounded-[9px] py-2.5 text-[14px] font-bold ${
              layer === "stack" ? "bg-surface text-text" : "text-text-3"
            }`}
          >
            야적
          </button>
          <button
            onClick={() => setLayer("work")}
            className={`flex-1 rounded-[9px] py-2.5 text-[14px] font-bold ${
              layer === "work" ? "bg-surface text-text" : "text-text-3"
            }`}
          >
            작업·장비
          </button>
        </div>

        {layer === "stack" ? (
          <>
            <ZField label="자재 종류" value={materialType} onChange={setMaterialType} placeholder="예) 이형철근 HD25" />
            <ZField label="수량" value={quantity} onChange={setQuantity} placeholder="예) 12톤" />
            <ZField label="반입일" value={broughtInDate} onChange={setBroughtInDate} placeholder={date} />
          </>
        ) : (
          <>
            <ZField label="작업 내용" value={workContent} onChange={setWorkContent} placeholder="예) B동 코어벽 타설" />
            <ZField
              label="투입 장비"
              value={equipment}
              onChange={setEquipment}
              placeholder="예) 타워크레인 1, 펌프카 1"
            />
            <ZField label="작업 인원" value={workerCount} onChange={setWorkerCount} placeholder="예) 8명" />
          </>
        )}

        <button
          disabled={!canSave}
          onClick={save}
          className="mt-2 h-[52px] w-full rounded-xl bg-accent text-[16px] font-extrabold text-[#1a1a1a] disabled:opacity-40"
        >
          저장
        </button>
      </div>
    </div>
  );
}

function ZField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[12px] font-bold text-text-3">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-[46px] w-full rounded-[10px] border border-line bg-surface-2 px-3.5 text-[15px] text-text placeholder:text-text-3 focus:outline-none"
      />
    </div>
  );
}

export default function ZoneDrawPage() {
  return (
    <Suspense>
      <ZoneDrawPageInner />
    </Suspense>
  );
}
