"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronRight, Hammer, Map, MapPin, Pencil, UserPlus, X } from "lucide-react";
import { useStore } from "@/lib/store";

export default function NewAgendaPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const router = useRouter();
  const draft = useStore((s) => s.draft);
  const updateDraft = useStore((s) => s.updateDraft);
  const resetDraft = useStore((s) => s.resetDraft);
  const createAgenda = useStore((s) => s.createAgenda);

  const close = () => {
    resetDraft();
    router.back();
  };

  const post = () => {
    const title =
      draft.description.trim() ||
      `${draft.locationChip} ${draft.tradeChip} 관련 안건`;
    const no = createAgenda({
      parentRoomId: roomId,
      title,
      photoLabel: draft.photoAdded ? "사진 — 현장 촬영" : undefined,
      photoCount: draft.photoAdded ? 1 : undefined,
      floorplanLabel: draft.floorplanLabel,
      pin: draft.pin,
    });
    resetDraft();
    router.push(`/room/${roomId}`);
    void no;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2">
        <button onClick={close} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <X size={22} />
        </button>
        <span className="flex-1 text-center text-[18px] font-extrabold">안건 올리기</span>
        <button
          disabled
          className="h-9 cursor-not-allowed rounded-xl bg-surface-3 px-4 text-[14px] font-bold text-text-3"
        >
          게시
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 pb-2 pt-4">
        <button
          onClick={() => updateDraft({ photoAdded: !draft.photoAdded })}
          className={`flex h-[220px] flex-col items-center justify-center gap-3 rounded-[18px] border-2 border-dashed ${
            draft.photoAdded ? "border-accent text-text" : "border-line-2 text-text-2"
          }`}
        >
          {draft.photoAdded ? (
            <div
              className="h-full w-full rounded-2xl"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg,#24242c,#24242c 9px,#1c1c22 9px,#1c1c22 18px)",
              }}
            />
          ) : (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-surface-2">
                <Camera size={32} />
              </div>
              <div className="text-[16px] font-bold text-text">사진 촬영 또는 선택</div>
              <div className="text-[13px] text-text-3">현장 사진 한 장이면 충분합니다</div>
            </>
          )}
        </button>

        <input
          value={draft.description}
          onChange={(e) => updateDraft({ description: e.target.value })}
          placeholder="간단한 문제 설명 (선택)"
          className="h-[52px] rounded-2xl border border-line bg-surface-2 px-4 text-[15px] text-text placeholder:text-text-3 focus:outline-none"
        />

        <div>
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-text-2">
            자동 인식됨
            <span className="rounded-full border border-accent/30 bg-accent/[0.14] px-2 py-0.5 text-[11px] font-bold text-accent">
              AI 추론
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => {
                const v = window.prompt("위치를 입력하세요", draft.locationChip);
                if (v) updateDraft({ locationChip: v });
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-2 bg-surface-2 px-3.5 py-2 text-[14px] font-semibold text-text-2"
            >
              <MapPin size={16} className="text-text-3" />
              {draft.locationChip}
              <Pencil size={15} className="text-text-3 opacity-70" />
            </button>
            <button
              onClick={() => {
                const v = window.prompt("공종을 입력하세요", draft.tradeChip);
                if (v) updateDraft({ tradeChip: v });
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-2 bg-surface-2 px-3.5 py-2 text-[14px] font-semibold text-text-2"
            >
              <Hammer size={16} className="text-text-3" />
              {draft.tradeChip}
              <Pencil size={15} className="text-text-3 opacity-70" />
            </button>
            <button
              onClick={() => {
                const v = window.prompt("담당자를 입력하세요", draft.assigneeChip);
                if (v) updateDraft({ assigneeChip: v });
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-3.5 py-2 text-[14px] font-semibold ${
                draft.assigneeChip ? "border-line-2 bg-surface-2 text-text-2" : "border-line-2 text-text-3"
              }`}
            >
              <UserPlus size={16} className="text-text-3" />
              {draft.assigneeChip || "담당자 지정"}
            </button>
          </div>
        </div>

        <button
          onClick={() => router.push(`/room/${roomId}/new-agenda/pin`)}
          className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-left text-[15px] font-semibold text-text"
        >
          <Map size={22} className="text-text-2" />
          {draft.floorplanLabel ? draft.floorplanLabel : "도면에서 위치 지정"}
          <ChevronRight size={20} className="ml-auto text-text-3" />
        </button>
      </div>

      <div className="flex-none border-t border-line bg-surface px-4 pb-[26px] pt-3">
        <button
          onClick={post}
          className="h-14 w-full rounded-2xl bg-accent text-[17px] font-extrabold text-[#1a1204]"
        >
          안건 게시
        </button>
      </div>
    </div>
  );
}
