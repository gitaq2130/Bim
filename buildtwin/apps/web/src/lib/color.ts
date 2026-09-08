/** 배경 hex 색의 명도로 검정/흰 글자를 고른다. 배지류(StateBadge, ApprovalStatusBadge)가 공유한다. */
export function textColorFor(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
}
