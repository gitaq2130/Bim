"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  ClipboardPlus,
  HelpCircle,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Send,
} from "lucide-react";
import { useStore } from "@/lib/store";

export default function ChatInput({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [text, setText] = useState("");
  const sendText = useStore((s) => s.sendText);
  const sendPhoto = useStore((s) => s.sendPhoto);
  const sendFile = useStore((s) => s.sendFile);
  const sendSystem = useStore((s) => s.sendSystem);

  const submit = () => {
    if (!text.trim()) return;
    sendText(roomId, text.trim());
    setText("");
  };

  const plusItems = [
    { icon: ImageIcon, label: "사진", onClick: () => sendPhoto(roomId) },
    { icon: Camera, label: "카메라", onClick: () => sendPhoto(roomId) },
    { icon: Paperclip, label: "파일", onClick: () => sendFile(roomId, "현장자료.pdf") },
    {
      icon: ClipboardPlus,
      label: "안건 올리기",
      highlight: true,
      onClick: () => router.push(`/room/${roomId}/new-agenda`),
    },
    {
      icon: HelpCircle,
      label: "질문하기",
      onClick: () =>
        sendSystem(roomId, "질문하기는 준비 중인 기능입니다. AI가 유사 사례를 찾아 답변할 예정입니다."),
    },
  ];

  return (
    <div className="flex-none">
      <div className="flex items-center gap-2 border-t border-line bg-surface p-2.5">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex h-12 w-12 flex-none items-center justify-center rounded-2xl transition-transform ${
            menuOpen ? "rotate-45 bg-accent text-[#1a1204]" : "bg-surface-2 text-text"
          }`}
        >
          <Plus size={26} />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          onFocus={() => setMenuOpen(false)}
          placeholder="메시지 입력"
          className="h-12 flex-1 rounded-full bg-surface-2 px-[18px] text-[15px] text-text placeholder:text-text-3 focus:outline-none"
        />
        <button
          onClick={submit}
          className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-surface-2 text-text-3"
        >
          <Send size={22} />
        </button>
      </div>

      {menuOpen && (
        <div className="grid flex-none grid-cols-4 gap-3 border-t border-line bg-surface px-4 pb-[26px] pt-[18px]">
          {plusItems.map(({ icon: Icon, label, onClick, highlight }) => (
            <button
              key={label}
              onClick={() => {
                onClick();
                setMenuOpen(false);
              }}
              className="flex flex-col items-center gap-[9px]"
            >
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-[20px] border ${
                  highlight
                    ? "border-accent bg-accent text-[#1a1204] shadow-[0_0_0_4px_rgba(255,214,10,.2)]"
                    : "border-line bg-surface-2 text-text-2"
                }`}
              >
                <Icon size={28} />
              </div>
              <span className={`text-[13px] font-semibold ${highlight ? "font-extrabold text-text" : "text-text-2"}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
