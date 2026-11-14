// 최소 벡터 PDF 작성기 (선 + 영문 문자), 색상별 선굵기
const MM = 72 / 25.4;
const hex = (c) => { const n = parseInt((c || '#000000').slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const ink = (c) => { const [r, g, b] = hex(c); const lum = 0.299 * r + 0.587 * g + 0.114 * b; return lum > 0.85 ? [0, 0, 0] : [r * 0.8, g * 0.8, b * 0.8]; }; // 흰색은 검정으로, 나머지는 약간 진하게
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');

// items: [{color, segs:[[a,b]], text:{p,h,s,rot,center}}]
export function pdfDoc(items, { pageW = 420, pageH = 297, margin = 12, lw = {}, title = '' } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) { for (const [a, b] of it.segs) for (const p of [a, b]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } if (it.text) { x0 = Math.min(x0, it.text.p[0]); y0 = Math.min(y0, it.text.p[1]); x1 = Math.max(x1, it.text.p[0]); y1 = Math.max(y1, it.text.p[1]); } }
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1000; }
  const aw = pageW - margin * 2, ah = pageH - margin * 2 - 8;
  const sc = Math.min(aw / (x1 - x0 || 1), ah / (y1 - y0 || 1)); // mm(종이)/mm(실제)
  const ox = margin + (aw - (x1 - x0) * sc) / 2, oy = margin + 8 + (ah - (y1 - y0) * sc) / 2;
  const T = (p) => [((p[0] - x0) * sc + ox) * MM, ((p[1] - y0) * sc + oy) * MM];
  const f = (n) => n.toFixed(2);
  const ops = ['1 J 1 j'];
  // 색상별로 묶어서 출력
  const groups = new Map(); for (const it of items) { if (!groups.has(it.color)) groups.set(it.color, []); groups.get(it.color).push(it); }
  for (const [col, its] of groups) {
    const [r, g, b] = ink(col); ops.push(`${f(r)} ${f(g)} ${f(b)} RG ${f(r)} ${f(g)} ${f(b)} rg ${f((lw[col] ?? 0.25) * MM)} w`);
    for (const it of its) {
      for (const [a, b2] of it.segs) { const p = T(a), q = T(b2); ops.push(`${f(p[0])} ${f(p[1])} m ${f(q[0])} ${f(q[1])} l S`); }
      if (it.text && it.text.s) {
        const s = ascii(it.text.s); if (!s) continue; const p = T(it.text.p); const size = Math.max(2, it.text.h * sc * MM); const a = (it.text.rot || 0) * Math.PI / 180;
        const c = Math.cos(a), sn = Math.sin(a); const dx = it.text.center ? -s.length * size * 0.28 : 0;
        ops.push(`BT /F1 ${f(size)} Tf ${f(c)} ${f(sn)} ${f(-sn)} ${f(c)} ${f(p[0] + dx * c)} ${f(p[1] + dx * sn)} Tm (${s}) Tj ET`);
      }
    }
  }
  // 표제
  ops.push(`0 0 0 rg BT /F1 9 Tf ${f(margin * MM)} ${f((margin) * MM)} Td (${ascii(title) || 'Builder'}  -  scale 1:${Math.round(1 / sc)}  -  Builder CAD) Tj ET`);
  ops.push(`0.5 w 0 0 0 RG ${f(margin / 2 * MM)} ${f(margin / 2 * MM)} ${f((pageW - margin) * MM)} ${f((pageH - margin) * MM)} re S`);
  const content = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pageW * MM)} ${f(pageH * MM)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n'; const xref = [];
  objs.forEach((o, i) => { xref.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xs = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + xref.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xs}\n%%EOF`;
  return out;
}

// JPEG 한 장을 용지 크기로 감싼 PDF (한글 포함 고해상 출력용)
export function pdfFromJpeg(jpg, pxW, pxH, pageW, pageH, title = '') { return pdfPagesFromJpeg([{ jpg, pxW, pxH, pageW, pageH }], title); }
// 여러 장: pages [{jpg(Uint8Array), pxW, pxH, pageW(mm), pageH(mm)}]
export function pdfPagesFromJpeg(pages, title = '') {
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push('%PDF-1.4\n%xxxx\n');
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  const N = pages.length; const pageId = (i) => 4 + i * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => pageId(i) + ' 0 R').join(' ')}] /Count ${N} >>`);
  obj(3, `<< /Title (${ascii(title) || 'Builder'}) /Producer (Builder) >>`);
  pages.forEach((p, i) => {
    const W = p.pageW * MM, H = p.pageH * MM; const id = pageId(i); const content = `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    obj(id + 1, [`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`, p.jpg, '\nendstream']);
    obj(id + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const total = 3 + N * 3; const xref = len; let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`; for (let i = 1; i <= total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return new Blob([out], { type: 'application/pdf' });
}
