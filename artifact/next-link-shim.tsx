"use client";

import { useRouterCtx } from "./router-context";

export default function Link({
  href,
  className,
  children,
  onClick,
}: {
  href: string;
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const { push } = useRouterCtx();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
        push(href);
      }}
    >
      {children}
    </a>
  );
}
