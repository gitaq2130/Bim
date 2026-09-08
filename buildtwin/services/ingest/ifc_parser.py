"""IFC 파서 — IfcOpenShell geometry iterator(USE_WORLD_COORDS) 기반. 담당: bim-ingest.

출력: IngestResult(objects=[BimObjectDraft...]). 상태(state)는 만들지 않는다(ADR 0001).
메시는 뷰어용으로 두 가지로 내보낸다.
- `<stem>.mesh.json` : {global_id: {vertices:[x,y,z,...], faces:[i,j,k,...]}} (단일 JSON 번들, XKT 변환 불필요)
- `<stem>.obj`       : Wavefront OBJ, 객체마다 `o <global_id>` 그룹
"""
from __future__ import annotations

import json
import math
import multiprocessing
from collections import Counter
from pathlib import Path
from typing import Any

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ifc_element
import ifcopenshell.util.placement as ifc_placement
import ifcopenshell.util.unit as ifc_unit
import numpy as np

from packages.core.models import TARGET_IFC_TYPES, BBox3D, BimObjectDraft, CoordinateSystem, IngestResult, IngestWarning
from packages.core.models.ingest import IngestStatus

MESH_BUNDLE_SUFFIX = ".mesh.json"
OBJ_SUFFIX = ".obj"
_MESH_DECIMALS = 6


# ---------------------------------------------------------------- 기하 유틸
def _mesh_volume(verts: np.ndarray, faces: np.ndarray) -> float:
    """삼각형 메시의 부호 있는 사면체 합으로 부피 계산(닫힌 메시 가정, 절댓값 반환)."""
    if len(faces) == 0:
        return 0.0
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    return float(abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0)


def _mesh_surface_area(verts: np.ndarray, faces: np.ndarray) -> float:
    if len(faces) == 0:
        return 0.0
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    return float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum() / 2.0)


def _quantities(verts: np.ndarray, faces: np.ndarray, bbox: BBox3D) -> dict[str, float]:
    sx, sy, sz = bbox.size
    return {
        "volume": round(_mesh_volume(verts, faces), 6),
        "surface_area": round(_mesh_surface_area(verts, faces), 6),
        "area": round(sx * sy, 6),            # bbox 평면 투영 면적
        "length": round(max(sx, sy, sz), 6),  # bbox 최장변
        "height": round(sz, 6),
    }


# ---------------------------------------------------------------- 속성 유틸
def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items() if k != "id"}
    if isinstance(value, ifcopenshell.entity_instance):
        return getattr(value, "Name", None) or getattr(value, "GlobalId", None) or str(value)
    return str(value)


def _get_psets(el: ifcopenshell.entity_instance) -> dict[str, dict[str, Any]]:
    try:
        raw = ifc_element.get_psets(el)
    except Exception:  # noqa: BLE001 — 손상된 pset은 건너뛴다
        return {}
    return {name: _json_safe(props) for name, props in raw.items() if isinstance(props, dict)}


def _find_storey(el: ifcopenshell.entity_instance) -> ifcopenshell.entity_instance | None:
    """ContainedInStructure → 공간 트리를 위로 올라가며 IfcBuildingStorey를 찾는다."""
    node = ifc_element.get_container(el)
    visited: set[int] = set()
    while node is not None and node.id() not in visited:
        visited.add(node.id())
        if node.is_a("IfcBuildingStorey"):
            return node
        parent = ifc_element.get_aggregate(node)
        node = parent if parent is not None else ifc_element.get_container(node)
    return None


def _storey_elevation(storey: ifcopenshell.entity_instance, unit_scale: float) -> float | None:
    elev = getattr(storey, "Elevation", None)
    if elev is not None:
        return float(elev) * unit_scale
    placement = getattr(storey, "ObjectPlacement", None)
    if placement is None:
        return None
    try:
        return float(ifc_placement.get_local_placement(placement)[2, 3]) * unit_scale
    except Exception:  # noqa: BLE001
        return None


def _find_zone(el: ifcopenshell.entity_instance, psets: dict[str, dict[str, Any]]) -> str | None:
    """우선순위: Pset 속성 'Zone' → IfcZone(그룹 할당) → IfcSpace(컨테이너)."""
    for props in psets.values():
        for key, value in props.items():
            if key.lower() == "zone" and value not in (None, ""):
                return str(value)
    for rel in getattr(el, "HasAssignments", None) or []:
        if rel.is_a("IfcRelAssignsToGroup") and rel.RelatingGroup is not None and rel.RelatingGroup.is_a("IfcZone"):
            return rel.RelatingGroup.Name
    container = ifc_element.get_container(el)
    if container is not None and container.is_a("IfcSpace"):
        return container.Name or container.LongName
    return None


def _material_name(el: ifcopenshell.entity_instance, shape_material_names: list[str]) -> str | None:
    try:
        mat = ifc_element.get_material(el, should_skip_usage=True)
    except Exception:  # noqa: BLE001
        mat = None
    if mat is not None:
        name = getattr(mat, "Name", None)
        if name:
            return name
        if mat.is_a("IfcMaterialLayerSet") or mat.is_a("IfcMaterialLayerSetUsage"):
            layers = getattr(mat, "MaterialLayers", None) or getattr(getattr(mat, "ForLayerSet", None), "MaterialLayers", [])
            names = [layer.Material.Name for layer in layers if getattr(layer, "Material", None)]
            return " / ".join(names) if names else None
        if mat.is_a("IfcMaterialList"):
            return " / ".join(m.Name for m in mat.Materials if m.Name) or None
    names = [n for n in shape_material_names if n and n != "DefaultMaterial"]
    return names[0] if names else None


# ---------------------------------------------------------------- 좌표계
def _plane_angle_to_degrees(value: Any) -> float | None:
    """IfcCompoundPlaneAngleMeasure(도,분,초,마이크로초) 또는 실수 → 도."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    parts = list(value)
    sign = -1.0 if parts and parts[0] < 0 else 1.0
    deg = 0.0
    for i, p in enumerate(parts[:4]):
        deg += abs(float(p)) / (60.0**i if i < 3 else 60.0**2 * 1_000_000)
    return sign * deg


def _parse_epsg(crs: ifcopenshell.entity_instance | None) -> int | None:
    name = getattr(crs, "Name", None) if crs is not None else None
    if not name:
        return None
    digits = "".join(ch for ch in str(name).split(":")[-1] if ch.isdigit())
    return int(digits) if digits else None


def _coordinate_system(f: ifcopenshell.file, unit_scale: float, extent: BBox3D | None) -> tuple[CoordinateSystem, list[IngestWarning]]:
    warnings: list[IngestWarning] = []
    notes: list[str] = [f"schema={f.schema}", f"length_unit_scale_to_m={unit_scale}"]

    # TrueNorth(IfcGeometricRepresentationContext)는 기록만 한다 — 회전값은 MapConversion이 있을 때만 채운다.
    for ctx in f.by_type("IfcGeometricRepresentationContext"):
        tn = getattr(ctx, "TrueNorth", None)
        if tn is not None and getattr(tn, "DirectionRatios", None):
            x, y = tn.DirectionRatios[0], tn.DirectionRatios[1]
            notes.append(f"true_north_deg={math.degrees(math.atan2(x, y)):.6f}")
            break

    map_conversions = f.by_type("IfcMapConversion") if f.schema.startswith("IFC4") else []
    if map_conversions:
        mc = map_conversions[0]
        rot = math.degrees(math.atan2(mc.XAxisOrdinate or 0.0, mc.XAxisAbscissa if mc.XAxisAbscissa is not None else 1.0))
        cs = CoordinateSystem(
            source="ifc_mapconversion",
            origin=(float(mc.Eastings) * unit_scale, float(mc.Northings) * unit_scale, float(mc.OrthogonalHeight or 0.0) * unit_scale),
            rotation_deg=rot,
            scale=float(mc.Scale) if mc.Scale else 1.0,
            unit="m",
            epsg=_parse_epsg(getattr(mc, "TargetCRS", None)),
            extent=extent,
            notes="; ".join(notes + [f"target_crs={getattr(getattr(mc, 'TargetCRS', None), 'Name', None)}"]),
        )
        return cs, warnings

    sites = f.by_type("IfcSite")
    site = sites[0] if sites else None
    lat = _plane_angle_to_degrees(getattr(site, "RefLatitude", None)) if site is not None else None
    lon = _plane_angle_to_degrees(getattr(site, "RefLongitude", None)) if site is not None else None
    if lat is not None and lon is not None:
        elev = getattr(site, "RefElevation", None)
        notes.append(f"site_ref_latitude={lat:.8f}; site_ref_longitude={lon:.8f}; site_ref_elevation={elev}")
        warnings.append(IngestWarning(
            code="IFC_GEOREF_SITE_ONLY",
            message="IfcMapConversion이 없어 IfcSite 위경도만 기록했습니다. 투영 좌표계 정합은 사용자 입력이 필요합니다.",
            context={"latitude": lat, "longitude": lon, "elevation": elev},
        ))
    else:
        notes.append("no_georeference")
    return CoordinateSystem(source="ifc_local", unit="m", extent=extent, notes="; ".join(notes)), warnings


# ---------------------------------------------------------------- 메시 내보내기
def _export_meshes(meshes: dict[str, dict[str, Any]], bundle_path: Path, obj_path: Path) -> None:
    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        gid: {
            "vertices": [round(float(v), _MESH_DECIMALS) for v in m["verts"].ravel()],
            "faces": [int(i) for i in m["faces"].ravel()],
        }
        for gid, m in meshes.items()
    }
    bundle_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    offset = 1  # OBJ 인덱스는 1부터, 파일 전체 누적
    with obj_path.open("w", encoding="utf-8") as fh:
        fh.write("# BuildTwin mesh export (world coordinates, metres)\n")
        for gid, m in meshes.items():
            verts, faces = m["verts"], m["faces"]
            fh.write(f"o {gid}\n")
            for x, y, z in verts:
                fh.write(f"v {x:.6f} {y:.6f} {z:.6f}\n")
            for a, b, c in faces:
                fh.write(f"f {a + offset} {b + offset} {c + offset}\n")
            offset += len(verts)


# ---------------------------------------------------------------- 메인
def parse_ifc(path: str | Path, out_dir: str | Path | None = None) -> IngestResult:
    """IFC 파일 → IngestResult. 메시 번들·OBJ는 out_dir(기본: IFC 옆)에 쓴다."""
    path = Path(path)
    out_dir = Path(out_dir) if out_dir is not None else path.parent
    warnings: list[IngestWarning] = []
    stats: Counter[str] = Counter()

    try:
        f = ifcopenshell.open(str(path))
    except Exception as exc:  # noqa: BLE001
        return IngestResult(
            status="failed", source_kind="ifc",
            warnings=[IngestWarning(code="IFC_OPEN_FAILED", message=f"IFC 파일을 열 수 없습니다: {exc}", context={"path": str(path)})],
            coordinate_system=CoordinateSystem(source="ifc_local", notes="file open failed"),
        )

    try:
        unit_scale = float(ifc_unit.calculate_unit_scale(f))
    except Exception:  # noqa: BLE001
        unit_scale = 1.0
        warnings.append(IngestWarning(code="IFC_UNIT_UNKNOWN", message="길이 단위를 결정할 수 없어 1.0(m)로 간주합니다.", context={}))

    # 층 목록
    storeys = f.by_type("IfcBuildingStorey")
    levels = sorted(
        ({"name": st.Name or f"Storey#{st.id()}", "elevation": _storey_elevation(st, unit_scale)} for st in storeys),
        key=lambda d: (d["elevation"] is None, d["elevation"] if d["elevation"] is not None else 0.0),
    )

    # 기하 순회 — 같은 제품이 표현(representation)마다 따로 나올 수 있으므로 express id로 병합
    geometry: dict[int, dict[str, Any]] = {}
    failed_geometry = 0
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    settings.set("weld-vertices", True)
    threads = max(1, min(4, multiprocessing.cpu_count()))
    iterator = ifcopenshell.geom.iterator(settings, f, threads)
    if iterator.initialize():
        while True:
            try:
                shape = iterator.get()
                verts = np.asarray(shape.geometry.verts, dtype=float).reshape(-1, 3)
                faces = np.asarray(shape.geometry.faces, dtype=np.int64).reshape(-1, 3)
                entry = geometry.setdefault(shape.id, {"verts": [], "faces": [], "materials": []})
                base = sum(len(v) for v in entry["verts"])
                entry["verts"].append(verts)
                entry["faces"].append(faces + base)
                entry["materials"].extend(m.name for m in shape.geometry.materials)
            except Exception:  # noqa: BLE001
                failed_geometry += 1
            if not iterator.next():
                break

    objects: list[BimObjectDraft] = []
    meshes: dict[str, dict[str, Any]] = {}
    seen_global_ids: dict[str, int] = {}
    skipped: Counter[str] = Counter()
    no_geometry: list[str] = []
    bundle_path = out_dir / f"{path.stem}{MESH_BUNDLE_SUFFIX}"
    obj_path = out_dir / f"{path.stem}{OBJ_SUFFIX}"
    bundle_uri = bundle_path.as_posix()

    for el in f.by_type("IfcProduct"):
        ifc_type = el.is_a()
        if not any(el.is_a(t) for t in TARGET_IFC_TYPES):
            if el.id() in geometry:  # 기하가 있는 비대상 제품만 카운트 (공간 구조 제외)
                skipped[ifc_type] += 1
            continue

        global_id = el.GlobalId
        if global_id in seen_global_ids:
            seen_global_ids[global_id] += 1
            suffixed = f"{global_id}#{seen_global_ids[global_id]}"
            warnings.append(IngestWarning(
                code="DUPLICATE_GLOBAL_ID",
                message=f"GlobalId 중복: {global_id} → {suffixed}로 저장 (ADR 0001 §1)",
                context={"global_id": global_id, "express_id": el.id(), "stored_as": suffixed},
            ))
            global_id = suffixed
        else:
            seen_global_ids[global_id] = 0

        psets = _get_psets(el)
        storey = _find_storey(el)
        bbox: BBox3D | None = None
        quantity: dict[str, float] = {}
        mesh_ref: str | None = None
        material_names: list[str] = []
        geo = geometry.get(el.id())
        if geo is not None and geo["verts"]:
            verts = np.vstack(geo["verts"])
            faces = np.vstack(geo["faces"]) if geo["faces"] else np.zeros((0, 3), dtype=np.int64)
            if len(verts):
                lo, hi = verts.min(axis=0), verts.max(axis=0)
                bbox = BBox3D(min=tuple(float(v) for v in lo), max=tuple(float(v) for v in hi))  # type: ignore[arg-type]
                quantity = _quantities(verts, faces, bbox)
                meshes[global_id] = {"verts": verts, "faces": faces}
                mesh_ref = f"{bundle_uri}#{global_id}"
            material_names = geo["materials"]
        else:
            no_geometry.append(global_id)

        objects.append(BimObjectDraft(
            global_id=global_id,
            ifc_type=ifc_type,
            name=el.Name,
            level=storey.Name if storey is not None else None,
            level_elevation=_storey_elevation(storey, unit_scale) if storey is not None else None,
            zone=_find_zone(el, psets),
            bbox=bbox,
            mesh_ref=mesh_ref,
            psets=psets,
            material=_material_name(el, material_names),
            quantity=quantity,
            express_id=el.id(),
        ))
        stats[ifc_type] += 1

    mesh_uri: str | None = None
    if meshes:
        try:
            _export_meshes(meshes, bundle_path, obj_path)
            mesh_uri = bundle_uri
        except OSError as exc:
            warnings.append(IngestWarning(code="MESH_EXPORT_FAILED", message=f"메시 번들을 쓰지 못했습니다: {exc}", context={"path": bundle_uri}))
            for o in objects:
                o.mesh_ref = None

    if skipped:
        for t, n in skipped.items():
            stats[f"skipped:{t}"] = n
        warnings.append(IngestWarning(
            code="NON_TARGET_TYPES_SKIPPED",
            message=f"대상 외 IfcType {sum(skipped.values())}개를 건너뛰었습니다.",
            context=dict(skipped),
        ))
    if no_geometry:
        warnings.append(IngestWarning(
            code="NO_GEOMETRY",
            message=f"기하가 없는 대상 객체 {len(no_geometry)}개 (bbox·mesh 없음).",
            context={"global_ids": no_geometry[:50], "count": len(no_geometry)},
        ))
    if failed_geometry:
        warnings.append(IngestWarning(code="GEOMETRY_FAILED", message=f"기하 생성 실패 {failed_geometry}건", context={"count": failed_geometry}))

    extent: BBox3D | None = None
    boxes = [o.bbox for o in objects if o.bbox is not None]
    if boxes:
        mins = np.array([b.min for b in boxes]).min(axis=0)
        maxs = np.array([b.max for b in boxes]).max(axis=0)
        extent = BBox3D(min=tuple(float(v) for v in mins), max=tuple(float(v) for v in maxs))  # type: ignore[arg-type]
    coordinate_system, cs_warnings = _coordinate_system(f, unit_scale, extent)
    warnings.extend(cs_warnings)

    stats["objects_total"] = len(objects)
    stats["levels_total"] = len(levels)
    status: IngestStatus
    if not objects:
        status = "failed"
    elif no_geometry or failed_geometry:
        status = "partial"
    else:
        status = "ok"
    return IngestResult(
        status=status, source_kind="ifc", objects=objects, warnings=warnings,
        coordinate_system=coordinate_system, stats=dict(stats), levels=levels, mesh_uri=mesh_uri,
    )
