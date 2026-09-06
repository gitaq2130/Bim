/**
 * MeshBundleLoader — services/ingest 가 내보내는 JSON 메시 번들을 THREE.Mesh 로 만든다.
 *
 * 번들 형식: `{ [globalId]: { vertices: number[] (flat xyz, m, 월드좌표), faces: number[] (flat 삼각형 인덱스) } }`
 * 객체당 Mesh 하나(BufferGeometry + MeshStandardMaterial flatShading). 재질은 객체별 인스턴스라
 * 상태 색을 개별로 칠할 수 있다. WebGL 없이 동작한다(jsdom 테스트 가능).
 */
import * as THREE from "three";
import { colorForState, DEFAULT_STATE } from "./colors";
import type { BBox3D, MeshBundle, MeshBundleEntry } from "./types";

export interface LoadedObject {
  globalId: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  bbox: THREE.Box3;
}

export interface LoadedModel {
  group: THREE.Group;
  objects: Map<string, LoadedObject>;
  /** 전체 모델 bbox (빈 모델이면 isEmpty()) */
  bbox: THREE.Box3;
  skipped: string[];
}

export interface MeshBundleLoaderOptions {
  fetchImpl?: typeof fetch;
  /** 객체별 재질 팩토리. 기본은 flatShading MeshStandardMaterial */
  createMaterial?: (globalId: string) => THREE.MeshStandardMaterial;
}

export function defaultMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorForState(DEFAULT_STATE)),
    flatShading: true,
    metalness: 0.0,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
}

export function box3ToBBox(box: THREE.Box3): BBox3D {
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

export function isValidEntry(entry: unknown): entry is MeshBundleEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<MeshBundleEntry>;
  return (
    Array.isArray(e.vertices) &&
    Array.isArray(e.faces) &&
    e.vertices.length >= 9 &&
    e.vertices.length % 3 === 0 &&
    e.faces.length >= 3
  );
}

export class MeshBundleLoader {
  private readonly fetchImpl: typeof fetch;
  private readonly createMaterial: (globalId: string) => THREE.MeshStandardMaterial;

  constructor(opts: MeshBundleLoaderOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.createMaterial = opts.createMaterial ?? (() => defaultMaterial());
  }

  async load(url: string): Promise<LoadedModel> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`mesh bundle fetch failed: ${res.status} ${url}`);
    const bundle = (await res.json()) as MeshBundle;
    return this.parse(bundle);
  }

  parse(bundle: MeshBundle): LoadedModel {
    const group = new THREE.Group();
    group.name = "model";
    const objects = new Map<string, LoadedObject>();
    const bbox = new THREE.Box3();
    const skipped: string[] = [];

    for (const [globalId, entry] of Object.entries(bundle ?? {})) {
      if (!isValidEntry(entry)) {
        skipped.push(globalId);
        continue;
      }
      const geometry = buildGeometry(entry);
      if (!geometry) {
        skipped.push(globalId);
        continue;
      }
      const mesh = new THREE.Mesh(geometry, this.createMaterial(globalId));
      mesh.name = globalId;
      mesh.userData.globalId = globalId;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);

      const objBox = geometry.boundingBox ? geometry.boundingBox.clone() : new THREE.Box3();
      bbox.union(objBox);
      objects.set(globalId, { globalId, mesh, bbox: objBox });
    }
    group.updateMatrixWorld(true);
    return { group, objects, bbox, skipped };
  }
}

export function buildGeometry(entry: MeshBundleEntry): THREE.BufferGeometry | null {
  const vertexCount = entry.vertices.length / 3;
  const positions = new Float32Array(entry.vertices);
  const faces: number[] = [];
  for (let i = 0; i + 2 < entry.faces.length; i += 3) {
    const a = entry.faces[i], b = entry.faces[i + 1], c = entry.faces[i + 2];
    if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
    faces.push(a, b, c);
  }
  if (faces.length < 3) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(vertexCount > 65535 ? new THREE.Uint32BufferAttribute(faces, 1) : new THREE.Uint16BufferAttribute(faces, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function disposeModel(model: LoadedModel): void {
  for (const obj of model.objects.values()) {
    obj.mesh.geometry.dispose();
    obj.mesh.material.dispose();
    obj.mesh.children.forEach((child) => {
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }
  model.group.clear();
  model.objects.clear();
}
