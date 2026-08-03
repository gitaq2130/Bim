"use client";

import { useEffect, useRef } from "react";

export function useAutoScrollToBottom<T>(dep: T) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight });
      });
    });
  }, [dep]);

  return ref;
}
