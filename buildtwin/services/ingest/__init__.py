"""services/ingest — 도면 인식(IFC/DXF/DWG/RVT → IngestResult). 담당: bim-ingest.

`ingest_file(path, kind, out_dir)`이 유일한 진입점이다. 확장자 → 매직바이트 순으로 종류를 판별해 파서로 분기한다.
"""
from __future__ import annotations

from pathlib import Path

from packages.core.models import CoordinateSystem, FileKind, IngestResult, IngestWarning

from .dwg_adapter import convert_dwg_to_dxf, parse_dwg
from .dxf_parser import parse_dxf
from .ifc_parser import parse_ifc
from .persistence import PersistedModel, persist_drawing, persist_ingest_result
from .rvt_adapter import APSModelDerivativeClient, ingest_rvt

__all__ = [
    "APSModelDerivativeClient", "PersistedModel", "convert_dwg_to_dxf", "detect_file_kind", "ingest_file",
    "ingest_rvt", "parse_dwg", "parse_dxf", "parse_ifc", "persist_drawing", "persist_ingest_result",
]

_EXTENSION_KINDS: dict[str, FileKind] = {
    ".ifc": "ifc", ".ifczip": "ifc", ".dxf": "dxf", ".dwg": "dwg", ".rvt": "rvt",
    ".e57": "e57", ".las": "las", ".laz": "las", ".ply": "ply", ".csv": "csv", ".xml": "xml", ".xer": "xer",
}
_MAGIC_READ_BYTES = 4096


def detect_file_kind(path: str | Path) -> FileKind:
    """확장자 우선, 없거나 모호하면 매직바이트로 판별. IFC='ISO-10303-21', DWG='AC10xx', DXF=텍스트에 SECTION/HEADER."""
    path = Path(path)
    kind = _EXTENSION_KINDS.get(path.suffix.lower())
    if kind is not None:
        return kind
    try:
        head = path.read_bytes()[:_MAGIC_READ_BYTES]
    except OSError:
        return "unknown"
    if head.startswith(b"ISO-10303-21"):
        return "ifc"
    if head.startswith(b"AC10"):
        return "dwg"
    text = head.decode("utf-8", errors="ignore")
    if "SECTION" in text and "HEADER" in text:
        return "dxf"
    return "unknown"


def ingest_file(path: str | Path, kind: FileKind | None = None, out_dir: str | Path | None = None) -> IngestResult:
    path = Path(path)
    if not path.exists():
        return IngestResult(
            status="failed", source_kind=kind or "unknown",
            warnings=[IngestWarning(code="FILE_NOT_FOUND", message=f"파일이 없습니다: {path}", context={"path": str(path)})],
            coordinate_system=CoordinateSystem(source="ifc_local", notes="file not found; identity placeholder"),
        )
    kind = kind or detect_file_kind(path)
    if kind == "ifc":
        return parse_ifc(path, out_dir=out_dir)
    if kind == "dxf":
        return parse_dxf(path)
    if kind == "dwg":
        return parse_dwg(path, out_dir=out_dir)
    if kind == "rvt":
        return ingest_rvt(path, out_dir=out_dir)
    code = "UNSUPPORTED_FILE_KIND" if kind == "unknown" else "KIND_NOT_HANDLED_BY_INGEST"
    return IngestResult(
        status="failed", source_kind=kind,
        warnings=[IngestWarning(
            code=code,
            message="도면 인식(ingest)이 처리하는 형식은 IFC/DXF/DWG/RVT입니다. "
                    f"'{kind}'는 다른 서비스(scan/progress)가 처리하거나 지원하지 않는 형식입니다.",
            context={"path": str(path), "kind": kind},
        )],
        coordinate_system=CoordinateSystem(source="ifc_local", notes="unsupported kind; identity placeholder"),
    )
