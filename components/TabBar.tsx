"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ContactRound, MessageSquareMore, UserRound } from "lucide-react";

const tabs = [
  { href: "/contacts", label: "연락처", icon: ContactRound },
  { href: "/site", label: "현장", icon: Building2 },
  { href: "/", label: "채팅", icon: MessageSquareMore },
  { href: "/mypage", label: "마이페이지", icon: UserRound },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-[76px] flex-none border-t border-line bg-surface pb-3.5">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
              active ? "text-text" : "text-text-3"
            }`}
          >
            <Icon size={23} strokeWidth={active ? 2.25 : 2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
