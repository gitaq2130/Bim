"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import RoomIcon from "@/components/RoomIcon";
import { useStore } from "@/lib/store";
import { ROOM_ICON_PRESETS } from "@/lib/roomIcons";

export default function CreateRoomPage() {
  const router = useRouter();
  const draft = useStore((s) => s.newRoomDraft);
  const updateDraft = useStore((s) => s.updateNewRoomDraft);

  const canNext = draft.name.trim().length > 0;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2"
        >
          <ChevronLeft size={24} />
        </button>
        <span className="text-[17px] font-extrabold">채팅방 만들기</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-[26px]">
        <div className="flex flex-col items-center">
          <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-line-2 bg-surface-2 text-accent">
            <RoomIcon name={draft.icon} size={32} />
          </div>
          <div className="mt-2.5 text-[12px] text-text-3">방 아이콘 선택</div>
          <div className="mt-4 grid w-full grid-cols-4 gap-2.5">
            {ROOM_ICON_PRESETS.map((icon) => (
              <button
                key={icon}
                onClick={() => updateDraft({ icon })}
                className={`flex aspect-square items-center justify-center rounded-2xl border ${
                  draft.icon === icon
                    ? "border-accent bg-[rgba(255,214,10,.14)] text-accent"
                    : "border-line bg-surface-2 text-text-2"
                }`}
              >
                <RoomIcon name={icon} size={20} />
              </button>
            ))}
          </div>
        </div>

        <div className="mt-[22px]">
          <div className="mb-2 text-[13px] font-bold text-text-2">방 이름</div>
          <input
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            placeholder="채팅방 이름을 입력하세요"
            autoComplete="off"
            className="h-12 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[15px] text-text placeholder:text-text-3 focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-none border-t border-line px-5 py-[14px] pb-[22px]">
        <button
          disabled={!canNext}
          onClick={() => router.push("/room/invite")}
          className="h-[52px] w-full rounded-2xl bg-accent text-[16px] font-extrabold text-[#1a1300] disabled:bg-surface-2 disabled:text-text-3"
        >
          다음
        </button>
      </div>
    </div>
  );
}
