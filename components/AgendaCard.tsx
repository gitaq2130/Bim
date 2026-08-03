"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ClipboardList,
  MapPin,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Target,
  Users,
  Activity,
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import { useStore } from "@/lib/store";

const STRIPE = {
  backgroundImage:
    "repeating-linear-gradient(45deg,#24242c,#24242c 9px,#1c1c22 9px,#1c1c22 18px)",
};

export default function AgendaCard({ agendaNo }: { agendaNo: number }) {
  const agenda = useStore((s) => s.agendaByNo(agendaNo));
  const linked = useStore((s) =>
    agenda?.linkedPreReviewNo ? s.agendaByNo(agenda.linkedPreReviewNo) : undefined
  );

  if (!agenda) return null;

  const isPreReview = agenda.status === "사전검토";

  return (
    <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-line-2 bg-surface-2 shadow-[0_8px_24px_-12px_rgba(0,0,0,.7)]">
      {agenda.linkedPreReviewNo && (
        <>
          <div className="flex items-center gap-2.5 border-b border-[rgba(139,92,246,.4)] bg-gradient-to-r from-[rgba(139,92,246,.2)] to-[rgba(34,197,94,.16)] px-4 py-3">
            <Target size={20} className="flex-none text-[#c4b5fd]" />
            <span className="flex-1 text-[13px] font-extrabold leading-snug">
              {linked ? `사전검토와 일치하는 문제가 발생했습니다` : "사전검토와 일치하는 문제가 발생했습니다"}
            </span>
          </div>
          <Link
            href={`/agenda?no=${agenda.linkedPreReviewNo}`}
            className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-[13px] font-bold text-[#c4b5fd]"
          >
            <ShieldCheck size={15} />
            사전검토 안건 #{agenda.linkedPreReviewNo} 보기
            <ArrowUpRight size={16} className="ml-auto text-text-3" />
          </Link>
        </>
      )}

      <Link href={`/agenda?no=${agenda.no}`} className="block">
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3">
          {isPreReview ? (
            <ShieldAlert size={18} className="text-[#a78bfa]" />
          ) : (
            <ClipboardList size={18} className="text-text-2" />
          )}
          <span className="font-mono text-[13px] font-bold text-text-2">안건 #{agenda.no}</span>
          <span className="ml-auto">
            <StatusBadge status={agenda.status} size="sm" />
          </span>
        </div>
        <div className="px-3.5 pb-3 text-[16px] font-bold leading-snug">{agenda.title}</div>

        {!isPreReview && (agenda.isAfterHours || agenda.ageLabel) && (
          <div className="flex flex-wrap items-center gap-2.5 px-3.5 pb-3">
            {agenda.isAfterHours && (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-3">
                <Moon size={14} />
                야간 등록
              </span>
            )}
            {agenda.isAfterHours && agenda.ageLabel && (
              <span className="h-[3px] w-[3px] rounded-full bg-text-3" />
            )}
            {agenda.ageLabel && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-[9px] py-[3px] text-[12px] font-bold ${
                  agenda.isDormant
                    ? "border border-[rgba(245,158,11,.34)] bg-[rgba(245,158,11,.14)] text-[#ffcf7a]"
                    : "border border-line bg-surface-3 text-text-2"
                }`}
              >
                <Activity size={13} />
                {agenda.ageLabel}
              </span>
            )}
          </div>
        )}

        {isPreReview ? (
          <div className="relative h-[150px] border-y border-line" style={STRIPE}>
            <span className="absolute left-[38%] top-[44%] -translate-x-1/2 -translate-y-full text-[#a78bfa] drop-shadow-[0_3px_5px_rgba(0,0,0,.6)]">
              <MapPin size={30} />
            </span>
            <span className="absolute bottom-2.5 left-2.5 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
              {agenda.floorplanLabel}
            </span>
          </div>
        ) : (
          agenda.photoLabel && (
            <div className="flex h-[150px] items-end border-y border-line p-2.5" style={STRIPE}>
              <span className="rounded bg-black/50 px-[7px] py-[3px] font-mono text-[10px] text-text-3">
                {agenda.photoLabel}
                {agenda.photoCount ? ` (${agenda.photoCount}장)` : ""}
              </span>
            </div>
          )
        )}

        {isPreReview ? (
          <div className="flex items-center gap-2 px-3.5 py-3 text-[13px] font-bold text-text-2">
            <CalendarClock size={15} className="text-[#a78bfa]" />
            {agenda.createdLabel}
            <span className="ml-auto rounded-full bg-[rgba(139,92,246,.14)] px-2.5 py-[3px] font-mono font-extrabold text-[#c4b5fd]">
              {agenda.updatedLabel}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3.5 py-3 text-[13px] font-semibold text-text-2">
            <Users size={16} />
            참여자 {agenda.participants}명
            <span className="ml-auto flex items-center gap-1 font-bold text-st-review">
              탭하여 안건방 이동
              <ArrowRight size={16} />
            </span>
          </div>
        )}
      </Link>
    </div>
  );
}
