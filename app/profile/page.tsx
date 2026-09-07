"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SITE_CONFIG } from "@/lib/siteConfig";
import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  Check as CheckIcon,
  ChevronLeft,
  ClipboardList,
  Mail,
  MessageSquare,
  MoreVertical,
  Phone,
  ShieldOff,
  Sparkles,
  Star,
  User,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { STATUS_STYLES } from "@/lib/status";

type Tab = "card" | "memo" | "activity";

function ProfilePageInner() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const contact = useStore((s) => s.contactById(id));
  const setContactNote = useStore((s) => s.setContactNote);
  const toggleContactFavorite = useStore((s) => s.toggleContactFavorite);
  const setContactBlocked = useStore((s) => s.setContactBlocked);
  const [tab, setTab] = useState<Tab>("card");
  const [noteDraft, setNoteDraft] = useState(contact?.note ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2200);
  };

  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center text-text-2">
        연락처를 찾을 수 없습니다.
      </div>
    );
  }

  const header = (
    <div className="flex h-14 flex-none items-center gap-1.5 px-2">
      <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
        <ChevronLeft size={24} />
      </button>
      <span className="flex-1" />
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
      >
        <MoreVertical size={22} />
      </button>
    </div>
  );

  const overlays = (
    <>
      {menuOpen && (
        <>
          <div className="absolute inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-3 top-14 z-30 w-[200px] overflow-hidden rounded-2xl border border-line-2 bg-surface-3 shadow-[0_20px_50px_-10px_rgba(0,0,0,.7)]">
            <button
              onClick={() => {
                toggleContactFavorite(contact.id);
                setMenuOpen(false);
                showToast(contact.favorite ? "즐겨찾기를 해제했습니다" : "즐겨찾기에 추가했습니다");
              }}
              className="flex w-full items-center gap-3 border-b border-line px-[18px] py-[15px] text-left text-[15px] font-semibold text-text active:bg-surface-2"
            >
              <Star size={19} className={contact.favorite ? "fill-accent text-accent" : "text-text-2"} />
              {contact.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setBlockDialogOpen(true);
              }}
              className="flex w-full items-center gap-3 border-b border-line px-[18px] py-[15px] text-left text-[15px] font-semibold text-text active:bg-surface-2"
            >
              <Ban size={19} className="text-text-2" />
              차단하기
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                showToast("신고가 접수되었습니다");
              }}
              className="flex w-full items-center gap-3 px-[18px] py-[15px] text-left text-[15px] font-semibold text-[#f2777a] active:bg-surface-2"
            >
              <AlertTriangle size={19} className="text-[#f2777a]" />
              신고하기
            </button>
          </div>
        </>
      )}

      {blockDialogOpen && (
        <div className="animate-scrim-in absolute inset-0 z-40 flex items-center justify-center bg-[rgba(6,6,8,.66)] p-7">
          <div className="w-full overflow-hidden rounded-[18px] border border-line-2 bg-surface-3 shadow-[0_24px_60px_-12px_rgba(0,0,0,.8)]">
            <div className="p-5">
              <div className="text-center text-[17px] font-extrabold">
                {contact.name}님을 차단하시겠어요?
              </div>
              <div className="mt-3 text-center text-[13.5px] leading-relaxed text-text-2">
                차단하면 서로의 메시지가 보이지 않으며, 안건방에서의 기존 기록은 유지됩니다.
              </div>
            </div>
            <div className="flex border-t border-line">
              <button
                onClick={() => setBlockDialogOpen(false)}
                className="h-[52px] flex-1 text-[16px] font-extrabold text-text"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setContactBlocked(contact.id, true);
                  setBlockDialogOpen(false);
                  showToast("차단했습니다");
                }}
                className="h-[52px] flex-1 border-l border-line text-[16px] font-extrabold text-[#ff6b6e]"
              >
                차단
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="animate-pop-in absolute bottom-5 left-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-st-done bg-[#122a1a] px-3.5 py-3 text-[13.5px] font-bold text-[#8bea9f] shadow-[0_10px_24px_-8px_rgba(0,0,0,.7)]">
          <CheckIcon size={16} />
          {toast}
        </div>
      )}
    </>
  );

  if (!contact.bizCardRegistered) {
    return (
      <div className="relative flex h-full flex-col">
        {header}
        {overlays}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-surface-3 text-text-3">
            <User size={34} />
          </div>
          <div>
            <div className="text-[19px] font-extrabold">{contact.name}</div>
            <div className="mt-1 text-[13px] text-text-3">{contact.company}</div>
          </div>
          <div className="text-[14px] font-semibold text-text-2">
            아직 명함을 등록하지 않았어요
          </div>
          <button
            onClick={() => router.push("/")}
            className="mt-2 flex h-12 items-center gap-2 rounded-2xl bg-st-action px-6 text-[15px] font-bold text-white"
          >
            <MessageSquare size={18} />
            채팅
          </button>
        </div>
      </div>
    );
  }

  const bc = contact.bizCard!;

  return (
    <div className="relative flex h-full flex-col">
      {header}
      {overlays}
      <div className="flex items-center justify-center gap-1.5 pt-0.5 text-[12px] font-semibold text-text-3">
        <BadgeCheck size={14} />
        본인이 등록한 정보입니다
      </div>

      {contact.blocked && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-line-2 bg-surface-2 px-3.5 py-2.5 text-[12.5px] font-semibold text-text-2">
          <ShieldOff size={15} className="flex-none text-text-3" />
          차단한 사용자입니다 · 서로의 메시지가 보이지 않습니다
        </div>
      )}

      <div className="flex items-center gap-3.5 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[22px] font-extrabold">{contact.name}</div>
          <div className="mt-[3px] text-[14px] font-semibold text-text-2">
            {contact.rank} {contact.trade && `· ${contact.trade}`}
          </div>
          <div className="mt-0.5 text-[13px] text-text-3">{contact.company}</div>
        </div>
        <div className="flex h-[66px] w-[66px] flex-none items-center justify-center rounded-full bg-surface-3 text-text-2">
          <User size={32} />
        </div>
      </div>

      <div className="flex gap-2.5 px-4 pb-4">
        <ProfileAction
          icon={Phone}
          label="전화"
          cta
          disabled={contact.blocked}
          onClick={() => {
            window.location.href = `tel:${bc.mobile}`;
          }}
        />
        <ProfileAction
          icon={MessageSquare}
          label="채팅"
          cta
          disabled={contact.blocked}
          onClick={() => router.push("/")}
        />
        <ProfileAction
          icon={Mail}
          label="이메일"
          onClick={() => {
            window.location.href = `mailto:${bc.email}`;
          }}
        />
        <ProfileAction
          icon={ClipboardList}
          label="함께한 안건"
          onClick={() => setTab("activity")}
        />
      </div>

      <div className="flex border-b border-line px-2">
        {(
          [
            ["card", "명함 정보"],
            ["memo", "메모"],
            ["activity", "활동 이력"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 border-b-2 py-[13px] text-center text-[14px] font-bold ${
              tab === key ? "border-accent text-text" : "border-transparent text-text-3"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "card" && (
          <>
            <div className="relative overflow-hidden rounded-2xl border border-line-2 bg-gradient-to-br from-[#20222b] to-[#171820] p-5">
              <div className="text-[12px] font-extrabold tracking-wide text-accent">
                {contact.company.toUpperCase()}
              </div>
              <div className="mt-4 text-[13px] font-semibold text-text-3">{bc.nameEn}</div>
              <div className="mt-0.5 text-[24px] font-extrabold">{contact.name}</div>
              <div className="mt-1 text-[14px] font-semibold text-text-2">
                {contact.rank} {contact.trade && `/ ${contact.trade}`}
              </div>
              <div className="my-4 h-px bg-line-2" />
              <BizLine k="주소" v={bc.address} />
              <BizLine k="전화" v={bc.phone} />
              <BizLine k="팩스" v={bc.fax} />
              <BizLine k="이메일" v={bc.email} />
            </div>

            <div className="mt-5">
              <div className="mb-1.5 text-[13px] font-extrabold text-text-2">정보</div>
              <InfoRow k="휴대전화" v={bc.mobile} link />
              <InfoRow k="이메일" v={bc.email} link />
              <InfoRow k="유선전화" v={bc.phone} />
              <InfoRow k="소속 현장" v={SITE_CONFIG.siteName} />
              <InfoRow k="담당 공종" v={contact.trade || "-"} last />
            </div>
          </>
        )}

        {tab === "memo" && (
          <div className="flex flex-col gap-3">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="이 사람에 대한 메모를 남겨보세요 (나만 볼 수 있어요)"
              className="min-h-[140px] rounded-2xl border border-line bg-surface-2 p-3.5 text-[14px] text-text placeholder:text-text-3 focus:outline-none"
            />
            <button
              onClick={() => setContactNote(contact.id, noteDraft)}
              className="h-12 rounded-2xl bg-accent text-[15px] font-extrabold text-[#1a1204]"
            >
              메모 저장
            </button>
          </div>
        )}

        {tab === "activity" &&
          (contact.activityPublic ? (
            <div className="rounded-2xl border border-[rgba(59,130,246,.32)] bg-[rgba(59,130,246,.06)] p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-extrabold text-[#9cc4ff]">
                <Sparkles size={14} />
                안건톡 활동 데이터
              </div>
              <div className="text-[16px] font-extrabold">
                이 사람과 함께한 안건 {contact.activity.length}건
              </div>
              <div className="mt-2">
                {contact.activity.map((a, i) => {
                  const style = STATUS_STYLES[a.status];
                  return (
                    <div
                      key={a.agendaNo}
                      className={`flex items-center gap-2.5 py-[11px] ${
                        i < contact.activity.length - 1 ? "border-b border-line" : ""
                      }`}
                    >
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-surface-3 text-text-3">
                        <ClipboardList size={16} />
                      </span>
                      <span className="flex-1 text-[13px] font-semibold">
                        #{a.agendaNo} {a.title}
                      </span>
                      <span
                        style={{ color: style.text, background: style.bg, border: `1px solid ${style.border}` }}
                        className="rounded-full px-[9px] py-[3px] text-[11px] font-extrabold"
                      >
                        {a.status}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[12px] font-semibold text-text-3">
                본인이 등록한 명함 정보와 달리, 안건톡 활동 이력은 앱 데이터 기반이며 상대가 공개를 허용한 경우에만 표시됩니다
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-[13px] font-semibold text-text-3">
              상대가 활동 이력 공개를 허용하지 않았습니다
            </div>
          ))}
      </div>
    </div>
  );
}

function ProfileAction({
  icon: Icon,
  label,
  cta,
  disabled,
  onClick,
}: {
  icon: typeof Phone;
  label: string;
  cta?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} className="flex flex-1 flex-col items-center gap-1.5">
      <div
        className={`flex h-[52px] w-[52px] items-center justify-center rounded-full border ${
          disabled
            ? "border-line bg-surface-2 text-text-3 opacity-50"
            : cta
              ? "border-st-action bg-st-action text-white"
              : "border-line bg-surface-2 text-text"
        }`}
      >
        <Icon size={22} />
      </div>
      <span className="text-[12px] font-semibold text-text-2">{label}</span>
    </button>
  );
}

function BizLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="mt-1.5 flex gap-2 text-[12.5px]">
      <span className="w-[38px] flex-none font-bold text-text-3">{k}</span>
      <span className="text-text-2">{v}</span>
    </div>
  );
}

function InfoRow({ k, v, link, last }: { k: string; v: string; link?: boolean; last?: boolean }) {
  return (
    <div className={`flex gap-3 py-[13px] ${last ? "" : "border-b border-line"}`}>
      <span className="w-[78px] flex-none text-[13px] font-semibold text-text-3">{k}</span>
      <span className={`flex-1 text-[14px] ${link ? "text-[#7dd3fc]" : "text-text"}`}>{v}</span>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfilePageInner />
    </Suspense>
  );
}
