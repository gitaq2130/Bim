"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Site } from "@/lib/types";
import { SITE_CONFIG } from "@/lib/siteConfig";
import styles from "./DailyDashboardPane.module.css";
import { useLiveClockWeather } from "./useLiveClockWeather";
import {
  addDays,
  colorForWorkType,
  entriesFor,
  entryCompareKey,
  entryLocationText,
  equipmentCountOf,
  fmtDate,
  getEntryRect,
  isCoordinateEntry,
  isManualEntry,
  overviewDetailData,
  parseBlockInput,
  resolveTaskFloorId,
  shortWorkTypeLabel,
  uid,
  workforceFor,
} from "./engine";
import { drawCalibrationMarkers, drawPlaceholderBackground, drawZoneLabels, drawZoneRect } from "./canvasRender";
import type { CanvasZone, Entry, Floor, ManualRect, WorkforceRecord, ZoneRect } from "./types";

import floor1Src from "./assets/floor1.jpeg";
import floor2Src from "./assets/floor2.jpeg";
import floor3Src from "./assets/floor3.jpeg";
import floor1Calib from "./assets/floor1-calib.json";
import floor2Calib from "./assets/floor2-calib.json";
import floor3Calib from "./assets/floor3-calib.json";

const FLOOR_DEFS = [
  { name: "1층 (지상1층 평면도)", src: floor1Src.src, calibration: floor1Calib },
  { name: "2층 (지상2층 평면도)", src: floor2Src.src, calibration: floor2Calib },
  { name: "3층 (지상3층 평면도)", src: floor3Src.src, calibration: floor3Calib },
] as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function eventCanvasPoint(ev: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
  const bcr = canvas.getBoundingClientRect();
  const scaleX = canvas.width / bcr.width;
  const scaleY = canvas.height / bcr.height;
  return {
    x: Math.max(0, Math.min(canvas.width, (ev.clientX - bcr.left) * scaleX)),
    y: Math.max(0, Math.min(canvas.height, (ev.clientY - bcr.top) * scaleY)),
  };
}
function pointInRect(p: { x: number; y: number }, r: ZoneRect | null | undefined): boolean {
  return !!r && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}
function hitTestZone(p: { x: number; y: number }, zones: CanvasZone[]): CanvasZone | null {
  for (let i = zones.length - 1; i >= 0; i--) if (pointInRect(p, zones[i].labelRect)) return zones[i];
  for (let i = zones.length - 1; i >= 0; i--) if (pointInRect(p, zones[i].rect)) return zones[i];
  return null;
}

const DIFF_TAG_COLOR: Record<string, string> = { new: "#4E8B63", cont: "#3E5A8C", end: "#6B6558" };

export default function DailyDashboardPane({ site }: { site: Site }) {
  const { clock, weather } = useLiveClockWeather();

  const [floors, setFloors] = useState<Floor[]>([]);
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => fmtDate(new Date()));
  const [compareMode, setCompareMode] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  const [expandedWfId, setExpandedWfId] = useState<string | null>(null);
  const [activeOverviewKey, setActiveOverviewKey] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [manualAssignEntryId, setManualAssignEntryId] = useState<string | null>(null);
  const [dragPreviewRect, setDragPreviewRect] = useState<ZoneRect | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const [entryInput, setEntryInput] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  const [pendingCalibPoint, setPendingCalibPoint] = useState<{ px: number; py: number } | null>(null);
  const [calibFormOpen, setCalibFormOpen] = useState(false);
  const [calibLabelValue, setCalibLabelValue] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);
  const currentZonesRef = useRef<CanvasZone[]>([]);
  const [canvasScale, setCanvasScale] = useState(1);

  /* ---------------- Load the three real floor plans on mount ---------------- */
  useEffect(() => {
    let cancelled = false;
    Promise.all(FLOOR_DEFS.map((def) => loadImage(def.src).then((img) => ({ def, img }))))
      .then((loaded) => {
        if (cancelled) return;
        const newFloors: Floor[] = loaded.map(({ def, img }) => ({
          id: uid(),
          name: def.name,
          type: "image",
          image: img,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          calibration: def.calibration,
          pdfDoc: null,
          numPages: 1,
        }));
        setFloors(newFloors);
        setCurrentFloorId(newFloors[0]?.id ?? null);
      })
      .catch((err) => console.error("도면 이미지를 불러오지 못했습니다", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const currentFloor = useMemo(() => floors.find((f) => f.id === currentFloorId) ?? null, [floors, currentFloorId]);
  const baseDate = useMemo(() => addDays(selectedDate, -1), [selectedDate]);

  const allEntriesToday = useMemo(() => entriesFor(entries, floors, selectedDate), [entries, floors, selectedDate]);
  const todayEntries = useMemo(
    () => (currentFloor ? entriesFor(entries, floors, selectedDate, currentFloor.id) : []),
    [entries, floors, selectedDate, currentFloor]
  );
  const baseEntries = useMemo(
    () => (currentFloor ? entriesFor(entries, floors, baseDate, currentFloor.id) : []),
    [entries, floors, baseDate, currentFloor]
  );
  const coordinateEntries = useMemo(() => todayEntries.filter(isCoordinateEntry), [todayEntries]);
  const otherEntries = useMemo(() => todayEntries.filter(isManualEntry), [todayEntries]);
  const workforceToday = useMemo(() => workforceFor(workforce, selectedDate), [workforce, selectedDate]);

  /* ---------------- Zones to draw on the canvas ---------------- */
  const { zones, unresolvedCount } = useMemo(() => {
    if (!currentFloor) return { zones: [] as CanvasZone[], unresolvedCount: 0 };
    const list: CanvasZone[] = [];
    let unresolved = 0;
    const pushToday = (e: Entry, tag: string | null) => {
      const rect = getEntryRect(currentFloor, e);
      if (!rect) {
        if (isCoordinateEntry(e)) unresolved++;
        return;
      }
      list.push({
        rect, entry: e, tag: tag ?? (e.sourceType === "manual" ? "수동 지정" : null), showLabel: true,
        fillAlpha: compareMode ? 0.36 : 0.34, strokeAlpha: compareMode ? 0.92 : 0.9, dashed: false,
      });
    };
    if (compareMode) {
      const baseKeys = new Set(baseEntries.map(entryCompareKey));
      const todayKeys = new Set(todayEntries.map(entryCompareKey));
      baseEntries.forEach((e) => {
        const rect = getEntryRect(currentFloor, e);
        if (!rect) return;
        list.push({
          rect, entry: e, tag: todayKeys.has(entryCompareKey(e)) ? "전날에도 있었음" : "종료(전날)", showLabel: false,
          fillAlpha: 0.16, strokeAlpha: 0.5, dashed: true,
        });
      });
      todayEntries.forEach((e) => pushToday(e, baseKeys.has(entryCompareKey(e)) ? "계속중" : "신규"));
    } else {
      todayEntries.forEach((e) => pushToday(e, null));
    }
    return { zones: list, unresolvedCount: unresolved };
  }, [currentFloor, todayEntries, baseEntries, compareMode]);

  /* ---------------- Canvas drawing ---------------- */
  const applyZoomStyle = useCallback(() => {
    const canvas = canvasRef.current, wrap = canvasWrapRef.current;
    if (!canvas || !wrap || !currentFloor) return;
    const baseWidth = wrap.clientWidth || 320;
    const aspect = currentFloor.naturalH / currentFloor.naturalW;
    const displayWidth = Math.round(baseWidth * zoomLevel);
    canvas.style.width = displayWidth + "px";
    canvas.style.height = Math.round(displayWidth * aspect) + "px";
  }, [currentFloor, zoomLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentFloor) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = currentFloor.naturalW;
    canvas.height = currentFloor.naturalH;

    if (currentFloor.image) {
      ctx.fillStyle = "#F7F4EC";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(currentFloor.image, 0, 0, canvas.width, canvas.height);
    } else {
      drawPlaceholderBackground(ctx, canvas.width, canvas.height);
    }
    if (calibrationMode) drawCalibrationMarkers(ctx, currentFloor.calibration);
    zones.forEach((z) => drawZoneRect(ctx, z.rect, colorForWorkType(z.entry.workType), z.fillAlpha, z.strokeAlpha, z.dashed));
    drawZoneLabels(ctx, canvas, zones.filter((z) => z.showLabel));
    currentZonesRef.current = zones;
    applyZoomStyle();
  }, [currentFloor, zones, calibrationMode, applyZoomStyle]);

  useEffect(() => {
    window.addEventListener("resize", applyZoomStyle);
    return () => window.removeEventListener("resize", applyZoomStyle);
  }, [applyZoomStyle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => {
      if (canvas.width) setCanvasScale(canvas.clientWidth / canvas.width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  /* ---------------- Floor / date navigation ---------------- */
  function selectFloor(id: string) {
    if (id === currentFloorId) return;
    setCurrentFloorId(id);
    setZoomLevel(1);
    setSelectedEntryId(null);
    cancelManualAssignment();
  }
  function setDate(d: string) {
    setSelectedDate(d);
    setSelectedEntryId(null);
    cancelManualAssignment();
  }

  /* ---------------- Zone tap / calibration tap ---------------- */
  function handleCanvasClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (manualAssignEntryId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = eventCanvasPoint(ev, canvas);
    if (calibrationMode) {
      setPendingCalibPoint({ px: p.x, py: p.y });
      setCalibLabelValue("");
      setCalibFormOpen(true);
      return;
    }
    const hit = hitTestZone(p, currentZonesRef.current);
    const newId = hit ? hit.entry.id : null;
    setSelectedEntryId((cur) => (newId && newId === cur ? null : newId));
  }

  /* ---------------- Manual zone assignment (drag-to-select, pointer events) ---------------- */
  function beginManualAssignment(id: string) {
    setCalibrationMode(false);
    setSelectedEntryId(null);
    setManualAssignEntryId(id);
  }
  function cancelManualAssignment() {
    setManualAssignEntryId(null);
    setDragPreviewRect(null);
    dragStartRef.current = null;
  }
  function handlePointerDown(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!manualAssignEntryId || calibrationMode || ev.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = eventCanvasPoint(ev, canvas);
    dragStartRef.current = p;
    setDragPreviewRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }
  function handlePointerMove(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragStartRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = eventCanvasPoint(ev, canvas);
    const s = dragStartRef.current;
    setDragPreviewRect({ x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y), x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y) });
  }
  function handlePointerUp(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragStartRef.current) return;
    const canvas = canvasRef.current;
    const rect = dragPreviewRect;
    dragStartRef.current = null;
    setDragPreviewRect(null);
    if (canvas) {
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer capture may already be released */
      }
    }
    if (rect && rect.x1 - rect.x0 >= 8 && rect.y1 - rect.y0 >= 8 && manualAssignEntryId) {
      const id = manualAssignEntryId;
      const manualRect: ManualRect = { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, manualRect } : e)));
      setManualAssignEntryId(null);
    }
  }

  /* ---------------- Calibration ---------------- */
  function toggleCalibrationMode() {
    if (manualAssignEntryId) cancelManualAssignment();
    setCalibrationMode((m) => !m);
  }
  function saveCalibPoint() {
    const raw = calibLabelValue.trim();
    if (!raw) {
      setCalibFormOpen(false);
      return;
    }
    const m = raw.match(/^([XxYy])\s*([A-Za-z0-9]+)$/);
    if (!m) {
      alert("라벨 형식이 올바르지 않습니다. 예: X1, Y5");
      return;
    }
    const axis = m[1].toUpperCase() as "X" | "Y";
    const label = m[2];
    if (!currentFloor || !pendingCalibPoint) {
      setCalibFormOpen(false);
      return;
    }
    const point = pendingCalibPoint;
    const floorId = currentFloor.id;
    setFloors((prev) =>
      prev.map((f) => (f.id === floorId ? { ...f, calibration: { ...f.calibration, [axis]: { ...f.calibration[axis], [label]: point } } } : f))
    );
    setCalibFormOpen(false);
  }

  /* ---------------- PDF upload ---------------- */
  async function renderPdfPage(pdf: import("pdfjs-dist").PDFDocumentProxy, pageNum: number, floorId: string) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const maxDim = 1300;
    const scale = maxDim / Math.max(viewport.width, viewport.height);
    const scaledViewport = page.getViewport({ scale });
    const off = document.createElement("canvas");
    off.width = scaledViewport.width;
    off.height = scaledViewport.height;
    const offCtx = off.getContext("2d")!;
    await page.render({ canvas: off, canvasContext: offCtx, viewport: scaledViewport }).promise;
    setFloors((prev) =>
      prev.map((f) =>
        f.id === floorId
          ? { ...f, type: "pdf", image: off, naturalW: off.width, naturalH: off.height, calibration: { X: {}, Y: {} }, pdfDoc: pdf, numPages: pdf.numPages }
          : f
      )
    );
    setZoomLevel(1);
  }
  async function handlePdfFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file || !currentFloor) return;
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    await renderPdfPage(pdf, 1, currentFloor.id);
  }
  async function handlePageSelect(ev: React.ChangeEvent<HTMLSelectElement>) {
    if (!currentFloor?.pdfDoc) return;
    await renderPdfPage(currentFloor.pdfDoc, parseInt(ev.target.value, 10), currentFloor.id);
  }

  /* ---------------- Task-text parsing ---------------- */
  function handleAddEntries() {
    if (!currentFloor) return;
    const { blocks, errors } = parseBlockInput(entryInput);
    let addedEntries = 0;
    let addedWorkforce = 0;

    setEntries((prev) => {
      let next = prev;
      blocks.forEach((b) => {
        next = next.filter((e) => !(e.date === selectedDate && e.workType === b.label));
      });
      const newOnes: Entry[] = [];
      blocks.forEach((b) => {
        b.tasks.forEach((t) => {
          const targetFloorId = resolveTaskFloorId(floors, t, currentFloor.id);
          const coord = t.sourceType === "coord" ? t : null;
          newOnes.push({
            id: uid(), floorId: targetFloorId, date: selectedDate,
            workType: b.label, roomName: t.roomName, desc: t.desc,
            sourceType: t.sourceType, explicitFloor: t.floorHint ?? null,
            x1: coord?.x1 ?? null, x2: coord?.x2 ?? null, y1: coord?.y1 ?? null, y2: coord?.y2 ?? null,
          });
          addedEntries++;
        });
      });
      return [...next, ...newOnes];
    });

    setWorkforce((prev) => {
      let next = prev;
      blocks.forEach((b) => {
        next = next.filter((w) => !(w.date === selectedDate && w.workType === b.label));
      });
      const newRecords: WorkforceRecord[] = [];
      blocks.forEach((b) => {
        if (b.headcount !== null || b.headcountDetail || b.equipmentDetail || b.equipment.length > 0 || b.equipmentCount > 0) {
          newRecords.push({
            id: uid(), date: selectedDate, workType: b.label, headcount: b.headcount, headcountDetail: b.headcountDetail,
            equipment: b.equipment, equipmentCount: b.equipmentCount, equipmentDetail: b.equipmentDetail,
          });
          addedWorkforce++;
        }
      });
      return [...next, ...newRecords];
    });

    setParseErrors(errors);
    if (addedEntries > 0 || addedWorkforce > 0) setEntryInput("");
    setSelectedEntryId(null);
    cancelManualAssignment();
  }

  function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selectedEntryId === id) setSelectedEntryId(null);
    if (manualAssignEntryId === id) cancelManualAssignment();
  }
  function clearManualRect(id: string) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, manualRect: undefined } : e)));
    if (selectedEntryId === id) setSelectedEntryId(null);
  }

  /* ---------------- Overview stats & drill-down ---------------- */
  const overview = useMemo(() => {
    if (!currentFloor) return null;
    const unassigned = otherEntries.filter((e) => !e.manualRect).length;
    const workTypes = new Set([...allEntriesToday.map((e) => e.workType), ...workforceToday.map((w) => w.workType)].filter(Boolean));
    const headcount = workforceToday.reduce((s, w) => s + (w.headcount || 0), 0);
    const equipment = workforceToday.reduce((s, w) => s + equipmentCountOf(w), 0);
    return {
      workTypesCount: workTypes.size, headcount, equipment,
      coordCount: coordinateEntries.length, otherCount: otherEntries.length, unassigned,
    };
  }, [currentFloor, allEntriesToday, workforceToday, coordinateEntries, otherEntries]);

  const overviewDetail = useMemo(() => {
    if (!activeOverviewKey || !currentFloor) return null;
    return overviewDetailData(activeOverviewKey, { entries, floors, workforce, selectedDate, currentFloor });
  }, [activeOverviewKey, currentFloor, entries, floors, workforce, selectedDate]);

  /* ---------------- Diff (전날 대비 변화) ---------------- */
  const diff = useMemo(() => {
    if (!compareMode || !currentFloor) return null;
    const baseKeys = new Set(baseEntries.map(entryCompareKey));
    const todayKeys = new Set(todayEntries.map(entryCompareKey));
    const fresh = todayEntries.filter((e) => !baseKeys.has(entryCompareKey(e)));
    const cont = todayEntries.filter((e) => baseKeys.has(entryCompareKey(e)));
    const ended = baseEntries.filter((e) => !todayKeys.has(entryCompareKey(e)));
    const rows: { tag: string; cls: "new" | "cont" | "end"; e: Entry }[] = [
      ...fresh.map((e) => ({ tag: "신규", cls: "new" as const, e })),
      ...cont.map((e) => ({ tag: "계속중", cls: "cont" as const, e })),
      ...ended.map((e) => ({ tag: "종료", cls: "end" as const, e })),
    ];
    return { freshCount: fresh.length, contCount: cont.length, endCount: ended.length, rows };
  }, [compareMode, currentFloor, baseEntries, todayEntries]);

  const otherWorkGroups = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    otherEntries.forEach((e) => {
      if (!groups.has(e.workType)) groups.set(e.workType, []);
      groups.get(e.workType)!.push(e);
    });
    return Array.from(groups.entries());
  }, [otherEntries]);

  const selectedZone = useMemo(() => zones.find((z) => z.entry.id === selectedEntryId) ?? null, [zones, selectedEntryId]);

  const floorLabel = currentFloor?.name.split(" ")[0] ?? "-";
  const badgeText = site.name.replace(/\s*신축공사\s*$/, "");

  const OVERVIEW_TILES: { key: string; label: string; value: number; warn?: boolean }[] = overview
    ? [
        { key: "workTypes", label: "투입 공종", value: overview.workTypesCount },
        { key: "headcount", label: "총 인원", value: overview.headcount },
        { key: "equipment", label: "장비", value: overview.equipment },
        { key: "coord", label: "좌표 작업", value: overview.coordCount },
        { key: "other", label: "기타 작업", value: overview.otherCount },
        { key: "unassigned", label: "영역 미지정", value: overview.unassigned, warn: true },
      ]
    : [];

  return (
    <div className={styles.root}>
      <div className={styles.starfield} />
      <div className={styles.content}>
        {/* ---------------- Header ---------------- */}
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>현장 일일 공사현황 대쉬보드</h1>
            <span className={styles.badge}>{badgeText}</span>
          </div>
          <div className={styles.liveRow}>
            <div className={styles.liveCard}>
              <span className={styles.liveLabel}>대한민국 · KST</span>
              <b className={styles.liveMain}>{clock.time}</b>
              <span className={styles.liveSub}>{clock.date}</span>
            </div>
            <div className={styles.liveCard}>
              <span className={styles.liveLabel}>{SITE_CONFIG.regionLabel} 현재 날씨</span>
              <b className={styles.liveMain}>{weather.main}</b>
              <span className={styles.liveSub}>{weather.detail}</span>
            </div>
          </div>
          <div className={styles.dateRow}>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setDate(addDays(selectedDate, -1))}>
              ◀ 전날
            </button>
            <input
              type="date"
              className={styles.dateInput}
              value={selectedDate}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setDate(fmtDate(new Date()))}>
              오늘
            </button>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setDate(addDays(selectedDate, 1))}>
              다음날 ▶
            </button>
            <label className={styles.switchLabel}>
              <input type="checkbox" checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
              전날과 비교
            </label>
            <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => window.print()}>
              🖨 인쇄
            </button>
          </div>
        </div>

        {/* ---------------- Floor tabs ---------------- */}
        <div className={styles.floorTabs}>
          {floors.length === 0 && <div className={styles.emptyNote}>도면을 불러오는 중...</div>}
          {floors.map((f) => (
            <button
              key={f.id}
              className={`${styles.floorTab} ${f.id === currentFloorId ? styles.active : ""}`}
              onClick={() => selectFloor(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>

        {/* ---------------- Overview ---------------- */}
        <section className={styles.section}>
          <div className={`${styles.card} ${styles.cardAccentGold}`}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>오늘 현황</h2>
              <span className={styles.sectionMeta}>
                {selectedDate} · {floorLabel}
              </span>
            </div>
            <div className={styles.overviewGrid}>
              {OVERVIEW_TILES.map((s) => (
                <button
                  key={s.key}
                  className={`${styles.overviewStat} ${activeOverviewKey === s.key ? styles.active : ""}`}
                  onClick={() => setActiveOverviewKey((cur) => (cur === s.key ? null : s.key))}
                >
                  <span className={styles.overviewStatLabel}>{s.label}</span>
                  <b className={`${styles.overviewStatValue} ${s.warn ? styles.warn : ""}`}>{s.value}</b>
                </button>
              ))}
            </div>
            {overviewDetail && (
              <div className={styles.overviewDetail}>
                <div className={styles.overviewDetailHead}>
                  <span>{overviewDetail.title}</span>
                  <span className={styles.overviewDetailContext}>{overviewDetail.context}</span>
                </div>
                {overviewDetail.items.length === 0 ? (
                  <div className={styles.overviewDetailItem}>
                    <span className={styles.sub}>표시할 상세 내용이 없습니다.</span>
                  </div>
                ) : (
                  overviewDetail.items.map((item, i) => (
                    <div key={i} className={styles.overviewDetailItem}>
                      <b>{item.main}</b>
                      <span className={styles.sub}>{item.sub}</span>
                    </div>
                  ))
                )}
              </div>
            )}
            <div className={styles.miscStatus}>
              <span className={styles.miscStatusLabel}>기타 현황</span>
              <span className={styles.smallMuted}>별도 입력 내용이 없습니다.</span>
            </div>
          </div>
        </section>

        {/* ---------------- Workforce ---------------- */}
        <section className={styles.section}>
          <div className={styles.card}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>공종 · 인원 · 장비</h2>
              <span className={styles.sectionMeta}>
                총 인원 <b style={{ color: "var(--gold)" }}>{workforceToday.reduce((s, w) => s + (w.headcount || 0), 0)}</b>명
              </span>
            </div>
            {workforceToday.length === 0 ? (
              <div className={styles.emptyNote}>등록된 공종/인원/장비가 없습니다.</div>
            ) : (
              <div className={styles.workforceCards}>
                {workforceToday.map((w) => {
                  const expanded = expandedWfId === w.id;
                  const equipmentDetail = w.equipmentDetail || (w.equipment || []).join(", ");
                  return (
                    <button
                      key={w.id}
                      className={styles.workforceCard}
                      onClick={() => setExpandedWfId((cur) => (cur === w.id ? null : w.id))}
                    >
                      <div className={styles.workforceHead}>
                        <span className={styles.dot} style={{ background: colorForWorkType(w.workType) }} />
                        <span className={styles.workforceName}>{w.workType}</span>
                      </div>
                      <div className={styles.workforceMetric}>
                        인원 <b>{w.headcount || 0}</b>명
                      </div>
                      <div className={styles.workforceMetric}>
                        장비 <b>{equipmentCountOf(w)}</b>대
                      </div>
                      {expanded && (
                        <div className={styles.workforceDetail}>
                          <div>인원 상세: {w.headcountDetail || "상세 입력 없음"}</div>
                          <div style={{ marginTop: 4 }}>장비 상세: {equipmentDetail || "상세 입력 없음"}</div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ---------------- Floor plan canvas ---------------- */}
        <section className={styles.section}>
          <div className={styles.card}>
            <div className={styles.toolbar}>
              <div className={styles.toolbarGroup}>
                <span className={styles.pageBadge}>{floorLabel}</span>
                {currentFloor && currentFloor.numPages > 1 && (
                  <select
                    className={styles.dateInput}
                    style={{ flex: "none" }}
                    onChange={handlePageSelect}
                    defaultValue={1}
                  >
                    {Array.from({ length: currentFloor.numPages }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>
                        페이지 {p}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className={styles.toolbarGroup}>
                <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => pdfFileInputRef.current?.click()}>
                  📄 PDF 도면 업로드/교체
                </button>
                <input ref={pdfFileInputRef} type="file" accept="application/pdf" hidden onChange={handlePdfFile} />
                <button
                  className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall} ${calibrationMode ? styles.active : ""}`}
                  onClick={toggleCalibrationMode}
                >
                  📐 축 보정 모드
                </button>
                <span className={styles.zoomControls}>
                  <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => setZoomLevel((z) => Math.max(0.4, z / 1.25))}>
                    －
                  </button>
                  <span className={styles.zoomPct}>{Math.round(zoomLevel * 100)}%</span>
                  <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => setZoomLevel((z) => Math.min(4, z * 1.25))}>
                    ＋
                  </button>
                </span>
              </div>
            </div>

            {calibrationMode && (
              <div className={styles.hintBanner}>
                <b onClick={toggleCalibrationMode}>축 보정 모드</b>가 켜졌습니다. 도면을 탭한 뒤, 예: <span>X1</span>, <span>Y5</span> 처럼 라벨을
                입력해 등록하세요.
              </div>
            )}
            {unresolvedCount > 0 && (
              <div className={styles.hintBanner}>
                축 보정이 안 된 라벨이 있어 <b>{unresolvedCount}</b>개의 좌표 작업이 도면에 표시되지 않았습니다.
              </div>
            )}
            {manualAssignEntryId && (
              <div className={`${styles.hintBanner} ${styles.hintBannerAssign}`}>
                <b>영역 지정 중</b>입니다. 도면에서 작업 구간을 드래그하세요.{" "}
                <b onClick={cancelManualAssignment}>취소</b>
              </div>
            )}

            <div className={styles.canvasWrap} ref={canvasWrapRef}>
              <canvas
                ref={canvasRef}
                className={styles.canvasEl}
                style={{ touchAction: manualAssignEntryId ? "none" : "auto" }}
                onClick={handleCanvasClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
              {dragPreviewRect && (
                <div
                  className={styles.assignmentPreview}
                  style={{
                    left: dragPreviewRect.x0 * canvasScale,
                    top: dragPreviewRect.y0 * canvasScale,
                    width: Math.max(1, (dragPreviewRect.x1 - dragPreviewRect.x0) * canvasScale),
                    height: Math.max(1, (dragPreviewRect.y1 - dragPreviewRect.y0) * canvasScale),
                  }}
                />
              )}
              <div className={styles.tooltipLayer}>
                {selectedZone && (
                  <div
                    className={styles.zoneTooltip}
                    style={{ left: selectedZone.rect.x0 * canvasScale, top: Math.max(0, selectedZone.rect.y0 * canvasScale - 4) }}
                  >
                    <div className={styles.ttZone}>{entryLocationText(selectedZone.entry)}</div>
                    <div className={styles.ttWork}>
                      {shortWorkTypeLabel(selectedZone.entry.workType)}
                      <span className={styles.smallMuted}> · {selectedZone.entry.workType}</span>
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>
                      {selectedZone.entry.roomName && selectedZone.entry.roomName !== "기타작업"
                        ? [selectedZone.entry.roomName, selectedZone.entry.desc].filter(Boolean).join(" ")
                        : selectedZone.entry.desc}
                    </div>
                    <div className={styles.ttDate}>
                      {selectedZone.entry.date}
                      {selectedZone.tag ? " · " + selectedZone.tag : ""}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.decimalBanner}>
              <span className={styles.strong}>좌표 소숫점 지원 ·</span>
              <span>X4.6은 X4~X5 구간을 10등분한 4.6 지점입니다.</span>
              <span className={styles.decimalBar}>
                <span style={{ flex: 6, background: "var(--gold)" }} />
                <span style={{ flex: 1, background: "var(--gold-bright)" }} />
                <span style={{ flex: 3, background: "transparent" }} />
              </span>
            </div>

            {calibFormOpen && (
              <div className={styles.calibForm}>
                <input
                  autoFocus
                  placeholder="예: X1 또는 Y5"
                  value={calibLabelValue}
                  onChange={(e) => setCalibLabelValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveCalibPoint()}
                />
                <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`} onClick={saveCalibPoint}>
                  등록
                </button>
                <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => setCalibFormOpen(false)}>
                  취소
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ---------------- Task input ---------------- */}
        <section className={styles.section}>
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>오늘 작업 입력</h2>
            <textarea
              className={styles.textarea}
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
              placeholder={
                "7. 철근콘크리트공사(기담건설) 138명_외국인 76명(관리6, 직영3)\n장비 : 무\n작업내용\n계단실#10(X32~X34, Y19~Y20) 1F 벽체배관작업\n(X4.6-8.2, Y19-20) 계단#1 내부 견출작업"
              }
            />
            <div className={styles.formatExample}>
              좌표는 정수 뒤에 소숫점 한 자리까지 입력할 수 있습니다. 예: <code>X4.6~X8.2</code>. 작업 문장에 1F/2F/3F 또는 1층/2층/3층이
              있으면 해당 층 도면으로 자동 배정합니다. 층 표기가 없으면 현재 선택 층({currentFloor?.name ?? "-"})을 사용합니다. 좌표 없는
              문장은 하단 <b>기타작업</b>으로 분류됩니다.
            </div>
            <button className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: "100%" }} onClick={handleAddEntries}>
              + 오늘 작업 반영
            </button>
            {parseErrors.length > 0 && (
              <div className={styles.parseErrors}>
                공종 제목보다 먼저 입력되어 반영하지 못한 줄입니다:
                <br />
                {parseErrors.map((e, i) => (
                  <div key={i}>· {e}</div>
                ))}
              </div>
            )}

            {compareMode && diff && (
              <div style={{ marginTop: 16 }}>
                <h2 className={styles.sectionTitle}>전날 대비 변화</h2>
                <div className={styles.diffCountRow}>
                  <div className={styles.diffCount} style={{ color: "#8FD9A3" }}>
                    <b>{diff.freshCount}</b>신규
                  </div>
                  <div className={styles.diffCount} style={{ color: "#9FC0E8" }}>
                    <b>{diff.contCount}</b>계속중
                  </div>
                  <div className={styles.diffCount} style={{ color: "#C9C2AE" }}>
                    <b>{diff.endCount}</b>종료
                  </div>
                </div>
                {diff.rows.length === 0 ? (
                  <div className={styles.emptyNote}>전날/오늘 모두 등록된 작업이 없습니다.</div>
                ) : (
                  diff.rows.map((r, i) => (
                    <div key={i} className={styles.diffItem}>
                      <span className={styles.diffTag} style={{ background: DIFF_TAG_COLOR[r.cls] }}>
                        {r.tag}
                      </span>
                      <div>
                        <span style={{ color: "var(--gold)" }}>{entryLocationText(r.e)}</span> · <b>{r.e.workType}</b>
                        <br />
                        <span className={styles.smallMuted}>
                          {[r.e.roomName, r.e.desc].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <h2 className={styles.sectionTitle} style={{ marginTop: 16 }}>
              선택한 날짜 작업 목록
            </h2>
            <div className={styles.entryList}>
              {coordinateEntries.length === 0 ? (
                <div className={styles.emptyNote}>좌표가 등록된 작업이 없습니다.</div>
              ) : (
                coordinateEntries.map((e) => (
                  <div key={e.id} className={styles.entryCard}>
                    <span className={styles.dot} style={{ background: colorForWorkType(e.workType), marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                      <div className={styles.zone}>{entryLocationText(e)}</div>
                      <div className={styles.work}>{e.workType}</div>
                      {e.roomName && <div className={styles.room}>{e.roomName}</div>}
                      <div className={styles.desc}>{e.desc}</div>
                    </div>
                    <button className={styles.del} onClick={() => deleteEntry(e.id)} title="삭제">
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className={styles.section} style={{ margin: "16px 0 0 0", borderTop: "1px solid var(--border-hairline)", paddingTop: 14 }}>
              <h2 className={styles.sectionTitle}>기타작업 · 수동 영역 지정</h2>
              <div className={styles.smallMuted} style={{ marginBottom: 8 }}>
                좌표 없이 입력한 작업입니다. 작업별로 &lsquo;영역 지정&rsquo;을 누른 뒤 도면에서 드래그하세요.
              </div>
              {otherWorkGroups.length === 0 ? (
                <div className={styles.emptyNote}>기타작업이 없습니다.</div>
              ) : (
                otherWorkGroups.map(([workType, items]) => (
                  <div key={workType} style={{ marginBottom: 12 }}>
                    <div className={styles.otherWorkGroupTitle}>
                      <span className={styles.dot} style={{ background: colorForWorkType(workType) }} />
                      {shortWorkTypeLabel(workType)}
                      <span className={styles.smallMuted}>{workType.match(/\([^)]*\)\s*$/)?.[0] || ""}</span>
                    </div>
                    {items.map((e) => (
                      <div key={e.id} className={`${styles.otherCard} ${manualAssignEntryId === e.id ? styles.activeAssign : ""}`}>
                        {e.roomName && e.roomName !== "기타작업" && <div className={styles.otherRoom}>{e.roomName}</div>}
                        <div className={styles.otherDesc}>{e.desc}</div>
                        <div className={styles.otherActions}>
                          <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => beginManualAssignment(e.id)}>
                            {e.manualRect ? "영역 재지정" : "도면에 영역 지정"}
                          </button>
                          {e.manualRect && (
                            <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => clearManualRect(e.id)}>
                              영역 해제
                            </button>
                          )}
                          <span className={`${styles.manualState} ${e.manualRect ? styles.assigned : ""}`}>
                            {e.manualRect ? "● 도면 지정됨" : "○ 영역 미지정"}
                          </span>
                          <button className={styles.del} style={{ marginLeft: "auto" }} onClick={() => deleteEntry(e.id)} title="삭제">
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
