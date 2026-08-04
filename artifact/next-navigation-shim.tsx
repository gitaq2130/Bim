"use client";

import { useMemo } from "react";
import { useRouterCtx } from "./router-context";

export function useRouter() {
  const { push, back } = useRouterCtx();
  return useMemo(() => ({ push, back }), [push, back]);
}

export function usePathname() {
  return useRouterCtx().state.pathname;
}

export function useSearchParams() {
  const { state } = useRouterCtx();
  return useMemo(() => new URLSearchParams(state.search), [state.search]);
}
