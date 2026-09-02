/**
 * Viewer3D — IFC 메시 번들을 three.js 로 렌더하는 순수 뷰어 컴포넌트.
 *
 * - 객체 식별자는 IFC GlobalId 그대로. 내부 Mesh 매핑은 이 파일 안에 숨긴다.
 * - 스토어를 읽거나 쓰지 않는다. props/콜백/ref 핸들만 사용한다.
 * - 상태를 판단하지 않는다. setState/setStates 로 받은 색만 칠한다.
 * - 렌더러(WebGL)는 useEffect 안에서 try/catch 로 지연 생성한다 → jsdom 에서도 import·mount 가능.
 *   WebGL 이 없으면 scene/model/handle 은 그대로 동작하고 그리기만 생략한다(getPlanSection 테스트 가능).
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { colorForState, EDGE_COLOR, HIGHLIGHT_EMISSIVE } from "./colors";
import { disposeModel, MeshBundleLoader, box3ToBBox, type LoadedModel, type LoadedObject } from "./loader";
import { DEFAULT_POINT_SIZE, disposePoints, loadPointCloudPoints } from "./pointcloud";
import { polylinesToSvg, slicePlan, type SliceableMesh } from "./section";
import type {
  CoordinateSystem,
  CoordinateTransform,
  HighlightOptions,
  ObjectState,
  PlanSection,
  Viewer3DHandle,
  Viewer3DProps,
} from "./types";

/** 단면 오프셋 기본값(모델 단위). props.sectionOffset 이 없을 때만 쓰인다. 알고리즘(section.ts)은 이 값을 모른다. */
export const DEFAULT_SECTION_OFFSET = 1.2;
export const DEFAULT_BACKGROUND = "#F5F5F5";
export const DEFAULT_HOVER_THROTTLE_MS = 50;
const CLICK_MAX_MOVE_PX = 5;
const FLY_DURATION_MS = 600;
const DIM_OPACITY = 0.15;
/** 카메라 기본 시선 방향(모델 Z-up 기준, 남서쪽 위에서 내려다봄) */
const DEFAULT_VIEW_DIR = new THREE.Vector3(1, -1, 0.8).normalize();

/**
 * coordinateSystem prop 이 없을 때 보고하는 "모델 좌표계 그대로" 항등 좌표계.
 * 변환 상수가 아니라 "변환 없음"을 뜻한다. 실제 값은 props 로 주입한다.
 */
const IDENTITY_MODEL_CS: CoordinateSystem = {
  source: "ifc_local",
  origin: [0, 0, 0],
  rotation_deg: 0,
  scale: 1,
  unit: "m",
};

interface FlyAnimation {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  duration: number;
  resolve: () => void;
}

interface ExtraProps {
  /** 테스트용: WebGL 렌더러 생성을 건너뛴다. */
  disableRenderer?: boolean;
}

export const Viewer3D = forwardRef<Viewer3DHandle, Viewer3DProps & ExtraProps>(function Viewer3D(props, ref) {
  const {
    modelUrl,
    stateMap,
    pointCloudUrl,
    pointCloudTransform,
    background = DEFAULT_BACKGROUND,
    className,
    style,
    disableRenderer = false,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // three 객체들 — 렌더러 유무와 무관하게 존재
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const targetRef = useRef(new THREE.Vector3()); // controls 가 없을 때의 시선 목표
  const flyRef = useRef<FlyAnimation | null>(null);

  // 모델·표시 상태
  const modelRef = useRef<LoadedModel | null>(null);
  const statesRef = useRef(new Map<string, ObjectState>());
  const highlightedRef = useRef(new Set<string>());
  const exclusiveRef = useRef(false);
  const isolatedRef = useRef<Set<string> | null>(null);
  const pointCloudRef = useRef<THREE.Points | null>(null);
  const pointCloudVisibleRef = useRef(true);
  const hoverIdRef = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // 헬퍼
  // -------------------------------------------------------------------------

  const getScene = (): THREE.Scene => {
    if (!sceneRef.current) {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(background);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.0));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(30, -50, 80);
      scene.add(sun);
      scene.add(new THREE.AmbientLight(0xffffff, 0.25));
      sceneRef.current = scene;
    }
    return sceneRef.current;
  };

  const getCamera = (): THREE.PerspectiveCamera => {
    if (!cameraRef.current) {
      const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
      cam.up.set(0, 0, 1); // IFC 월드는 Z-up
      cam.position.set(20, -20, 16);
      cam.lookAt(0, 0, 0);
      cameraRef.current = cam;
    }
    return cameraRef.current;
  };

  const currentTarget = (): THREE.Vector3 =>
    controlsRef.current ? controlsRef.current.target : targetRef.current;

  const setCameraPose = (pos: THREE.Vector3, target: THREE.Vector3): void => {
    const cam = getCamera();
    cam.position.copy(pos);
    if (controlsRef.current) {
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
    } else {
      targetRef.current.copy(target);
      cam.lookAt(target);
    }
  };

  /** bbox 를 화면에 맞추는 카메라 위치/목표. 현재 시선 방향을 유지한다. */
  const computeFit = (box: THREE.Box3): { pos: THREE.Vector3; target: THREE.Vector3 } => {
    const cam = getCamera();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    const fov = THREE.MathUtils.degToRad(cam.fov);
    const aspectFactor = cam.aspect < 1 ? 1 / cam.aspect : 1;
    const dist = (radius / Math.sin(fov / 2)) * 1.1 * aspectFactor;
    let dir = cam.position.clone().sub(currentTarget());
    if (dir.lengthSq() < 1e-9) dir = DEFAULT_VIEW_DIR.clone();
    dir.normalize();
    cam.near = Math.max(0.01, radius / 1000);
    cam.far = Math.max(cam.far, radius * 200);
    cam.updateProjectionMatrix();
    return { pos: center.clone().addScaledVector(dir, dist), target: center };
  };

  const ensureEdges = (obj: LoadedObject): void => {
    if (obj.mesh.getObjectByName("edges")) return;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(obj.mesh.geometry, 20),
      new THREE.LineBasicMaterial({ color: new THREE.Color(EDGE_COLOR) }),
    );
    edges.name = "edges";
    edges.matrixAutoUpdate = false;
    obj.mesh.add(edges);
  };

  const removeEdges = (obj: LoadedObject): void => {
    const edges = obj.mesh.getObjectByName("edges") as THREE.LineSegments | undefined;
    if (!edges) return;
    obj.mesh.remove(edges);
    edges.geometry.dispose();
    (edges.material as THREE.Material).dispose();
  };

  /** 상태색·하이라이트·exclusive 반투명·isolate 가시성을 한 번에 반영 */
  const applyVisual = (obj: LoadedObject): void => {
    const id = obj.globalId;
    const mat = obj.mesh.material;
    const highlighted = highlightedRef.current.has(id);
    const dim = exclusiveRef.current && highlightedRef.current.size > 0 && !highlighted;

    mat.color.set(colorForState(statesRef.current.get(id)));
    mat.emissive.set(highlighted ? HIGHLIGHT_EMISSIVE : "#000000");
    mat.emissiveIntensity = highlighted ? 0.6 : 0;
    const wasTransparent = mat.transparent;
    mat.transparent = dim;
    mat.opacity = dim ? DIM_OPACITY : 1;
    mat.depthWrite = !dim;
    if (wasTransparent !== dim) mat.needsUpdate = true;

    obj.mesh.visible = isolatedRef.current ? isolatedRef.current.has(id) : true;

    if (highlighted && (propsRef.current.showEdges ?? true)) ensureEdges(obj);
    else removeEdges(obj);
  };

  const applyAllVisuals = (): void => {
    const model = modelRef.current;
    if (!model) return;
    for (const obj of model.objects.values()) applyVisual(obj);
  };

  const pickAt = (clientX: number, clientY: number): string | null => {
    const container = containerRef.current;
    const model = modelRef.current;
    const cam = cameraRef.current;
    if (!container || !model || !cam || !rendererRef.current) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const meshes: THREE.Object3D[] = [];
    for (const obj of model.objects.values()) if (obj.mesh.visible) meshes.push(obj.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const id = (hit.object.userData as { globalId?: string }).globalId;
      if (id) return id;
    }
    return null;
  };

  // -------------------------------------------------------------------------
  // 명령형 핸들
  // -------------------------------------------------------------------------

  useImperativeHandle(
    ref,
    (): Viewer3DHandle => ({
      highlight(globalIds: string[], opts?: HighlightOptions) {
        highlightedRef.current = new Set(globalIds);
        exclusiveRef.current = Boolean(opts?.exclusive);
        applyAllVisuals();
      },
      clearHighlight() {
        highlightedRef.current = new Set();
        exclusiveRef.current = false;
        applyAllVisuals();
      },
      flyTo(globalId: string) {
        return new Promise<void>((resolve) => {
          const obj = modelRef.current?.objects.get(globalId);
          if (!obj || obj.bbox.isEmpty()) {
            resolve();
            return;
          }
          const { pos, target } = computeFit(obj.bbox);
          if (!rendererRef.current) {
            setCameraPose(pos, target);
            resolve();
            return;
          }
          flyRef.current?.resolve();
          flyRef.current = {
            fromPos: getCamera().position.clone(),
            toPos: pos,
            fromTarget: currentTarget().clone(),
            toTarget: target,
            start: performance.now(),
            duration: FLY_DURATION_MS,
            resolve,
          };
        });
      },
      setState(globalId: string, state: ObjectState) {
        statesRef.current.set(globalId, state);
        const obj = modelRef.current?.objects.get(globalId);
        if (obj) applyVisual(obj);
      },
      setStates(map: Record<string, ObjectState>) {
        for (const [id, st] of Object.entries(map)) statesRef.current.set(id, st);
        applyAllVisuals();
      },
      async getPlanSection(level: string, offset?: number): Promise<PlanSection> {
        const p = propsRef.current;
        const lv = (p.levels ?? []).find((l) => l.name === level);
        if (!lv) throw new Error(`Viewer3D.getPlanSection: unknown level "${level}"`);
        const model = modelRef.current;
        if (!model) throw new Error("Viewer3D.getPlanSection: model not loaded");
        const z = lv.elevation + (offset ?? p.sectionOffset ?? DEFAULT_SECTION_OFFSET);
        const polylines = slicePlan(collectSliceable(model), z);
        return {
          level,
          elevation: z,
          coordinateSystem: p.coordinateSystem ?? IDENTITY_MODEL_CS,
          polylines,
          svg: polylinesToSvg(polylines),
        };
      },
      togglePointCloud(visible: boolean) {
        pointCloudVisibleRef.current = visible;
        if (pointCloudRef.current) pointCloudRef.current.visible = visible;
      },
      async loadPointCloud(url: string, transform: CoordinateTransform) {
        const points = await loadPointCloudPoints(url, transform, {
          pointSize: propsRef.current.pointSize ?? DEFAULT_POINT_SIZE,
        });
        const scene = getScene();
        if (pointCloudRef.current) {
          scene.remove(pointCloudRef.current);
          disposePoints(pointCloudRef.current);
        }
        points.visible = pointCloudVisibleRef.current;
        scene.add(points);
        pointCloudRef.current = points;
      },
      isolate(globalIds: string[] | null) {
        isolatedRef.current = globalIds ? new Set(globalIds) : null;
        applyAllVisuals();
      },
      getObjectIds() {
        return modelRef.current ? Array.from(modelRef.current.objects.keys()) : [];
      },
    }),
    [],
  );

  // -------------------------------------------------------------------------
  // 렌더러·컨트롤·이벤트 (마운트 1회)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = getScene();
    const camera = getCamera();

    let renderer: THREE.WebGLRenderer | null = null;
    if (!disableRenderer) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;
      } catch (err) {
        // WebGL 미지원(jsdom·CI). 헤드리스로 계속 진행.
        renderer = null;
        rendererRef.current = null;
        propsRef.current.onError?.(err);
      }
    }

    const resize = (): void => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer?.setSize(w, h, false);
    };
    resize();

    let controls: OrbitControls | null = null;
    if (renderer) {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(targetRef.current);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.screenSpacePanning = true;
      controls.update();
      controlsRef.current = controls;

      renderer.setAnimationLoop(() => {
        const fly = flyRef.current;
        if (fly) {
          const t = Math.min(1, (performance.now() - fly.start) / fly.duration);
          const e = t * t * (3 - 2 * t); // smoothstep
          camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
          controls?.target.lerpVectors(fly.fromTarget, fly.toTarget, e);
          if (t >= 1) {
            flyRef.current = null;
            fly.resolve();
          }
        }
        controls?.update();
        renderer?.render(scene, camera);
      });
    }

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(container);
    } else {
      window.addEventListener("resize", resize);
    }

    // 포인터: down/up 거리로 클릭과 드래그 구분. move 는 스로틀.
    let down: { x: number; y: number } | null = null;
    let lastHover = 0;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > CLICK_MAX_MOVE_PX) return;
      propsRef.current.onSelect?.(pickAt(e.clientX, e.clientY));
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (!propsRef.current.onHover) return;
      const now = performance.now();
      if (now - lastHover < (propsRef.current.hoverThrottleMs ?? DEFAULT_HOVER_THROTTLE_MS)) return;
      lastHover = now;
      const id = pickAt(e.clientX, e.clientY);
      if (id !== hoverIdRef.current) {
        hoverIdRef.current = id;
        propsRef.current.onHover(id);
      }
    };
    const onPointerLeave = (): void => {
      down = null;
      if (hoverIdRef.current !== null) {
        hoverIdRef.current = null;
        propsRef.current.onHover?.(null);
      }
    };
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      flyRef.current?.resolve();
      flyRef.current = null;
      controls?.dispose();
      controlsRef.current = null;
      if (renderer) {
        renderer.setAnimationLoop(null);
        renderer.dispose();
        renderer.domElement.remove();
      }
      rendererRef.current = null;
      if (modelRef.current) {
        scene.remove(modelRef.current.group);
        disposeModel(modelRef.current);
        modelRef.current = null;
      }
      if (pointCloudRef.current) {
        scene.remove(pointCloudRef.current);
        disposePoints(pointCloudRef.current);
        pointCloudRef.current = null;
      }
      sceneRef.current = null;
      cameraRef.current = null;
    };
    // 마운트 1회. background/disableRenderer 는 초기값만 사용.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 배경색 변경 반영
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.background = new THREE.Color(background);
  }, [background]);

  // -------------------------------------------------------------------------
  // 모델 로드 (modelUrl 변경 시)
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    container?.removeAttribute("data-loaded");
    new MeshBundleLoader()
      .load(modelUrl)
      .then((model) => {
        if (cancelled) {
          disposeModel(model);
          return;
        }
        const scene = getScene();
        if (modelRef.current) {
          scene.remove(modelRef.current.group);
          disposeModel(modelRef.current);
        }
        modelRef.current = model;
        scene.add(model.group);

        const p = propsRef.current;
        statesRef.current = new Map<string, ObjectState>([
          ...Object.entries(p.initialStates ?? {}),
          ...Object.entries(p.stateMap ?? {}),
        ]);
        applyAllVisuals();

        if (!model.bbox.isEmpty()) {
          // 초기 카메라는 기본 시선 방향으로 전체 모델을 담는다
          const cam = getCamera();
          cam.position.copy(model.bbox.getCenter(new THREE.Vector3()).add(DEFAULT_VIEW_DIR));
          targetRef.current.copy(model.bbox.getCenter(new THREE.Vector3()));
          controlsRef.current?.target.copy(targetRef.current);
          const { pos, target } = computeFit(model.bbox);
          setCameraPose(pos, target);
        }
        container?.setAttribute("data-loaded", "true");
        container?.setAttribute("data-object-count", String(model.objects.size));
        p.onLoad?.({ objectCount: model.objects.size, bbox: box3ToBBox(model.bbox) });
      })
      .catch((err: unknown) => {
        if (!cancelled) propsRef.current.onError?.(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  // stateMap 이 바뀌면 전체 교체(controlled). 로드 전이면 로드 시점에 합쳐진다.
  useEffect(() => {
    if (!stateMap || !modelRef.current) return;
    statesRef.current = new Map(Object.entries(stateMap));
    applyAllVisuals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateMap]);

  // pointCloudUrl + transform 이 함께 주어지면 자동 로드
  useEffect(() => {
    if (!pointCloudUrl || !pointCloudTransform) return;
    let cancelled = false;
    loadPointCloudPoints(pointCloudUrl, pointCloudTransform, {
      pointSize: propsRef.current.pointSize ?? DEFAULT_POINT_SIZE,
    })
      .then((points) => {
        if (cancelled) {
          disposePoints(points);
          return;
        }
        const scene = getScene();
        if (pointCloudRef.current) {
          scene.remove(pointCloudRef.current);
          disposePoints(pointCloudRef.current);
        }
        points.visible = pointCloudVisibleRef.current;
        scene.add(points);
        pointCloudRef.current = points;
      })
      .catch((err: unknown) => {
        if (!cancelled) propsRef.current.onError?.(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointCloudUrl, pointCloudTransform]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="viewer3d"
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 200, overflow: "hidden", ...style }}
    />
  );
});

/** 로드된 메시들을 section.ts 입력 형태로 모은다. matrixWorld 가 항등이 아니면 월드 좌표로 변환. */
function collectSliceable(model: LoadedModel): Map<string, SliceableMesh> {
  const out = new Map<string, SliceableMesh>();
  const identity = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const [id, obj] of model.objects) {
    const geom = obj.mesh.geometry;
    const posAttr = geom.getAttribute("position");
    if (!posAttr) continue;
    let positions = posAttr.array as Float32Array;
    obj.mesh.updateMatrixWorld(true);
    if (!obj.mesh.matrixWorld.equals(identity)) {
      const copy = new Float32Array(positions.length);
      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(obj.mesh.matrixWorld);
        copy[i * 3] = v.x;
        copy[i * 3 + 1] = v.y;
        copy[i * 3 + 2] = v.z;
      }
      positions = copy;
    }
    out.set(id, { positions, indices: geom.index ? (geom.index.array as Uint16Array | Uint32Array) : null });
  }
  return out;
}

export default Viewer3D;
