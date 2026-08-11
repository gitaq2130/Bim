"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import ContactListRow from "@/components/ContactListRow";
import RoomIcon from "@/components/RoomIcon";
import { useStore } from "@/lib/store";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type { Contact } from "@/lib/types";

const GROUP_EMOJI: Record<string, string> = { 건축: "🔨", 설비: "🔧", 전기: "⚡", 토목: "⛰️" };

function InviteScreenInner() {
  const router = useRouter();
  const existingRoomId = useSearchParams().get("id");
  const isExistingRoom = !!existingRoomId;

  const contacts = useStore((s) => s.contacts);
  const registration = useStore((s) => s.registration);
  const allContractors = useStore((s) => s.contractors);
  const newRoomDraft = useStore((s) => s.newRoomDraft);
  const resetNewRoomDraft = useStore((s) => s.resetNewRoomDraft);
  const room = useStore((s) => (existingRoomId ? s.roomById(existingRoomId) : undefined));
  const createRoom = useStore((s) => s.createRoom);
  const inviteMembers = useStore((s) => s.inviteMembers);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const q = debouncedQuery.trim().toLowerCase();

  const alreadyMembers = useMemo(
    () => new Set(isExistingRoom ? room?.members ?? [] : []),
    [isExistingRoom, room]
  );

  const quickSelectCompanies = useMemo(() => {
    const siteId = registration?.siteId;
    if (!siteId) return [];
    const approved = new Set(
      allContractors.filter((c) => c.siteId === siteId && c.status === "approved").map((c) => c.companyName)
    );
    const companiesWithContacts = new Set(contacts.map((c) => c.company));
    return [...approved].filter((name) => companiesWithContacts.has(name));
  }, [allContractors, registration, contacts]);

  const filteredContacts = useMemo(() => {
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q));
  }, [contacts, q]);

  const groups = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filteredContacts) {
      const list = map.get(c.tradeGroup) ?? [];
      list.push(c);
      map.set(c.tradeGroup, list);
    }
    return Array.from(map.entries());
  }, [filteredContacts]);

  const toggleContact = (c: Contact) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.add(c.id);
      return next;
    });
  };

  const toggleCompany = (company: string) => {
    const candidateIds = contacts
      .filter((c) => c.company === company && !alreadyMembers.has(c.id))
      .map((c) => c.id);
    const allOn = candidateIds.length > 0 && candidateIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of candidateIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const submit = () => {
    if (selected.size === 0) return;
    if (isExistingRoom && existingRoomId) {
      inviteMembers(existingRoomId, [...selected]);
      router.push(`/room?id=${existingRoomId}`);
    } else {
      const id = createRoom({ name: newRoomDraft.name, icon: newRoomDraft.icon, memberIds: [...selected] });
      resetNewRoomDraft();
      router.push(`/room?id=${id}`);
    }
  };

  const summaryIcon = isExistingRoom ? room?.icon ?? "users" : newRoomDraft.icon;
  const summaryName = isExistingRoom ? room?.name ?? "" : newRoomDraft.name;

  if (isExistingRoom && !room) return null;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2"
        >
          <ChevronLeft size={24} />
        </button>
        <span className="text-[17px] font-extrabold">참여자 초대</span>
      </div>

      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border border-line-2 bg-surface-2 text-accent">
          <RoomIcon name={summaryIcon} size={16} />
        </div>
        <span className="text-[15px] font-extrabold">{summaryName}</span>
      </div>

      <div className="px-4 pb-2">
        <div className="flex h-11 items-center gap-2 rounded-xl bg-surface-2 px-3.5">
          <Search size={17} className="flex-none text-text-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 검색"
            autoComplete="off"
            className="w-full min-w-0 bg-transparent text-[14px] text-text placeholder:text-text-3 focus:outline-none"
          />
        </div>
      </div>

      {quickSelectCompanies.length > 0 && (
        <>
          <div className="px-4 pt-1 text-[12px] font-bold text-text-3">빠른 선택</div>
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5">
            {quickSelectCompanies.map((company) => {
              const candidateIds = contacts
                .filter((c) => c.company === company && !alreadyMembers.has(c.id))
                .map((c) => c.id);
              const on = candidateIds.length > 0 && candidateIds.every((id) => selected.has(id));
              return (
                <button
                  key={company}
                  onClick={() => toggleCompany(company)}
                  className={`flex-none rounded-full border px-3.5 py-[7px] text-[13px] font-bold ${
                    on
                      ? "border-accent bg-[rgba(255,214,10,.14)] text-accent"
                      : "border-line bg-surface-2 text-text-2"
                  }`}
                >
                  {company}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="h-2 flex-none border-y border-line bg-bg" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(([group, list]) => (
          <div key={group}>
            <div className="flex items-center gap-2 px-4 pb-2 pt-3">
              <span className="text-[12px] font-extrabold text-text-2">
                {GROUP_EMOJI[group] ?? "🏗️"} {group}
              </span>
              <span className="text-[12px] font-semibold text-text-3">{list.length}명</span>
            </div>
            {list.map((c) => (
              <ContactListRow
                key={c.id}
                contact={c}
                selection={{
                  selected: selected.has(c.id),
                  disabled: alreadyMembers.has(c.id),
                  onToggle: toggleContact,
                }}
              />
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="py-16 text-center text-[14px] text-text-3">검색 결과가 없습니다</div>
        )}
      </div>

      <div className="flex-none border-t border-line px-5 py-[14px] pb-[22px]">
        <button
          disabled={selected.size === 0}
          onClick={submit}
          className="h-[52px] w-full rounded-2xl bg-accent text-[16px] font-extrabold text-[#1a1300] disabled:bg-surface-2 disabled:text-text-3"
        >
          {isExistingRoom ? `${selected.size}명 초대하기` : `${selected.size}명 초대하고 방 만들기`}
        </button>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteScreenInner />
    </Suspense>
  );
}
