"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  IdCard,
  Search,
  User,
  UserPlus,
} from "lucide-react";
import SearchReveal from "@/components/SearchReveal";
import { useStore } from "@/lib/store";
import type { Contact } from "@/lib/types";

type SortMode = "recent" | "abc";

export default function ContactsPage() {
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const [sort, setSort] = useState<SortMode>("recent");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searchOpen, setSearchOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of contacts) {
      const list = map.get(c.tradeGroup) ?? [];
      list.push(c);
      map.set(c.tradeGroup, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        sort === "abc"
          ? a.name.localeCompare(b.name, "ko")
          : a.lastTalkedLabel.localeCompare(b.lastTalkedLabel)
      );
    }
    return Array.from(map.entries());
  }, [contacts, sort]);

  const registeredCount = contacts.filter((c) => c.bizCardRegistered).length;
  const groupEmoji: Record<string, string> = { 건축: "🔨", 설비: "🔧", 전기: "⚡", 토목: "⛰️" };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2 pl-[18px]">
        <span className="text-[20px] font-extrabold tracking-tight">연락처</span>
        <span className="flex-1" />
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2 active:bg-surface-2"
        >
          <Search size={22} />
        </button>
      </div>

      <SearchReveal open={searchOpen} placeholder="이름 검색" onClose={() => setSearchOpen(false)} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Link
          href="/profile/me"
          className="flex items-center gap-3.5 border-b border-line px-4 py-[18px] active:bg-surface-2"
        >
          <div
            className={`flex h-14 w-14 flex-none items-center justify-center rounded-full ${
              me.bizCardRegistered
                ? "bg-surface-3 text-text-2"
                : "border-2 border-dashed border-line-2 text-text-3"
            }`}
          >
            {me.bizCardRegistered ? <User size={28} /> : <UserPlus size={28} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-extrabold">나 · {me.name}</div>
            {me.bizCardRegistered ? (
              <div className="mt-[3px] text-[12.5px] leading-relaxed text-text-3">
                {me.rank} · {me.company}
              </div>
            ) : (
              <>
                <div className="mt-[3px] text-[12.5px] leading-relaxed text-text-3">
                  명함을 등록하면 함께 일하는 사람들에게 자동으로 보여요
                </div>
                <div className="mt-1 inline-flex items-center gap-1 text-[13px] font-bold text-accent">
                  <IdCard size={14} />
                  명함 등록하기
                </div>
              </>
            )}
          </div>
          <ChevronRight size={20} className="flex-none text-text-3" />
        </Link>

        <div className="flex items-center gap-2 px-4 pb-1.5 pt-3">
          <span className="flex-1 text-[13px] font-extrabold text-text-2">공종별 담당자</span>
          <div className="flex overflow-hidden rounded-[9px] border border-line bg-surface-2">
            <button
              onClick={() => setSort("recent")}
              className={`px-2.5 py-[5px] text-[12px] font-bold ${
                sort === "recent" ? "bg-surface-3 text-text" : "text-text-3"
              }`}
            >
              최근 대화순
            </button>
            <button
              onClick={() => setSort("abc")}
              className={`px-2.5 py-[5px] text-[12px] font-bold ${
                sort === "abc" ? "bg-surface-3 text-text" : "text-text-3"
              }`}
            >
              가나다순
            </button>
          </div>
        </div>

        {groups.map(([group, list]) => {
          const isCollapsed = collapsed[group];
          return (
            <div key={group}>
              <button
                onClick={() => setCollapsed((s) => ({ ...s, [group]: !s[group] }))}
                className="flex w-full items-center gap-2 px-4 pb-2 pt-3"
              >
                <span className="text-[12px] font-extrabold text-text-2">
                  {groupEmoji[group] ?? "🏗️"} {group}
                </span>
                <span className="text-[12px] font-semibold text-text-3">{list.length}명</span>
                <span className="ml-auto">
                  {isCollapsed ? (
                    <ChevronDown size={18} className="text-text-3" />
                  ) : (
                    <ChevronUp size={18} className="text-text-3" />
                  )}
                </span>
              </button>
              {!isCollapsed &&
                list.map((c) => (
                  <Link
                    key={c.id}
                    href={`/profile?id=${c.id}`}
                    className="flex min-h-[66px] items-center gap-3.5 px-4 py-[11px] active:bg-surface-2"
                  >
                    <div
                      className={`flex h-[46px] w-[46px] flex-none items-center justify-center rounded-full bg-surface-3 text-text-2 ${
                        c.bizCardRegistered ? "" : "opacity-40"
                      }`}
                    >
                      <User size={23} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-[7px]">
                        <span
                          className={`text-[15.5px] font-bold ${
                            c.bizCardRegistered ? "" : "text-text-2"
                          }`}
                        >
                          {c.name}
                        </span>
                        {!c.bizCardRegistered && (
                          <span className="rounded-full border border-line bg-surface-3 px-2 py-[2px] text-[11px] font-bold text-text-3">
                            명함 미등록
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[13px] text-text-3">
                        {[c.rank, c.trade].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span className="flex-none rounded-[7px] border border-line bg-surface-2 px-[9px] py-[3px] text-[11px] font-bold text-text-2">
                      {c.company}
                    </span>
                  </Link>
                ))}
            </div>
          );
        })}

        <div className="p-4 text-center text-[12px] font-semibold text-text-3">
          전체 연락처 {contacts.length}명 · 명함 등록{" "}
          <b className="font-extrabold text-st-done">{registeredCount}명</b>
        </div>
      </div>
    </div>
  );
}
