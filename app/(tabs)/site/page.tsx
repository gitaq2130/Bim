"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, MapPin, Search } from "lucide-react";
import SearchReveal from "@/components/SearchReveal";
import { useStore } from "@/lib/store";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

export default function SiteListPage() {
  const router = useRouter();
  const sites = useStore((s) => s.sites);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const q = debouncedQuery.trim().toLowerCase();

  const filteredSites = q
    ? sites.filter(
        (s) => s.name.toLowerCase().includes(q) || s.location.toLowerCase().includes(q)
      )
    : sites;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-none items-center gap-1.5 border-b border-line px-2 pl-[18px]">
        <span className="text-[20px] font-extrabold tracking-tight">현장</span>
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
        placeholder="현장명·지역 검색"
        onClose={() => {
          setSearchOpen(false);
          setQuery("");
        }}
      />

      {q && filteredSites.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[14px] text-text-3">
          검색 결과가 없습니다
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {filteredSites.map((site) => (
            <button
              key={site.id}
              onClick={() => router.push(`/site-detail?id=${site.id}`)}
              className="flex w-full items-start gap-3.5 border-b border-line px-4 py-[15px] text-left active:bg-surface-2"
            >
              <div className="flex h-[78px] w-[78px] flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-surface-2 to-surface text-text-3">
                <Building2 size={30} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-extrabold">{site.name}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-text-3">
                  <MapPin size={13} />
                  {site.location}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {site.progressLabel && (
                    <span className="rounded-full bg-[rgba(14,165,233,.14)] px-2.5 py-1 text-[11px] font-bold text-[#0ea5e9]">
                      {site.progressLabel}
                    </span>
                  )}
                  {typeof site.todayUpdateCount === "number" && (
                    <span className="rounded-full bg-[rgba(255,214,10,.14)] px-2.5 py-1 text-[11px] font-bold text-accent">
                      오늘 업데이트 {site.todayUpdateCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
