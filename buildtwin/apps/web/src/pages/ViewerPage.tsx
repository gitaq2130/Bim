/**
 * 좌우 분할 2D|3D 동기 뷰. 뷰어는 핸들 ref 로만 접근하고, 선택 동기화는 sync 브로커에 위임한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAllObjects, useDrawingEntities, useDrawingMappings, useDrawings, useModels, usePlanSection, useScans } from "../api/hooks";
import type { ObjectState } from "../api/types";
import { ErrorBox } from "../components/ErrorBox";
import { ObjectDetailPanel } from "../components/ObjectDetailPanel";
import { SplitPane } from "../components/SplitPane";
import { StateLegend } from "../components/StateLegend";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { modelToDrawingMatrix, normalizeCoordinateSystem, toViewerTransform } from "../lib/coordinate";
import { useStore } from "../store";
import { createBroker } from "../sync/broker";
import type { Viewer2DHandle, Viewer3DHandle } from "../sync/viewerTypes";
import { LazyViewer2D, LazyViewer3D } from "../viewers/LazyViewers";

export function ViewerPage() {
  const { id: projectId = "" } = useParams();
  const ui = useStore((s) => s.ui);
  const selection = useStore((s) => s.selection);

  useEffect(() => {
    ui.setCurrentProjectId(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ---- 서버 상태 (TanStack Query) ----
  const models = useModels(projectId);
  const drawings = useDrawings(projectId);
  const scans = useScans(projectId);
  const model = useMemo(
    () => models.data?.find((m) => m.model_id === ui.currentModelId) ?? models.data?.[0] ?? null,
    [models.data, ui.currentModelId],
  );
  const levels = model?.levels ?? [];
  const level = ui.currentLevel ?? levels[0]?.name ?? null;
  const drawing = useMemo(() => {
    const list = drawings.data ?? [];
    return list.find((d) => d.drawing_id === ui.currentDrawingId) ?? list.find((d) => d.level === level) ?? list[0] ?? null;
  }, [drawings.data, ui.currentDrawingId, level]);

  const entities = useDrawingEntities(drawing?.drawing_id);
  const mappings = useDrawingMappings(drawing?.drawing_id);
  // total 만큼 모든 페이지를 모아온다(API page_size 상한 le=2000 초과 시에도 누락 없음). 서버 상태는 Query 캐시에만 유지.
  const objects = useAllObjects(projectId);
  // 단면 오프셋은 서버 값만 쓴다: models.plan_section_default_offset → plan-section.offset. 없으면 3D 뷰어를 띄우지 않는다.
  const needsOffsetFallback = !!model && model.plan_section_default_offset == null;
  const section = usePlanSection(ui.overlayVisible || needsOffsetFallback ? model?.model_id : null, level);
  const sectionOffset = model?.plan_section_default_offset ?? section.data?.offset ?? null;
  const scan = useMemo(() => scans.data?.find((s) => s.scan_id === ui.currentScanId) ?? scans.data?.find((s) => s.pointcloud_uri) ?? null, [scans.data, ui.currentScanId]);

  const stateMap = useMemo(() => {
    const m: Record<string, ObjectState> = {};
    for (const o of objects.data?.items ?? []) if (o.state) m[o.global_id] = o.state;
    return m;
  }, [objects.data]);

  // ---- 뷰어 핸들 + 브로커 ----
  const v3 = useRef<Viewer3DHandle | null>(null);
  const v2 = useRef<Viewer2DHandle | null>(null);
  const broker = useMemo(() => createBroker(useStore), []);
  useEffect(() => () => broker.dispose(), [broker]);

  const attach3d = useCallback(
    (h: Viewer3DHandle | null) => {
      v3.current = h;
      broker.attach({ viewer3d: h });
    },
    [broker],
  );
  const attach2d = useCallback(
    (h: Viewer2DHandle | null) => {
      v2.current = h;
      broker.attach({ viewer2d: h });
    },
    [broker],
  );

  useEffect(() => {
    broker.setMappings(mappings.data ?? []);
  }, [broker, mappings.data]);

  // 층 선택 → 3D 는 해당 층 객체만 isolate, 2D 는 층 도면으로 전환 (drawing useMemo)
  useEffect(() => {
    const h = v3.current;
    if (!h || !level || !objects.data) return;
    const ids = objects.data.items.filter((o) => o.level === level).map((o) => o.global_id);
    h.isolate(ids.length ? ids : null);
  }, [level, objects.data]);

  // 단면 오버레이
  useEffect(() => {
    const h = v2.current;
    if (!h) return;
    if (ui.overlayVisible && section.data) {
      h.setOverlay(section.data, { opacity: ui.overlayOpacity, transform: modelToDrawingMatrix(drawing?.coordinate_system) });
    } else {
      h.setOverlay(null);
    }
  }, [ui.overlayVisible, section.data, drawing?.coordinate_system, ui.overlayOpacity]);

  useEffect(() => {
    v2.current?.setOverlayOpacity(ui.overlayOpacity);
  }, [ui.overlayOpacity]);

  // 포인트클라우드
  const [pcLoaded, setPcLoaded] = useState<string | null>(null);
  const [pcError, setPcError] = useState<unknown>(null);
  useEffect(() => {
    const h = v3.current;
    if (!h) return;
    if (!ui.pointCloudVisible) {
      h.togglePointCloud(false);
      return;
    }
    if (!scan?.pointcloud_uri) return;
    if (pcLoaded === scan.scan_id) {
      h.togglePointCloud(true);
      return;
    }
    // 변환은 서버 registration.transform 에서만 온다
    h.loadPointCloud(scan.pointcloud_uri, toViewerTransform(scan.registration?.transform))
      .then(() => {
        setPcLoaded(scan.scan_id);
        h.togglePointCloud(true);
      })
      .catch((e) => setPcError(e));
  }, [ui.pointCloudVisible, scan, pcLoaded]);

  const lowConfidence = (mappings.data ?? []).filter((m) => m.needs_review).length;
  const selectedGid = selection.globalIds[0] ?? null;

  return (
    <div className="viewer-page">
      <div className="toolbar">
        <label>
          모델
          <select value={model?.model_id ?? ""} onChange={(e) => ui.setCurrentModelId(e.target.value || null)}>
            {(models.data ?? []).map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {m.name ?? m.model_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          층
          <select
            value={level ?? ""}
            onChange={(e) => {
              ui.setCurrentLevel(e.target.value || null);
              ui.setCurrentDrawingId(null);
            }}
            data-testid="level-select"
          >
            {levels.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          도면
          <select value={drawing?.drawing_id ?? ""} onChange={(e) => ui.setCurrentDrawingId(e.target.value || null)}>
            {(drawings.data ?? []).map((d) => (
              <option key={d.drawing_id} value={d.drawing_id}>
                {d.name ?? d.drawing_id}
                {d.level ? ` (${d.level})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.overlayVisible} onChange={(e) => ui.setOverlayVisible(e.target.checked)} /> 단면 오버레이
        </label>
        <label>
          투명도
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={ui.overlayOpacity}
            disabled={!ui.overlayVisible}
            onChange={(e) => ui.setOverlayOpacity(Number(e.target.value))}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.pointCloudVisible} disabled={!scan?.pointcloud_uri} onChange={(e) => ui.setPointCloudVisible(e.target.checked)} />{" "}
          포인트클라우드{scan?.registration?.rmse != null ? ` (rmse ${scan.registration.rmse.toFixed(3)}m)` : ""}
        </label>
        <button type="button" onClick={() => v2.current?.fitToView()}>
          2D 맞춤
        </button>
        <button type="button" onClick={() => broker.clear()}>
          선택 해제
        </button>
        <div className="spacer" />
        {objects.isPending && <span className="muted small">객체 목록 로딩 중…</span>}
        {!objects.isPending && objects.isFetching && <span className="muted small">객체 목록 갱신 중…</span>}
        {objects.data && (
          <span className="muted small" data-testid="objects-count">
            객체 {objects.data.items.length}
            {objects.data.total > objects.data.items.length ? `/${objects.data.total}` : ""}건
          </span>
        )}
        {mappings.data && (
          <span className="muted small">
            매핑 {mappings.data.length}건{lowConfidence > 0 ? ` · 확인 필요 ${lowConfidence}건` : ""}
          </span>
        )}
        <StateLegend />
      </div>
      <ErrorBox error={models.error ?? drawings.error ?? objects.error ?? entities.error ?? mappings.error ?? section.error ?? pcError} />
      {objects.data?.truncated && (
        <p className="error" role="alert" data-testid="objects-truncated-warning">
          객체 수가 많아 일부만 불러왔습니다 ({objects.data.items.length.toLocaleString()} / {objects.data.total.toLocaleString()}건). 필터를 좁혀서 다시 시도하세요.
        </p>
      )}
      {ui.overlayVisible && section.isPending && model && <p className="muted small">단면 생성 중…</p>}
      <div className="viewer-body">
        <SplitPane
          ratio={ui.splitRatio}
          onRatioChange={ui.setSplitRatio}
          left={
            drawing && entities.data ? (
              <LazyViewer2D
                ref={attach2d}
                drawingId={drawing.drawing_id}
                entities={entities.data.entities}
                coordinateSystem={normalizeCoordinateSystem(entities.data.coordinate_system ?? drawing.coordinate_system)}
                onSelect={(h) => broker.select2d(h)}
                onAreaSelect={(hs) => broker.selectArea2d(hs)}
                selectedIds={selection.entityHandles}
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <div className="viewer-empty">{drawings.isPending ? "도면 목록 로딩…" : "2D 도면이 없습니다. DXF 를 업로드하세요."}</div>
            )
          }
          right={
            model && sectionOffset != null ? (
              <LazyViewer3D
                ref={attach3d}
                modelUrl={model.model_uri}
                levels={model.levels}
                sectionOffset={sectionOffset}
                coordinateSystem={normalizeCoordinateSystem(model.coordinate_system)}
                stateMap={stateMap}
                onSelect={(gid) => broker.select3d(gid)}
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <div className="viewer-empty">
                {models.isPending
                  ? "모델 목록 로딩…"
                  : !model
                    ? "3D 모델이 없습니다. IFC 를 업로드하세요."
                    : section.isPending
                      ? "단면 오프셋 조회 중…"
                      : "단면 오프셋(plan_section_default_offset / plan-section.offset)이 없어 3D 뷰어를 열 수 없습니다."}
              </div>
            )
          }
        />
        <ObjectDetailPanel globalId={selectedGid} projectId={projectId} onSelectHandle={(h) => broker.select2d(h)} />
      </div>
      {selection.globalIds.length > 1 && (
        <div className="selection-bar">
          {selection.globalIds.length}개 객체 선택 (원천: {selection.source})
          {selection.globalIds.slice(0, 20).map((g) => {
            const m = mappings.data?.find((x) => x.global_id === g);
            return (
              <button key={g} type="button" className="chip" onClick={() => broker.selectFromPanel(g)}>
                {g} {m && <ConfidenceBadge confidence={m.confidence} evidence={m.evidence} showEvidence={false} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
