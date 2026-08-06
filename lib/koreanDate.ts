const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function parseKoreanDate(s: string): Date {
  const [y, m, d] = s.split(".").map((p) => parseInt(p.trim(), 10));
  return new Date(y, m - 1, d);
}

export function formatKoreanDate(d: Date): string {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
}

export function weekdayKo(s: string): string {
  return WEEKDAYS[parseKoreanDate(s).getDay()];
}

export function shiftKoreanDate(s: string, deltaDays: number): string {
  const d = parseKoreanDate(s);
  d.setDate(d.getDate() + deltaDays);
  return formatKoreanDate(d);
}
