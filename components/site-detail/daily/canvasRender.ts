import { colorForWorkType, hexToRgba, stripCompanyForLabel } from "./engine";
import type { CanvasZone, ZoneRect } from "./types";

export function drawZoneRect(
  ctx: CanvasRenderingContext2D,
  rect: ZoneRect,
  color: string,
  fillAlpha: number,
  strokeAlpha: number,
  dashed: boolean
) {
  const w = Math.max(rect.x1 - rect.x0, 1);
  const h = Math.max(rect.y1 - rect.y0, 1);
  ctx.save();
  ctx.fillStyle = hexToRgba(color, fillAlpha);
  ctx.fillRect(rect.x0, rect.y0, w, h);
  ctx.strokeStyle = hexToRgba(color, strokeAlpha);
  ctx.lineWidth = 2;
  if (dashed) ctx.setLineDash([6, 4]);
  else ctx.setLineDash([]);
  ctx.strokeRect(rect.x0, rect.y0, w, h);
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function labelRectsOverlap(a: ZoneRect, b: ZoneRect, pad = 2): boolean {
  return !(a.x1 + pad <= b.x0 || a.x0 >= b.x1 + pad || a.y1 + pad <= b.y0 || a.y0 >= b.y1 + pad);
}
function labelInsideCanvas(r: ZoneRect, canvas: HTMLCanvasElement): boolean {
  return r.x0 >= 2 && r.y0 >= 2 && r.x1 <= canvas.width - 2 && r.y1 <= canvas.height - 2;
}
function makeLabelRect(cx: number, cy: number, w: number, h: number): ZoneRect {
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}
function nearestPointOnRect(rect: ZoneRect, p: { x: number; y: number }) {
  return { x: Math.max(rect.x0, Math.min(rect.x1, p.x)), y: Math.max(rect.y0, Math.min(rect.y1, p.y)) };
}

interface LabelCandidate {
  rect: ZoneRect;
  outside: boolean;
}

function chooseLabelPlacement(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  zone: CanvasZone,
  text: string,
  placed: { rect: ZoneRect }[],
  allZones: CanvasZone[]
): LabelCandidate {
  ctx.font = '700 9px "Pretendard", sans-serif';
  const padX = 5, h = 15;
  const w = Math.max(24, Math.min(165, ctx.measureText(text).width + padX * 2));
  const r = zone.rect, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const candidates: LabelCandidate[] = [];
  const step = h + 4;
  const offsets = [0, step, -step, step * 2, -step * 2, step * 3, -step * 3, step * 4, -step * 4];

  offsets.forEach((off) => candidates.push({ rect: makeLabelRect(r.x1 + 8 + w / 2, cy + off, w, h), outside: true }));
  offsets.forEach((off) => candidates.push({ rect: makeLabelRect(r.x0 - 8 - w / 2, cy + off, w, h), outside: true }));
  const xoffs = [0, w * 0.65, -w * 0.65, w * 1.3, -w * 1.3, w * 1.95, -w * 1.95];
  xoffs.forEach((off) => candidates.push({ rect: makeLabelRect(cx + off, r.y0 - 8 - h / 2, w, h), outside: true }));
  xoffs.forEach((off) => candidates.push({ rect: makeLabelRect(cx + off, r.y1 + 8 + h / 2, w, h), outside: true }));

  const overlapsPlaced = (c: LabelCandidate) => placed.some((p) => labelRectsOverlap(c.rect, p.rect));
  const overlapsWorkZone = (c: LabelCandidate) => allZones.some((z) => labelRectsOverlap(c.rect, z.rect, 1));

  let pick = candidates.find((c) => labelInsideCanvas(c.rect, canvas) && !overlapsPlaced(c) && !overlapsWorkZone(c));
  if (!pick) pick = candidates.find((c) => labelInsideCanvas(c.rect, canvas) && !overlapsWorkZone(c));
  if (!pick) pick = candidates.find((c) => labelInsideCanvas(c.rect, canvas) && !overlapsPlaced(c));
  if (!pick) pick = candidates.find((c) => labelInsideCanvas(c.rect, canvas));
  if (!pick) {
    const clampedCx = Math.max(w / 2 + 2, Math.min(canvas.width - w / 2 - 2, r.x1 + 8 + w / 2));
    const clampedCy = Math.max(h / 2 + 2, Math.min(canvas.height - h / 2 - 2, cy));
    pick = { rect: makeLabelRect(clampedCx, clampedCy, w, h), outside: true };
  }
  return pick;
}

function drawOneZoneLabel(ctx: CanvasRenderingContext2D, zone: CanvasZone, text: string, placement: LabelCandidate) {
  const lr = placement.rect;
  const color = colorForWorkType(zone.entry.workType);
  const cx = (lr.x0 + lr.x1) / 2, cy = (lr.y0 + lr.y1) / 2;
  ctx.save();
  if (placement.outside) {
    const anchor = nearestPointOnRect(zone.rect, { x: cx, y: cy });
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(cx, cy);
    ctx.strokeStyle = hexToRgba(color, 0.95);
    ctx.lineWidth = 1.25;
    ctx.setLineDash([]);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,.96)";
  ctx.strokeStyle = hexToRgba(color, 0.98);
  ctx.lineWidth = 1.2;
  roundRectPath(ctx, lr.x0, lr.y0, lr.x1 - lr.x0, lr.y1 - lr.y0, 3);
  ctx.fill();
  ctx.stroke();
  ctx.font = '700 9px "Pretendard", sans-serif';
  ctx.fillStyle = "#17233B";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let t = text;
  const maxW = lr.x1 - lr.x0 - 8;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  if (t !== text) t = t + "…";
  ctx.fillText(t, cx, cy + 0.3);
  ctx.restore();
  zone.labelRect = lr;
}

/** 모든 작업영역의 공종 이름표를 영역 밖에 흰색 라벨로 배치한다 (겹침 회피 알고리즘). */
export function drawZoneLabels(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zones: CanvasZone[]) {
  const placed: { rect: ZoneRect }[] = [];
  zones.forEach((zone) => { zone.labelRect = null; });
  zones.forEach((zone) => {
    const text = stripCompanyForLabel(zone.entry.workType);
    if (!text) return;
    const placement = chooseLabelPlacement(ctx, canvas, zone, text, placed, zones);
    drawOneZoneLabel(ctx, zone, text, placement);
    placed.push({ rect: placement.rect });
  });
}

export function drawCalibrationMarkers(
  ctx: CanvasRenderingContext2D,
  calibration: { X: Record<string, { px: number; py: number }>; Y: Record<string, { px: number; py: number }> }
) {
  ctx.font = '11px "Pretendard", monospace';
  ctx.fillStyle = "#f2b33d";
  Object.entries(calibration.X).forEach(([label, p]) => {
    ctx.strokeStyle = "rgba(242,179,61,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.px, 0); ctx.lineTo(p.px, 12); ctx.stroke();
    ctx.fillText("X" + label, p.px - 10, 26);
  });
  Object.entries(calibration.Y).forEach(([label, p]) => {
    ctx.strokeStyle = "rgba(242,179,61,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, p.py); ctx.lineTo(12, p.py); ctx.stroke();
    ctx.fillText("Y" + label, 16, p.py + 4);
  });
}

/** PDF 업로드 전, 실사진 도면이 없는 폴백 배경 (실사용에서는 거의 노출되지 않음). */
export function drawPlaceholderBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#F7F4EC";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#D9D2BC";
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = "#8B8368";
  ctx.font = '13px "Pretendard", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("도면 이미지를 불러오지 못했습니다 · PDF를 업로드해 주세요", w / 2, h / 2);
  ctx.textAlign = "left";
}
