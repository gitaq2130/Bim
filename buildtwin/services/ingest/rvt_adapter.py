"""RVT 어댑터 — RVT 바이너리를 절대 직접 파싱하지 않는다(CLAUDE.md §0 기술 제약).

경로 1) Autodesk Platform Services(APS) Model Derivative: 업로드 → IFC 번역 job → 매니페스트 폴링 → IFC 다운로드 → parse_ifc
경로 2) APS 자격증명이 없으면 status="needs_ifc_export"와 Revit→IFC 내보내기 안내를 반환
자격증명은 settings(.env)에서만 읽는다. 네트워크 클라이언트는 주입 가능해 테스트는 네트워크를 타지 않는다.
"""
from __future__ import annotations

import base64
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

import httpx

from packages.core.models import CoordinateSystem, IngestResult, IngestWarning
from packages.core.settings import settings

from .ifc_parser import parse_ifc

APS_BASE_URL = "https://developer.api.autodesk.com"
APS_SCOPES = "data:read data:write data:create bucket:create bucket:read"
DEFAULT_BUCKET_KEY = "buildtwin-rvt-ingest"

REVIT_IFC_EXPORT_GUIDE = (
    "RVT 파일은 서버에서 직접 열 수 없습니다(Autodesk Platform Services 자격증명 미설정). "
    "Revit에서 IFC로 내보낸 뒤 다시 업로드해 주세요: "
    "① 파일 > 내보내기 > IFC ② 설정에서 'IFC4 Reference View'(또는 IFC4 Design Transfer View) 선택 "
    "③ '속성 세트(Pset) 내보내기'와 '기본 층(Level) 정보 포함'을 체크 ④ 공간 경계·재료 정보 포함 권장 "
    "⑤ 생성된 .ifc 파일을 업로드. 또는 관리자에게 APS_CLIENT_ID/APS_CLIENT_SECRET 설정을 요청하세요."
)


class ModelDerivativeClient(Protocol):
    """ingest_rvt가 의존하는 최소 인터페이스(테스트에서 가짜 구현 주입)."""

    def authenticate(self) -> str: ...
    def upload_to_bucket(self, path: Path, bucket_key: str | None = None) -> str: ...
    def translate_to_ifc(self, urn: str) -> dict[str, Any]: ...
    def poll_manifest(self, urn: str, timeout_sec: float = 1800.0, interval_sec: float = 10.0) -> dict[str, Any]: ...
    def download_ifc(self, urn: str, manifest: dict[str, Any], dest: Path) -> Path: ...


class APSError(RuntimeError):
    pass


def _urn_from_object_id(object_id: str) -> str:
    return base64.urlsafe_b64encode(object_id.encode()).decode().rstrip("=")


class APSModelDerivativeClient:
    """APS v2 엔드포인트 래퍼(문서 기준). 실제 HTTP는 주입된 httpx.Client가 수행한다."""

    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        http: httpx.Client | None = None,
        base_url: str = APS_BASE_URL,
        sleep: Callable[[float], None] = time.sleep,
        bucket_key: str = DEFAULT_BUCKET_KEY,
    ) -> None:
        self.client_id = client_id if client_id is not None else settings.aps_client_id
        self.client_secret = client_secret if client_secret is not None else settings.aps_client_secret
        if not self.client_id or not self.client_secret:
            raise APSError("APS 자격증명(APS_CLIENT_ID/APS_CLIENT_SECRET)이 설정되지 않았습니다.")
        self.base_url = base_url.rstrip("/")
        self.http = http or httpx.Client(timeout=120.0)
        self._sleep = sleep
        self.bucket_key = bucket_key
        self._token: str | None = None

    # ------------------------------------------------------------ helpers
    def _headers(self, **extra: str) -> dict[str, str]:
        if self._token is None:
            self.authenticate()
        return {"Authorization": f"Bearer {self._token}", **extra}

    def _check(self, resp: httpx.Response, what: str) -> dict[str, Any]:
        if resp.status_code >= 400:
            raise APSError(f"{what} 실패: HTTP {resp.status_code} {resp.text[:300]}")
        try:
            return resp.json()
        except ValueError:
            return {}

    # ------------------------------------------------------------ API
    def authenticate(self) -> str:
        """POST /authentication/v2/token (client_credentials)."""
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        resp = self.http.post(
            f"{self.base_url}/authentication/v2/token",
            headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials", "scope": APS_SCOPES},
        )
        data = self._check(resp, "APS 인증")
        token = data.get("access_token")
        if not token:
            raise APSError("APS 인증 응답에 access_token이 없습니다.")
        self._token = token
        return token

    def ensure_bucket(self, bucket_key: str | None = None) -> str:
        """POST /oss/v2/buckets (이미 있으면 409 → 무시)."""
        key = bucket_key or self.bucket_key
        resp = self.http.post(
            f"{self.base_url}/oss/v2/buckets",
            headers=self._headers(**{"Content-Type": "application/json"}),
            json={"bucketKey": key, "policyKey": "transient"},
        )
        if resp.status_code not in (200, 409):
            self._check(resp, "APS 버킷 생성")
        return key

    def upload_to_bucket(self, path: Path, bucket_key: str | None = None) -> str:
        """signed S3 업로드(v2): GET signeds3upload → PUT S3 → POST signeds3upload 완료. 반환: base64 URN."""
        key = self.ensure_bucket(bucket_key)
        path = Path(path)
        object_key = path.name
        base = f"{self.base_url}/oss/v2/buckets/{key}/objects/{object_key}/signeds3upload"
        signed = self._check(self.http.get(base, headers=self._headers()), "APS 업로드 URL 발급")
        urls = signed.get("urls") or []
        upload_key = signed.get("uploadKey")
        if not urls or not upload_key:
            raise APSError("signeds3upload 응답에 urls/uploadKey가 없습니다.")
        with path.open("rb") as fh:
            put = self.http.put(urls[0], content=fh.read())
        if put.status_code >= 400:
            raise APSError(f"S3 업로드 실패: HTTP {put.status_code}")
        done = self._check(
            self.http.post(base, headers=self._headers(**{"Content-Type": "application/json"}), json={"uploadKey": upload_key}),
            "APS 업로드 완료",
        )
        object_id = done.get("objectId")
        if not object_id:
            raise APSError("업로드 완료 응답에 objectId가 없습니다.")
        return _urn_from_object_id(object_id)

    def translate_to_ifc(self, urn: str) -> dict[str, Any]:
        """POST /modelderivative/v2/designdata/job (output ifc)."""
        resp = self.http.post(
            f"{self.base_url}/modelderivative/v2/designdata/job",
            headers=self._headers(**{"Content-Type": "application/json", "x-ads-force": "true"}),
            json={"input": {"urn": urn}, "output": {"formats": [{"type": "ifc"}]}},
        )
        return self._check(resp, "APS 번역 job 생성")

    def get_manifest(self, urn: str) -> dict[str, Any]:
        resp = self.http.get(f"{self.base_url}/modelderivative/v2/designdata/{urn}/manifest", headers=self._headers())
        return self._check(resp, "APS 매니페스트 조회")

    def poll_manifest(self, urn: str, timeout_sec: float = 1800.0, interval_sec: float = 10.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_sec
        while True:
            manifest = self.get_manifest(urn)
            status = str(manifest.get("status", "")).lower()
            if status == "success":
                return manifest
            if status in ("failed", "timeout"):
                raise APSError(f"APS 번역 실패: status={status}")
            if time.monotonic() >= deadline:
                raise APSError("APS 번역 폴링 시간 초과")
            self._sleep(interval_sec)

    @staticmethod
    def _find_ifc_derivative_urn(manifest: dict[str, Any]) -> str | None:
        for deriv in manifest.get("derivatives", []) or []:
            if str(deriv.get("outputType", "")).lower() != "ifc":
                continue
            stack = list(deriv.get("children", []) or [])
            while stack:
                node = stack.pop()
                node_urn = node.get("urn")
                if node_urn and str(node_urn).lower().endswith(".ifc"):
                    return node_urn
                stack.extend(node.get("children", []) or [])
        return None

    def download_ifc(self, urn: str, manifest: dict[str, Any], dest: Path) -> Path:
        """GET .../manifest/{derivativeUrn}/signedcookies → 서명 URL + 쿠키로 내려받기."""
        deriv_urn = self._find_ifc_derivative_urn(manifest)
        if not deriv_urn:
            raise APSError("매니페스트에 IFC 산출물이 없습니다.")
        signed = self._check(
            self.http.get(f"{self.base_url}/modelderivative/v2/designdata/{urn}/manifest/{deriv_urn}/signedcookies", headers=self._headers()),
            "APS 다운로드 URL 발급",
        )
        url = signed.get("url")
        if not url:
            raise APSError("signedcookies 응답에 url이 없습니다.")
        resp = self.http.get(url, cookies=signed.get("cookies") or None)
        if resp.status_code >= 400:
            raise APSError(f"IFC 다운로드 실패: HTTP {resp.status_code}")
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
        return dest


def _has_credentials() -> bool:
    return bool(settings.aps_client_id and settings.aps_client_secret)


def ingest_rvt(path: str | Path, client: ModelDerivativeClient | None = None, out_dir: str | Path | None = None) -> IngestResult:
    """RVT → (APS 번역) → IFC → parse_ifc. 자격증명·클라이언트가 없으면 needs_ifc_export."""
    path = Path(path)
    if client is None:
        if not _has_credentials():
            return IngestResult(
                status="needs_ifc_export", source_kind="rvt",
                warnings=[IngestWarning(code="RVT_NEEDS_IFC_EXPORT", message=REVIT_IFC_EXPORT_GUIDE, context={"path": str(path)})],
                coordinate_system=CoordinateSystem(source="ifc_local", notes="rvt not parsed; awaiting ifc export"),
            )
        client = APSModelDerivativeClient()

    out_dir = Path(out_dir) if out_dir is not None else path.parent
    ifc_path = out_dir / f"{path.stem}.aps.ifc"
    try:
        client.authenticate()
        urn = client.upload_to_bucket(path)
        client.translate_to_ifc(urn)
        manifest = client.poll_manifest(urn)
        client.download_ifc(urn, manifest, ifc_path)
    except Exception as exc:  # noqa: BLE001
        return IngestResult(
            status="failed", source_kind="rvt",
            warnings=[IngestWarning(code="APS_TRANSLATION_FAILED", message=f"APS 변환 실패: {exc}", context={"path": str(path)}),
                      IngestWarning(code="RVT_NEEDS_IFC_EXPORT", message=REVIT_IFC_EXPORT_GUIDE, context={"path": str(path)})],
            coordinate_system=CoordinateSystem(source="ifc_local", notes="aps translation failed"),
        )
    result = parse_ifc(ifc_path, out_dir=out_dir)
    result.source_kind = "rvt"
    result.warnings.insert(0, IngestWarning(code="RVT_VIA_APS", message="APS Model Derivative로 IFC 변환 후 처리했습니다.",
                                            context={"rvt": str(path), "ifc": str(ifc_path)}))
    return result
