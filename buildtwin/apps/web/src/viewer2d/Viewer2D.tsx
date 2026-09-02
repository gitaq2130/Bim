/**
 * Viewer2D — DXF 엔티티를 SVG 로 렌더하는 React 컴포넌트.
 *
 * - 엔티티 하나 = SVG 요소 하나(`data-handle`, `data-layer`). 이벤트는 루트 svg 에서 위임 처리.
 * - 팬(드래그)·휠 줌은 viewBox 조작으로만 한다. shift+드래그 = 영역 선택(rubber-band).
 * - 하이라이트/선택은 React 재렌더 없이 DOM 클래스만 토글한다(대형 도면 성능).
 * - 좌표 반전은 dxfToSvg 의 루트 변환 하나. 여기서는 상수를 두지 않는다.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bboxCenter,
  buildSvgModel,
  drawingToSvg,
  num,
  viewBoxToDrawingBBox,
} from "./dxfToSvg";
import type { SvgElementDescriptor } from "./dxfToSvg";
import { clampOpacity, overlayToSvg } from "./overlay";
import type { OverlaySvgOptions } from "./overlay";
import {
  clientToSvg,
  entitiesInBBox,
  hitTestHandle,
  normalizeBBox,
  svgUnitsPerPixel,
} from "./selection";
import type { RectLike } from "./selection";
import type {
  BBox2D,
  OverlayOptions,
  PlanSection,
  ViewBox,
  Viewer2DHandle,
  Viewer2DProps,
  Viewport,
} from "./types";

export const HIGHLIGHT_CLASS = "highlighted";
export const SELECTED_CLASS = "selected";
const DEFAULT_HIGHLIGHT_COLOR = "#ff3d00";
/** 드래그로 볼지 클릭으로 볼지 가르는 이동량(px). */
const CLICK_TOLERANCE_PX = 3;

// ---------------------------------------------------------------- descriptor → React element

const ATTR_NAME_CACHE = new Map<string, string>();

function reactAttrName(k: string): string {
  if (k === "class") return "className";
  if (k.startsWith("data-") || k.startsWith("aria-") || !k.includes("-")) return k;
  let v = ATTR_NAME_CACHE.get(k);
  if (!v) {
    v = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    ATTR_NAME_CACHE.set(k, v);
  }
  return v;
}

function toProps(attrs: Record<string, string | number>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) p[reactAttrName(k)] = v;
  return p;
}

function renderDescriptor(d: SvgElementDescriptor, key: string | number, topLevel: boolean): React.ReactElement {
  const props = toProps(d.attrs);
  props.key = key;
  if (topLevel && d.handle) {
    props["data-handle"] = d.handle;
    props["data-layer"] = d.layer;
  }
  const children: React.ReactNode = d.children
    ? d.children.map((c, i) => renderDescriptor(c, i, false))
    : d.text !== undefined
      ? d.text
      : null;
  return React.createElement(d.tag, props, children);
}

function viewBoxAttr(vb: ViewBox): string {
  return `${num(vb.x)} ${num(vb.y)} ${num(vb.width)} ${num(vb.height)}`;
}

// ---------------------------------------------------------------- component

interface DragState {
  mode: "pan" | "band";
  pointerId: number | undefined;
  startClient: [number, number];
  startSvg: [number, number];
  startViewBox: ViewBox;
  downHandle: string | null;
  moved: boolean;
}

interface OverlayState {
  section: PlanSection;
  opts: OverlaySvgOptions;
}

export const Viewer2D = forwardRef<Viewer2DHandle, Viewer2DProps>(function Viewer2D(props, ref) {
  const {
    drawingId,
    entities,
    coordinateSystem,
    onSelect,
    onAreaSelect,
    onHover,
    highlightColor = DEFAULT_HIGHLIGHT_COLOR,
    selectedIds,
    className,
    style,
  } = props;

  const svgRef = useRef<SVGSVGElement>(null);
  const model = useMemo(() => buildSvgModel(entities), [entities]);

  // viewBox: state(렌더용) + ref(핸들러·명령형 API 용, 최신값 보장)
  const [viewBox, setViewBoxState] = useState<ViewBox>(model.viewBox);
  const viewBoxRef = useRef<ViewBox>(model.viewBox);
  const setViewBox = useCallback((vb: ViewBox) => {
    viewBoxRef.current = vb;
    setViewBoxState(vb);
  }, []);
  useEffect(() => {
    setViewBox(model.viewBox);
  }, [model, setViewBox]);

  // handle → DOM 요소 인덱스(재렌더 없이 클래스 토글)
  const elementByHandle = useRef<Map<string, Element>>(new Map());
  const highlighted = useRef<Set<string>>(new Set());
  useLayoutEffect(() => {
    const map = new Map<string, Element>();
    const root = svgRef.current;
    if (root) {
      root.querySelectorAll(".v2d-entities [data-handle]").forEach((el) => {
        const h = el.getAttribute("data-handle");
        if (h) map.set(h, el);
      });
    }
    elementByHandle.current = map;
    // 재렌더로 요소가 바뀌었으면 기존 하이라이트를 다시 입힌다
    for (const h of highlighted.current) map.get(h)?.classList.add(HIGHLIGHT_CLASS);
  }, [model]);

  // 제어형 선택(selectedIds) → .selected
  useEffect(() => {
    const map = elementByHandle.current;
    const wanted = new Set(selectedIds ?? []);
    map.forEach((el, h) => el.classList.toggle(SELECTED_CLASS, wanted.has(h)));
  }, [selectedIds, model]);

  // 오버레이
  const [overlay, setOverlayState] = useState<OverlayState | null>(null);
  const overlayElement = useMemo(() => {
    if (!overlay) return null;
    return renderDescriptor(overlayToSvg(overlay.section, overlay.opts), "overlay", false);
  }, [overlay]);

  // 엔티티는 model 이 바뀔 때만 한 번 React 요소로 만든다
  const layerElements = useMemo(
    () =>
      model.layers.map((g) => (
        <g key={g.layer} data-layer={g.layer} stroke={g.color} fill={g.color}>
          {g.elements.map((d, i) => renderDescriptor(d, `${i}:${d.handle}`, true))}
        </g>
      )),
    [model],
  );

  // ---------------------------------------------------------------- helpers

  const getRect = useCallback((): RectLike | null => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, []);

  const zoomLimits = useCallback((): { min: number; max: number } => {
    // 도면 extent 에 비례한 한계(도면 상수 아님)
    const base = Math.max(model.viewBox.width, model.viewBox.height);
    return { min: base * 1e-4, max: base * 1e2 };
  }, [model]);

  const zoomAt = useCallback(
    (svgPt: [number, number], factor: number) => {
      const vb = viewBoxRef.current;
      const { min, max } = zoomLimits();
      const w = Math.min(max, Math.max(min, vb.width * factor));
      const f = w / vb.width;
      const h = vb.height * f;
      setViewBox({
        x: svgPt[0] - (svgPt[0] - vb.x) * f,
        y: svgPt[1] - (svgPt[1] - vb.y) * f,
        width: w,
        height: h,
      });
    },
    [setViewBox, zoomLimits],
  );

  const lastHover = useRef<string | null>(null);
  const emitHover = useCallback(
    (h: string | null) => {
      if (lastHover.current === h) return;
      lastHover.current = h;
      onHover?.(h);
    },
    [onHover],
  );

  // ---------------------------------------------------------------- imperative API

  useImperativeHandle(
    ref,
    (): Viewer2DHandle => ({
      highlight(ids, opts) {
        const map = elementByHandle.current;
        if (opts?.exclusive) {
          for (const h of highlighted.current) map.get(h)?.classList.remove(HIGHLIGHT_CLASS);
          highlighted.current.clear();
        }
        for (const id of ids) {
          const el = map.get(id);
          if (!el) continue; // 알 수 없는 handle 은 무시
          el.classList.add(HIGHLIGHT_CLASS);
          highlighted.current.add(id);
        }
      },
      clearHighlight() {
        const map = elementByHandle.current;
        for (const h of highlighted.current) map.get(h)?.classList.remove(HIGHLIGHT_CLASS);
        highlighted.current.clear();
      },
      panTo(id, opts) {
        const b = model.bboxByHandle.get(id);
        if (!b) return;
        const c = drawingToSvg(bboxCenter(b));
        const vb = viewBoxRef.current;
        const { min, max } = zoomLimits();
        const zoom = opts?.zoom && opts.zoom > 0 ? opts.zoom : 1;
        const w = Math.min(max, Math.max(min, vb.width / zoom));
        const h = vb.height * (w / vb.width);
        setViewBox({ x: c[0] - w / 2, y: c[1] - h / 2, width: w, height: h });
      },
      setOverlay(section, opts?: OverlayOptions) {
        if (!section) {
          setOverlayState(null);
          return;
        }
        setOverlayState({
          section,
          opts: {
            opacity: opts?.opacity,
            transform: opts?.transform,
            color: opts?.color,
            strokeWidth: opts?.strokeWidth,
          },
        });
      },
      setOverlayOpacity(opacity) {
        const o = clampOpacity(opacity);
        setOverlayState((prev) => (prev ? { ...prev, opts: { ...prev.opts, opacity: o } } : prev));
      },
      fitToView() {
        setViewBox(model.viewBox);
      },
      getViewport(): Viewport {
        const vb = viewBoxRef.current;
        return {
          viewBox: { ...vb },
          drawingBBox: viewBoxToDrawingBBox(vb),
          drawingExtent: model.bbox ?? viewBoxToDrawingBBox(model.viewBox),
        };
      },
    }),
    [model, setViewBox, zoomLimits],
  );

  // ---------------------------------------------------------------- pointer interaction

  const drag = useRef<DragState | null>(null);
  const [band, setBand] = useState<BBox2D | null>(null); // SVG 좌표(y-down)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      const rect = getRect();
      if (!rect) return;
      const vb = viewBoxRef.current;
      const startSvg = clientToSvg(vb, rect, e.clientX, e.clientY);
      drag.current = {
        mode: e.shiftKey ? "band" : "pan",
        pointerId: e.pointerId,
        startClient: [e.clientX, e.clientY],
        startSvg,
        startViewBox: vb,
        downHandle: hitTestHandle(e.target),
        moved: false,
      };
      const el = e.currentTarget;
      if (typeof el.setPointerCapture === "function" && typeof e.pointerId === "number") {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom 등 미지원 환경 */
        }
      }
      if (e.shiftKey) e.preventDefault();
    },
    [getRect],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d) {
        emitHover(hitTestHandle(e.target));
        return;
      }
      const rect = getRect();
      if (!rect) return;
      const dx = e.clientX - d.startClient[0];
      const dy = e.clientY - d.startClient[1];
      if (Math.abs(dx) > CLICK_TOLERANCE_PX || Math.abs(dy) > CLICK_TOLERANCE_PX) d.moved = true;
      if (d.mode === "pan") {
        if (!d.moved) return;
        const upp = svgUnitsPerPixel(d.startViewBox, rect);
        setViewBox({ ...d.startViewBox, x: d.startViewBox.x - dx * upp, y: d.startViewBox.y - dy * upp });
      } else {
        const cur = clientToSvg(d.startViewBox, rect, e.clientX, e.clientY);
        setBand(normalizeBBox(d.startSvg, cur));
      }
    },
    [emitHover, getRect, setViewBox],
  );

  const finishDrag = useCallback(
    (e: React.PointerEvent<SVGSVGElement>, cancelled: boolean) => {
      const d = drag.current;
      drag.current = null;
      setBand(null);
      if (!d) return;
      const el = e.currentTarget;
      if (typeof el.releasePointerCapture === "function" && typeof d.pointerId === "number") {
        try {
          el.releasePointerCapture(d.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (cancelled) return;
      if (d.mode === "band") {
        const rect = getRect();
        if (!rect) return;
        const cur = clientToSvg(d.startViewBox, rect, e.clientX, e.clientY);
        const svgBox = normalizeBBox(d.startSvg, cur);
        // SVG(y-down) → 도면(y-up)
        const bbox: BBox2D = {
          min: [svgBox.min[0], -svgBox.max[1]],
          max: [svgBox.max[0], -svgBox.min[1]],
        };
        const handles = entitiesInBBox(entities, bbox, { bboxByHandle: model.bboxByHandle });
        onAreaSelect?.(handles, bbox);
        return;
      }
      if (!d.moved) onSelect?.(d.downHandle);
    },
    [entities, getRect, model, onAreaSelect, onSelect],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => finishDrag(e, false), [finishDrag]);
  const onPointerCancel = useCallback((e: React.PointerEvent<SVGSVGElement>) => finishDrag(e, true), [finishDrag]);
  const onPointerLeave = useCallback(() => emitHover(null), [emitHover]);

  // 휠 줌: React onWheel 은 passive 라 preventDefault 가 안 되므로 네이티브로 붙인다
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = getRect();
      if (!rect) return;
      const pt = clientToSvg(viewBoxRef.current, rect, ev.clientX, ev.clientY);
      const factor = Math.exp(ev.deltaY * 0.0015);
      zoomAt(pt, factor);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [getRect, zoomAt]);

  // ---------------------------------------------------------------- render

  const svgStyle = {
    width: "100%",
    height: "100%",
    display: "block",
    touchAction: "none",
    cursor: drag.current?.mode === "band" ? "crosshair" : "grab",
    userSelect: "none",
    ...style,
    ["--v2d-highlight" as string]: highlightColor,
  } as React.CSSProperties;

  return (
    <svg
      ref={svgRef}
      className={className ? `viewer2d ${className}` : "viewer2d"}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBoxAttr(viewBox)}
      preserveAspectRatio="xMidYMid meet"
      data-drawing-id={drawingId}
      data-coordinate-source={coordinateSystem.source}
      data-unit={coordinateSystem.unit ?? ""}
      style={svgStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
    >
      <style>{`
        .viewer2d .v2d-entities * { vector-effect: non-scaling-stroke; stroke-width: 1; }
        .viewer2d .v2d-entities text { stroke: none; }
        .viewer2d .v2d-entities .${SELECTED_CLASS}, .viewer2d .v2d-entities .${SELECTED_CLASS} * { stroke-width: 2; }
        .viewer2d .v2d-entities .${HIGHLIGHT_CLASS}, .viewer2d .v2d-entities .${HIGHLIGHT_CLASS} * { stroke: var(--v2d-highlight); stroke-width: 2.5; }
        .viewer2d .v2d-entities text.${HIGHLIGHT_CLASS} { fill: var(--v2d-highlight); }
        .viewer2d .overlay * { vector-effect: non-scaling-stroke; }
        .viewer2d .rubber-band { fill: rgba(33, 150, 243, 0.12); stroke: #2196f3; stroke-dasharray: 4 2; vector-effect: non-scaling-stroke; pointer-events: none; }
      `}</style>
      <g className="v2d-root" transform={model.rootTransform}>
        <g className="v2d-entities">{layerElements}</g>
        {overlayElement}
      </g>
      {band && (
        <rect
          className="rubber-band"
          x={num(band.min[0])}
          y={num(band.min[1])}
          width={num(band.max[0] - band.min[0])}
          height={num(band.max[1] - band.min[1])}
        />
      )}
    </svg>
  );
});

export default Viewer2D;
