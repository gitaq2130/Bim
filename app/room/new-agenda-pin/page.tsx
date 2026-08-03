"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, ChevronLeft, Pointer } from "lucide-react";
import { useStore } from "@/lib/store";

export default function FloorplanPinPage() {
  const router = useRouter();
  const updateDraft = useStore((s) => s.updateDraft);
  const draft = useStore((s) => s.draft);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState(draft.pin ?? null);

  const placePin = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPin({ x: Math.round(x), y: Math.round(y) });
  };

  const confirm = () => {
    updateDraft({
      pin: pin ?? { x: 44, y: 46 },
      floorplanLabel: `${draft.locationChip} 평면도 · Rev.04`,
    });
    router.back();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] flex-none items-center gap-2.5 border-b border-line px-3.5">
        <button onClick={() => router.back()} className="-ml-1.5 flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <div className="min-w-0">
          <div className="text-[15px] font-bold">{draft.locationChip} 평면도</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-bold text-st-done">
            <BadgeCheck size={13} />
            Rev.04 · 최신 승인본
          </div>
        </div>
      </div>

      <div
        ref={canvasRef}
        onClick={placePin}
        className="relative flex-1 cursor-crosshair overflow-hidden bg-[#f4f2ee]"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg,#d9d4cb,#d9d4cb 1px,transparent 1px,transparent 34px),repeating-linear-gradient(90deg,#d9d4cb,#d9d4cb 1px,transparent 1px,transparent 34px)",
          }}
        />
        <div className="absolute inset-6 border-[6px] border-[#8a8378]/70" />
        <div className="absolute left-[38%] top-6 h-[300px] w-[6px] bg-[#8a8378]/70" />
        <div className="absolute left-[38%] top-[280px] h-[6px] w-[130px] bg-[#8a8378]/70" />

        <div className="absolute left-1/2 top-3.5 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[rgba(20,20,24,.82)] px-3.5 py-[7px] text-[12px] font-semibold text-[#ececf0]">
          <Pointer size={15} />
          도면을 탭하여 위치를 지정하세요
        </div>

        {pin && (
          <div
            className="absolute flex -translate-x-1/2 -translate-y-full flex-col items-center drop-shadow-[0_6px_8px_rgba(0,0,0,.4)]"
            style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
          >
            <div className="flex h-[34px] w-[34px] rotate-[-45deg] items-center justify-center rounded-[50%_50%_50%_0] bg-st-review">
              <AlertTriangle size={18} className="rotate-45 text-[#1a1204]" />
            </div>
            <div className="mt-1.5 whitespace-nowrap rounded-full bg-[rgba(20,20,24,.9)] px-2.5 py-[3px] text-[11px] font-bold text-white">
              지정 위치
            </div>
          </div>
        )}
      </div>

      <div className="flex-none border-t border-line bg-surface px-4 pb-[26px] pt-3">
        <button
          onClick={confirm}
          className="h-14 w-full rounded-2xl bg-accent text-[17px] font-extrabold text-[#1a1204]"
        >
          이 위치로 지정
        </button>
      </div>
    </div>
  );
}
