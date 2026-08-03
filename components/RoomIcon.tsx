"use client";

import { createElement } from "react";
import { getIcon } from "@/lib/icon-map";

export default function RoomIcon({
  name,
  size = 24,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return createElement(getIcon(name), { size, className });
}
