export const pct = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined || Number.isNaN(v) ? "-" : `${(v * 100).toFixed(digits)}%`;

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const fmtNum = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(digits);
