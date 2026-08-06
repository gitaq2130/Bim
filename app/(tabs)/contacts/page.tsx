"use client";

import { useMemo, useRef, useState } from "react";
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
import ContactListRow from "@/components/ContactListRow";
import ContactSummaryCard from "@/components/ContactSummaryCard";
import SearchReveal from "@/components/SearchReveal";
import { useStore } from "@/lib/store";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type { Contact } from "@/lib/types";

type SortMode = "recent" | "abc";

export default function ContactsPage() {
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const [sort, setSort] = useState<SortMode>("recent");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const q = debouncedQuery.trim().toLowerCase();

  const containerRef = useRef<HTMLDivElement>(null);
  const [summaryContact, setSummaryContact] = useState<Contact | null>(null);
  const [summaryTop, setSummaryTop] = useState(0);

  const handleLongPress = (contact: Contact, rowEl: HTMLElement) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const rowRect = rowEl.getBoundingClientRect();
    const desiredTop = rowRect.bottom - containerRect.top + 6;
    setSummaryTop(Math.min(desiredTop, containerRect.height - 300));
    setSummaryContact(contact);
  };

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

  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map(([group, list]) => [
        group,
        list.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.rank.toLowerCase().includes(q) ||
            c.company.toLowerCase().includes(q)
        ),
      ] as [string, Contact[]])
      .filter(([, list]) => list.length > 0);
  }, [groups, q]);

  const totalMatches = filteredGroups.reduce((sum, [, list]) => sum + list.length, 0);

  const registeredCount = contacts.filter((c) => c.bizCardRegistered).length;
  const groupEmoji: Record<string, string> = { 건축: "🔨", 설비: "🔧", 전기: "⚡", 토목: "⛰️" };

  return (
    <div ref={containerRef} className="relative flex h-full flex-col">
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

      <SearchReveal
        open={searchOpen}
        value={query}
        onChange={setQuery}
        placeholder="이름 검색"
        onClose={() => {
          setSearchOpen(false);
          setQuery("");
        }}
      />

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

        {q && totalMatches === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-text-3">
            <span className="text-[14px]">검색 결과가 없습니다</span>
          </div>
        )}

        {filteredGroups.map(([group, list]) => {
          const isCollapsed = q ? false : collapsed[group];
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
                  <ContactListRow key={c.id} contact={c} onLongPress={handleLongPress} />
                ))}
            </div>
          );
        })}

        <div className="p-4 text-center text-[12px] font-semibold text-text-3">
          전체 연락처 {contacts.length}명 · 명함 등록{" "}
          <b className="font-extrabold text-st-done">{registeredCount}명</b>
        </div>
      </div>

      {summaryContact && (
        <ContactSummaryCard
          contact={summaryContact}
          top={summaryTop}
          onClose={() => setSummaryContact(null)}
        />
      )}
    </div>
  );
}
