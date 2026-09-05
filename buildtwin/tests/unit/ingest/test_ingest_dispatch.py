"""ingest_file 분기(확장자·매직바이트), DWG 폴백, Celery 태스크(eager)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from packages.core.settings import settings
from services.common.celery_app import celery_app
from services.ingest import detect_file_kind, ingest_file
from services.ingest.dwg_adapter import convert_dwg_to_dxf, parse_dwg
from services.ingest.tasks import ingest_file_task

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def test_detect_by_extension() -> None:
    assert detect_file_kind(FIXTURES / "sample.ifc") == "ifc"
    assert detect_file_kind(FIXTURES / "sample.dxf") == "dxf"
    assert detect_file_kind(Path("x.RVT")) == "rvt"
    assert detect_file_kind(Path("x.dwg")) == "dwg"
    assert detect_file_kind(Path("x.e57")) == "e57"


def test_detect_by_magic_bytes(tmp_path: Path) -> None:
    (tmp_path / "ifc_noext").write_bytes((FIXTURES / "sample.ifc").read_bytes()[:2000])
    (tmp_path / "dxf_noext").write_bytes((FIXTURES / "sample.dxf").read_bytes()[:2000])
    (tmp_path / "dwg_noext").write_bytes(b"AC1032" + b"\x00" * 100)
    (tmp_path / "junk").write_bytes(b"\x89PNG\r\n")
    assert detect_file_kind(tmp_path / "ifc_noext") == "ifc"
    assert detect_file_kind(tmp_path / "dxf_noext") == "dxf"
    assert detect_file_kind(tmp_path / "dwg_noext") == "dwg"
    assert detect_file_kind(tmp_path / "junk") == "unknown"


def test_ingest_file_routes_ifc_and_dxf(tmp_path: Path) -> None:
    ifc = ingest_file(FIXTURES / "sample.ifc", out_dir=tmp_path)
    assert ifc.source_kind == "ifc" and ifc.status == "ok" and ifc.objects
    assert Path(ifc.mesh_uri).parent == tmp_path
    dxf = ingest_file(FIXTURES / "sample.dxf")
    assert dxf.source_kind == "dxf" and dxf.status == "ok" and dxf.entities


def test_ingest_file_unknown_and_missing(tmp_path: Path) -> None:
    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"\x00\x01")
    res = ingest_file(junk)
    assert res.status == "failed" and res.warnings[0].code == "UNSUPPORTED_FILE_KIND"
    assert res.coordinate_system.source
    res2 = ingest_file(tmp_path / "missing.ifc")
    assert res2.status == "failed" and res2.warnings[0].code == "FILE_NOT_FOUND"
    res3 = ingest_file(junk, kind="e57")
    assert res3.status == "failed" and res3.warnings[0].code == "KIND_NOT_HANDLED_BY_INGEST"


def test_dwg_without_converter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "oda_file_converter_path", None)
    dwg = tmp_path / "plan.dwg"
    dwg.write_bytes(b"AC1032" + b"\x00" * 100)
    assert convert_dwg_to_dxf(dwg) is None
    res = parse_dwg(dwg)
    assert res.status == "failed" and res.source_kind == "dwg"
    assert res.warnings[0].code == "DWG_NO_CONVERTER" and "DXF" in res.warnings[0].message
    assert res.coordinate_system.source == "dxf_local"
    assert ingest_file(dwg).status == "failed"


def test_dwg_with_fake_converter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ODA CLI 대신 sample.dxf를 출력 폴더에 복사하는 가짜 변환기 스크립트."""
    fake = tmp_path / "fake_oda.py"
    fake.write_text(
        "#!/usr/bin/env python3\nimport shutil, sys\n"
        f"shutil.copy({str(FIXTURES / 'sample.dxf')!r}, sys.argv[2] + '/plan.dxf')\n",
        encoding="utf-8",
    )
    fake.chmod(0o755)
    monkeypatch.setattr(settings, "oda_file_converter_path", str(fake))
    dwg = tmp_path / "plan.dwg"
    dwg.write_bytes(b"AC1032" + b"\x00" * 100)
    out = tmp_path / "out"
    assert convert_dwg_to_dxf(dwg, out) == out / "plan.dxf"
    res = parse_dwg(dwg, out)
    assert res.status == "ok" and res.source_kind == "dwg" and res.entities
    assert res.warnings[0].code == "DWG_CONVERTED"


def test_celery_task_eager_returns_json_dump(tmp_path: Path) -> None:
    assert celery_app.conf.task_always_eager is True
    async_result = ingest_file_task.delay("job-1", str(FIXTURES / "sample.dxf"), "dxf", str(tmp_path))
    payload = async_result.get()
    assert isinstance(payload, dict)
    json.dumps(payload)  # JSON 직렬화 가능해야 한다(api가 저장)
    assert payload["status"] == "ok" and payload["source_kind"] == "dxf"
    assert payload["coordinate_system"]["source"] == "dxf_local"
    assert len(payload["entities"]) == payload["stats"]["entities_total"]
    assert "state" not in payload and all("state" not in o for o in payload["objects"])
