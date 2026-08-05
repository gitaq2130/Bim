"use client";

import { useMemo } from "react";
import { Ban, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import type { Contact } from "@/lib/types";

export default function ContactSummaryCard({
  contact,
  top,
  onClose,
}: {
  contact: Contact;
  top: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const agendas = useStore((s) => s.agendas);
  const toggleContactFavorite = useStore((s) => s.toggleContactFavorite);
  const setContactBlocked = useStore((s) => s.setContactBlocked);

  const summary = useMemo(() => {
    const assigned = agendas.filter((a) => a.assigneeId === contact.id);
    return {
      inProgressCount: assigned.filter((a) => !a.status.startsWith("완료")).length,
      completedCount: assigned.filter((a) => a.status.startsWith("완료")).length,
    };
  }, [agendas, contact.id]);

  const goList = (filter: "진행중" | "완료") => {
    onClose();
    router.push(`/room/agenda-list?assignee=${contact.id}&f=${filter}`);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-[rgba(6,6,8,.6)]" onClick={onClose}>
      <div
        style={{ top }}
        className="animate-pop-in fixed inset-x-4 z-[71] overflow-hidden rounded-2xl border border-line-2 bg-surface-3 shadow-[0_20px_50px_-10px_rgba(0,0,0,.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4">
          <div className="text-[17px] font-extrabold">{contact.name}</div>
          <div className="mt-0.5 text-[13px] font-semibold text-text-2">{contact.rank}</div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] font-bold text-text-3">
            {contact.bizCardRegistered
              ? `${contact.company} · ${contact.trade || contact.tradeGroup}`
              : "명함 미등록"}
          </div>
        </div>

        <div className="mx-4 my-3.5 border-t border-line" />

        <div className="px-4 pb-1">
          <div className="mb-2 text-[12px] font-extrabold text-text-2">담당 안건</div>
          <div className="flex gap-2">
            <button
              onClick={() => goList("진행중")}
              className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left active:bg-surface"
            >
              <div className="text-[20px] font-extrabold leading-none text-st-review">
                {summary.inProgressCount}
              </div>
              <div className="mt-1 text-[11.5px] font-semibold text-text-2">처리중</div>
            </button>
            <button
              onClick={() => goList("완료")}
              className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left active:bg-surface"
            >
              <div className="text-[20px] font-extrabold leading-none text-st-done">
                {summary.completedCount}
              </div>
              <div className="mt-1 text-[11.5px] font-semibold text-text-2">처리완료</div>
            </button>
          </div>
        </div>

        <div className="mx-4 my-3.5 border-t border-line" />

        <button
          onClick={() => {
            toggleContactFavorite(contact.id);
            onClose();
          }}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-semibold active:bg-surface-2"
        >
          <Star size={18} className={contact.favorite ? "fill-accent text-accent" : "text-text-2"} />
          {contact.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
        </button>
        <button
          onClick={() => {
            setContactBlocked(contact.id, true);
            onClose();
          }}
          className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left text-[15px] font-semibold text-[#f2777a] active:bg-surface-2"
        >
          <Ban size={18} />
          차단하기
        </button>
      </div>
    </div>
  );
}
