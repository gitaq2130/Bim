"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquareMore, UserRound } from "lucide-react";

const tabs = [
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
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold ${
              active ? "text-text" : "text-text-3"
            }`}
          >
            <Icon size={26} strokeWidth={active ? 2.25 : 2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
