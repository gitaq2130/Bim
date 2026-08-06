"use client";

import { useMemo, useState } from "react";
import { Building2, ChevronLeft, MapPin, Search } from "lucide-react";
import { useStore } from "@/lib/store";

export default function SiteSelectScreen({
  onSelect,
  onBack,
}: {
  onSelect: (siteId: string) => void;
  onBack: () => void;
}) {
  const sites = useStore((s) => s.sites);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? sites.filter(
            (s) => s.name.toLowerCase().includes(q) || s.location.toLowerCase().includes(q)
          )
        : sites,
    [sites, q]
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-14 flex-none items-center gap-1.5 px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-2">
          <ChevronLeft size={24} />
        </button>
      </div>
      <div className="px-6 pb-4 pt-2">
        <div className="text-[22px] font-extrabold">현장을 선택하세요</div>
      </div>
      <div className="px-5 pb-4">
        <div className="flex h-11 items-center gap-2 rounded-xl bg-surface-2 px-3.5">
          <Search size={17} className="flex-none text-text-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="현장명·지역 검색"
            className="w-full min-w-0 bg-transparent text-[14px] text-text placeholder:text-text-3 focus:outline-none"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {filtered.map((site) => (
          <button
            key={site.id}
            onClick={() => onSelect(site.id)}
            className="mb-3 flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface-2 p-3.5 text-left"
          >
            <div className="flex h-14 w-14 flex-none items-center justify-center rounded-xl bg-surface-3 text-text-2">
              <Building2 size={26} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15.5px] font-bold">{site.name}</div>
              <div className="mt-1 flex items-center gap-1 text-[12.5px] text-text-3">
                <MapPin size={12} />
                {site.location}
              </div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="py-16 text-center text-[14px] text-text-3">검색 결과가 없습니다</div>
        )}
      </div>
    </div>
  );
}
