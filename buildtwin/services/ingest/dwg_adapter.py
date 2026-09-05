"""DWG 어댑터 — 직접 파싱 금지. ODA File Converter(설치·설정된 경우)로 DXF 변환 후 dxf_parser로 넘긴다."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from packages.core.models import CoordinateSystem, IngestResult, IngestWarning
from packages.core.settings import settings

from .dxf_parser import parse_dxf

ODA_OUTPUT_VERSION = "ACAD2018"
_ODA_TIMEOUT_SEC = 600


def convert_dwg_to_dxf(path: str | Path, out_dir: str | Path | None = None) -> Path | None:
    """ODA File Converter CLI로 DWG→DXF. 변환기가 설정돼 있지 않거나 실패하면 None.

    CLI 서명: ODAFileConverter <in_dir> <out_dir> <version> <DXF|DWG> <recurse 0/1> <audit 0/1> [filter]
    """
    path = Path(path)
    converter = settings.oda_file_converter_path
    if not converter or not Path(converter).exists():
        return None
    out_dir = Path(out_dir) if out_dir is not None else path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    # ODA는 폴더 단위로 변환하므로 입력 파일만 담은 임시 폴더를 만든다.
    with tempfile.TemporaryDirectory(prefix="buildtwin_dwg_") as tmp:
        in_dir = Path(tmp)
        shutil.copy2(path, in_dir / path.name)
        cmd = [converter, str(in_dir), str(out_dir), ODA_OUTPUT_VERSION, "DXF", "0", "1", path.name]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=_ODA_TIMEOUT_SEC)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            return None
    dxf_path = out_dir / f"{path.stem}.dxf"
    return dxf_path if dxf_path.exists() else None


def parse_dwg(path: str | Path, out_dir: str | Path | None = None) -> IngestResult:
    path = Path(path)
    dxf_path = convert_dwg_to_dxf(path, out_dir)
    if dxf_path is None:
        return IngestResult(
            status="failed", source_kind="dwg",
            warnings=[IngestWarning(
                code="DWG_NO_CONVERTER",
                message="DWG→DXF 변환 도구(ODA File Converter)가 설정돼 있지 않거나 변환에 실패했습니다. "
                        "AutoCAD에서 '다른 이름으로 저장 → DXF(AutoCAD 2018 DXF)'로 내보낸 DXF 파일을 다시 업로드해 주세요.",
                context={"path": str(path), "oda_file_converter_path": settings.oda_file_converter_path},
            )],
            coordinate_system=CoordinateSystem(source="dxf_local", notes="dwg not converted"),
        )
    result = parse_dxf(dxf_path)
    result.source_kind = "dwg"
    result.warnings.insert(0, IngestWarning(
        code="DWG_CONVERTED", message="ODA File Converter로 DXF 변환 후 처리했습니다.",
        context={"dwg": str(path), "dxf": str(dxf_path)},
    ))
    return result
