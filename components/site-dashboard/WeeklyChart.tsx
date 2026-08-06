"use client";

export default function WeeklyChart({
  weekPlan,
  weekActual,
  asOfDate,
}: {
  weekPlan: number[];
  weekActual: number[];
  asOfDate: string;
}) {
  const W = weekPlan.length;
  const colW = 44;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const chH = 180;
  const chW = padL + padR + W * colW;
  const totalH = chH + padT + 26;

  let sp = 0;
  let sa = 0;
  const cp: number[] = [];
  const ca: number[] = [];
  weekPlan.forEach((v, i) => {
    sp += v;
    sa += weekActual[i];
    cp.push(sp);
    ca.push(sa);
  });

  const wkMax = 4;
  const cuMax = Math.max(cp[W - 1], ca[W - 1]) * 1.05;
  const yW = (v: number) => chH - (v / wkMax) * chH;
  const yC = (v: number) => chH - (v / cuMax) * chH;

  // asOfDate is "YYYY. M. D" (Korean format)
  const [yStr, mStr, dStr] = asOfDate.split(".").map((s) => s.trim());
  const base = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
  const lab = (i: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (W - 1 - i) * 7);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const linePath = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = padL + i * colW + colW / 2;
        return `${i ? "L" : "M"}${x} ${padT + yC(v)}`;
      })
      .join(" ");

  return (
    <svg width={chW} height={totalH} viewBox={`0 0 ${chW} ${totalH}`} className="block">
      {[0, 1, 2, 3, 4].map((g) => {
        const y = padT + chH - (g / 4) * chH;
        return (
          <line key={g} x1={padL} y1={y} x2={chW - padR} y2={y} stroke="#262932" strokeWidth={1} />
        );
      })}
      {weekPlan.map((v, i) => {
        const cx = padL + i * colW + colW / 2;
        const bw = 11;
        const hp = chH - yW(v);
        const ha = chH - yW(weekActual[i]);
        return (
          <g key={i}>
            <rect x={cx - bw - 1} y={padT + yW(v)} width={bw} height={hp} rx={2} fill="#6c707c" />
            <rect x={cx + 1} y={padT + yW(weekActual[i])} width={bw} height={ha} rx={2} fill="#ffd60a" />
          </g>
        );
      })}
      <path d={linePath(cp)} fill="none" stroke="#6c707c" strokeWidth={2} strokeDasharray="5 4" />
      <path d={linePath(ca)} fill="none" stroke="#ef4444" strokeWidth={2.5} />
      {ca.map((v, i) => {
        const x = padL + i * colW + colW / 2;
        return <circle key={i} cx={x} cy={padT + yC(v)} r={3} fill="#ef4444" />;
      })}
      {weekPlan.map((_, i) => {
        if (i % 2) return null;
        const x = padL + i * colW + colW / 2;
        return (
          <text
            key={i}
            x={x}
            y={chH + padT + 16}
            fill="#6c707c"
            fontSize={10}
            fontWeight={700}
            textAnchor="middle"
          >
            {lab(i)}
          </text>
        );
      })}
    </svg>
  );
}
