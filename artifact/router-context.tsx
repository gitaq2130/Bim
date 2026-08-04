"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface RouteState {
  pathname: string;
  search: string;
}

interface RouterCtxValue {
  state: RouteState;
  push: (href: string) => void;
  back: () => void;
}

const RouterCtx = createContext<RouterCtxValue | null>(null);

function parseHref(href: string): RouteState {
  const [pathname, search = ""] = href.split("?");
  return { pathname, search };
}

export function RouterProvider({
  initialPath,
  children,
}: {
  initialPath: string;
  children: React.ReactNode;
}) {
  const [stack, setStack] = useState<RouteState[]>([parseHref(initialPath)]);
  const state = stack[stack.length - 1];

  const push = useCallback((href: string) => {
    setStack((s) => [...s, parseHref(href)]);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const value = useMemo(() => ({ state, push, back }), [state, push, back]);

  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export function useRouterCtx() {
  const ctx = useContext(RouterCtx);
  if (!ctx) throw new Error("RouterProvider is missing from the tree");
  return ctx;
}
