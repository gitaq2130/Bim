"""bim-ingest 완료 조건: RVT + APS 자격증명 없음 → needs_ifc_export. APS 경로는 주입 클라이언트로 네트워크 없이 검증."""
from __future__ import annotations

import base64
import json
import shutil
from pathlib import Path
from typing import Any

import httpx
import pytest

from packages.core.settings import settings
from services.ingest import ingest_file
from services.ingest.rvt_adapter import APSError, APSModelDerivativeClient, ingest_rvt

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SAMPLE_IFC = FIXTURES / "sample.ifc"


@pytest.fixture
def fake_rvt(tmp_path: Path) -> Path:
    p = tmp_path / "model.rvt"
    p.write_bytes(b"\xd0\xcf\x11\xe0" + b"\x00" * 64)   # RVT(OLE) 매직 흉내 — 절대 파싱되지 않아야 한다
    return p


@pytest.fixture
def no_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "aps_client_id", None)
    monkeypatch.setattr(settings, "aps_client_secret", None)


def test_rvt_without_credentials_needs_ifc_export(fake_rvt: Path, no_credentials: None) -> None:
    res = ingest_rvt(fake_rvt)
    assert res.status == "needs_ifc_export"
    assert res.source_kind == "rvt"
    assert res.objects == [] and res.entities == []
    assert res.coordinate_system.source == "ifc_local"
    w = res.warnings[0]
    assert w.code == "RVT_NEEDS_IFC_EXPORT"
    assert "IFC" in w.message and "내보내기" in w.message and "Reference View" in w.message and "Pset" in w.message


def test_ingest_file_dispatches_rvt(fake_rvt: Path, no_credentials: None) -> None:
    assert ingest_file(fake_rvt).status == "needs_ifc_export"
    assert ingest_file(fake_rvt, kind="rvt").status == "needs_ifc_export"


def test_client_requires_credentials(no_credentials: None) -> None:
    with pytest.raises(APSError):
        APSModelDerivativeClient()


class FakeClient:
    """ModelDerivativeClient 프로토콜의 가짜 구현: 호출 순서를 기록하고 sample.ifc를 '다운로드'한다."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def authenticate(self) -> str:
        self.calls.append("authenticate")
        return "token"

    def upload_to_bucket(self, path: Path, bucket_key: str | None = None) -> str:
        self.calls.append("upload")
        return "urn"

    def translate_to_ifc(self, urn: str) -> dict[str, Any]:
        self.calls.append("translate")
        return {"result": "created"}

    def poll_manifest(self, urn: str, timeout_sec: float = 1800.0, interval_sec: float = 10.0) -> dict[str, Any]:
        self.calls.append("poll")
        return {"status": "success"}

    def download_ifc(self, urn: str, manifest: dict[str, Any], dest: Path) -> Path:
        self.calls.append("download")
        shutil.copy(SAMPLE_IFC, dest)
        return dest


def test_rvt_with_injected_client_parses_translated_ifc(fake_rvt: Path, no_credentials: None, tmp_path: Path) -> None:
    client = FakeClient()
    res = ingest_rvt(fake_rvt, client=client, out_dir=tmp_path)
    assert client.calls == ["authenticate", "upload", "translate", "poll", "download"]
    assert res.status == "ok" and res.source_kind == "rvt"
    assert len(res.objects) == 42
    assert res.warnings[0].code == "RVT_VIA_APS"
    assert res.coordinate_system.source == "ifc_local"
    assert (tmp_path / "model.aps.ifc").exists()


def test_rvt_with_failing_client_returns_failed(fake_rvt: Path, tmp_path: Path) -> None:
    class Broken(FakeClient):
        def translate_to_ifc(self, urn: str) -> dict[str, Any]:
            raise APSError("boom")

    res = ingest_rvt(fake_rvt, client=Broken(), out_dir=tmp_path)
    assert res.status == "failed"
    assert [w.code for w in res.warnings] == ["APS_TRANSLATION_FAILED", "RVT_NEEDS_IFC_EXPORT"]
    assert res.coordinate_system.source == "ifc_local"


def test_aps_client_endpoints_with_mock_transport(tmp_path: Path) -> None:
    """문서화된 APS v2 엔드포인트를 httpx.MockTransport로 검증(네트워크 없음)."""
    seen: list[tuple[str, str]] = []
    object_id = "urn:adsk.objects:os.object:buildtwin-rvt-ingest/model.rvt"
    urn = base64.urlsafe_b64encode(object_id.encode()).decode().rstrip("=")

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        p = request.url.path
        if p == "/authentication/v2/token":
            assert request.headers["Authorization"].startswith("Basic ")
            assert b"grant_type=client_credentials" in request.content
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3599})
        if p == "/oss/v2/buckets":
            return httpx.Response(409)
        if p.endswith("/signeds3upload") and request.method == "GET":
            return httpx.Response(200, json={"uploadKey": "k", "urls": ["https://s3.example/upload"]})
        if request.url.host == "s3.example":
            return httpx.Response(200)
        if p.endswith("/signeds3upload") and request.method == "POST":
            assert json.loads(request.content) == {"uploadKey": "k"}
            return httpx.Response(200, json={"objectId": object_id})
        if p == "/modelderivative/v2/designdata/job":
            body = json.loads(request.content)
            assert body["input"]["urn"] == urn and body["output"]["formats"][0]["type"] == "ifc"
            assert request.headers["x-ads-force"] == "true"
            return httpx.Response(200, json={"result": "created"})
        if p == f"/modelderivative/v2/designdata/{urn}/manifest":
            status = "inprogress" if seen.count(("GET", p)) < 2 else "success"
            return httpx.Response(200, json={"status": status, "derivatives": [
                {"outputType": "ifc", "children": [{"urn": f"{urn}/output/model.ifc", "role": "IFC"}]}]})
        if p.endswith("/signedcookies"):
            return httpx.Response(200, json={"url": "https://cdn.example/model.ifc", "cookies": {"a": "b"}})
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=SAMPLE_IFC.read_bytes())
        return httpx.Response(404, text=f"unexpected {p}")

    sleeps: list[float] = []
    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = APSModelDerivativeClient(client_id="id", client_secret="secret", http=http, sleep=sleeps.append)
    assert client.authenticate() == "tok"
    rvt = tmp_path / "model.rvt"
    rvt.write_bytes(b"\x00" * 16)
    assert client.upload_to_bucket(rvt) == urn
    client.translate_to_ifc(urn)
    manifest = client.poll_manifest(urn, timeout_sec=60, interval_sec=1)
    assert manifest["status"] == "success" and sleeps == [1]
    dest = client.download_ifc(urn, manifest, tmp_path / "out.ifc")
    assert dest.read_bytes()[:12] == b"ISO-10303-21"
    assert ("POST", "/authentication/v2/token") in seen
    assert ("POST", "/modelderivative/v2/designdata/job") in seen
