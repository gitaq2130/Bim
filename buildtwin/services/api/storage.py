"""업로드 저장소. 로컬 FS(settings.storage_root/<project_id>/<file_id>_<filename>) 기본, MinIO 는 선택(미러).

- MinIO: settings.minio_endpoint 가 있고 `minio` 패키지를 import 할 수 있으면 같은 키로 put_object 한다. ingest/scan 파서는
  로컬 경로가 필요하므로 FileRow.uri 는 항상 로컬 경로(posix)다. MinIO 업로드 실패는 경고만 남긴다.
- 해시: sha256, 크기는 스트리밍으로 계산한다.
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from packages.core.settings import settings

log = logging.getLogger(__name__)
_CHUNK = 1024 * 1024
_SAFE = re.compile(r"[^A-Za-z0-9._\-가-힣]+")


@dataclass(frozen=True)
class StoredFile:
    file_id: str
    filename: str
    path: Path
    uri: str
    sha256: str
    size: int
    remote_uri: str | None = None


def storage_root() -> Path:
    return Path(settings.storage_root)


def safe_filename(name: str) -> str:
    base = Path(name or "upload").name
    cleaned = _SAFE.sub("_", base).strip("._") or "upload"
    return cleaned[:120]


def local_path(project_id: str, file_id: str, filename: str) -> Path:
    return storage_root() / project_id / f"{file_id}_{safe_filename(filename)}"


def _minio_client():
    if not settings.minio_endpoint:
        return None
    try:
        from minio import Minio  # type: ignore[import-not-found]
    except ImportError:
        log.info("minio_endpoint set but `minio` package missing; using local storage only")
        return None
    secure = settings.minio_endpoint.startswith("https://")
    endpoint = settings.minio_endpoint.split("://", 1)[-1]
    return Minio(endpoint, access_key=settings.minio_access_key, secret_key=settings.minio_secret_key, secure=secure)


def _mirror_to_minio(path: Path, key: str) -> str | None:
    client = _minio_client()
    if client is None:
        return None
    try:
        if not client.bucket_exists(settings.minio_bucket):
            client.make_bucket(settings.minio_bucket)
        client.fput_object(settings.minio_bucket, key, str(path))
        return f"s3://{settings.minio_bucket}/{key}"
    except Exception as exc:  # noqa: BLE001 — 미러 실패는 치명적이지 않다
        log.warning("minio mirror failed for %s: %s", key, exc)
        return None


def save_stream(project_id: str, file_id: str, filename: str, stream: BinaryIO) -> StoredFile:
    """스트림을 로컬에 청크 단위로 저장하며 sha256/size 를 계산한다."""
    path = local_path(project_id, file_id, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    with open(path, "wb") as out:
        while True:
            chunk = stream.read(_CHUNK)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            out.write(chunk)
    remote = _mirror_to_minio(path, f"{project_id}/{path.name}")
    return StoredFile(file_id=file_id, filename=filename, path=path, uri=path.as_posix(), sha256=digest.hexdigest(),
                      size=size, remote_uri=remote)


def resolve_local_path(uri: str) -> Path | None:
    """FileRow.uri → 로컬 경로. s3:// 는 storage_root 아래 같은 키의 미러를 찾는다."""
    if uri.startswith("s3://"):
        key = uri.split("/", 3)[-1]
        p = storage_root() / key
        return p if p.exists() else None
    p = Path(uri)
    return p if p.exists() else None


def mesh_bundle_path(mesh_uri: str | None) -> Path | None:
    if not mesh_uri:
        return None
    return resolve_local_path(mesh_uri)


def obj_path_for(mesh_uri: str | None) -> Path | None:
    """`<stem>.mesh.json` 옆의 `<stem>.obj` (ingest.ifc_parser 규약)."""
    bundle = mesh_bundle_path(mesh_uri)
    if bundle is None:
        return None
    name = bundle.name
    stem = name[: -len(".mesh.json")] if name.endswith(".mesh.json") else bundle.stem
    p = bundle.with_name(f"{stem}.obj")
    return p if p.exists() else None
