"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  FileText,
  Layers,
  UserPlus,
} from "lucide-react";
import AiSummaryCard from "@/components/AiSummaryCard";
import RevisionBanner from "@/components/RevisionBanner";
import StatusBadge from "@/components/StatusBadge";
import ChatInput from "@/components/ChatInput";
import MessageItem from "@/components/MessageItem";
import StatusPickerSheet from "@/components/StatusPickerSheet";
import AssigneeSheet from "@/components/AssigneeSheet";
import SimilarCasesSheet from "@/components/SimilarCasesSheet";
import ReportSheet from "@/components/ReportSheet";
import CompleteSheet from "@/components/CompleteSheet";
import { useStore } from "@/lib/store";
import { useAutoScrollToBottom } from "@/lib/useAutoScroll";

export default function AgendaRoomPage({
  params,
}: {
  params: Promise<{ no: string }>;
}) {
  const { no: noParam } = use(params);
  const no = Number(noParam);
  const router = useRouter();
  const agenda = useStore((s) => s.agendaByNo(no));
  const allMessages = useStore((s) => s.messages);
  const roomId = `agenda-${no}`;
  const messages = useMemo(
    () => allMessages.filter((m) => m.roomId === roomId),
    [allMessages, roomId]
  );
  const setAgendaStatus = useStore((s) => s.setAgendaStatus);
  const scrollRef = useAutoScrollToBottom(messages.length);

  const [sheet, setSheet] = useState<
    "status" | "assignee" | "similar" | "report" | "complete" | null
  >(null);

  if (!agenda) {
    return (
      <div className="flex h-full items-center justify-center text-text-2">
        존재하지 않는 안건입니다.
      </div>
    );
  }

  const isDone = agenda.status.startsWith("완료");

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line px-2 pb-2.5 pt-2">
        <button onClick={() => router.back()} className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[17px] font-extrabold">안건 #{agenda.no}</span>
            <StatusBadge status={agenda.status} onClick={() => setSheet("status")} />
          </div>
          <div className="mt-0.5 max-w-[230px] truncate text-[12px] font-semibold text-text-2">
            {agenda.title}
          </div>
        </div>
      </div>

      {agenda.aiSummary && <AiSummaryCard summary={agenda.aiSummary} />}
      {agenda.revLinked && (
        <RevisionBanner agendaNo={agenda.no} from={agenda.revLinked.from} to={agenda.revLinked.to} />
      )}

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-bg px-3.5 pb-2 pt-4 [&>*]:shrink-0"
      >
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} interactive />
        ))}
      </div>

      {!isDone && (
        <div className="no-scrollbar flex flex-none gap-2 overflow-x-auto border-t border-line bg-surface px-3 py-2.5">
          <ActionChip icon={CircleDot} label="상태변경" onClick={() => setSheet("status")} />
          <ActionChip icon={UserPlus} label="담당자" onClick={() => setSheet("assignee")} />
          <ActionChip icon={Layers} label="유사사례" onClick={() => setSheet("similar")} />
          <ActionChip icon={FileText} label="보고서 작성" highlight onClick={() => setSheet("report")} />
          <ActionChip icon={CheckCircle2} label="완료처리" onClick={() => setSheet("complete")} />
        </div>
      )}

      <ChatInput roomId={`agenda-${no}`} />

      <StatusPickerSheet
        open={sheet === "status"}
        onClose={() => setSheet(null)}
        current={agenda.status}
        onSelect={(status) => setAgendaStatus(no, status)}
      />
      <AssigneeSheet open={sheet === "assignee"} onClose={() => setSheet(null)} agendaNo={no} />
      <SimilarCasesSheet open={sheet === "similar"} onClose={() => setSheet(null)} agendaNo={no} />
      <ReportSheet open={sheet === "report"} onClose={() => setSheet(null)} agendaNo={no} />
      <CompleteSheet open={sheet === "complete"} onClose={() => setSheet(null)} agendaNo={no} />
    </div>
  );
}

function ActionChip({
  icon: Icon,
  label,
  onClick,
  highlight,
}: {
  icon: typeof CircleDot;
  label: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-[38px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-[15px] text-[14px] font-semibold ${
        highlight
          ? "border-accent bg-accent font-extrabold text-[#1a1204]"
          : "border-line bg-surface-2 text-text-2"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}
