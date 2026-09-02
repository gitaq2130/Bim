#!/usr/bin/env python
"""픽스처 준비 스크립트 — 담당: qa. `make fixtures` 가 호출한다.

1) 합성 픽스처 재생성: tests/fixtures/gen/make_fixtures.py (seed 고정, 재현 가능) → tests/fixtures/
2) `--public`: buildingSMART 공개 샘플 IFC 를 tests/fixtures/public/ 에 내려받는다(대용량, git 미추적).
   - URL·sha256 은 PUBLIC_SAMPLES 에 명시한다. sha256 이 None 이면 계산값을 출력하고 경고만 남긴다(자리표시자).
   - 다운로드 실패(네트워크·404·해시 불일치)는 경고 후 건너뛴다 — 공개 샘플은 선택 사항이며 테스트는 합성 픽스처만 요구한다.

사용:
  python scripts/fetch_fixtures.py            # 합성 픽스처만
  python scripts/fetch_fixtures.py --public   # + 공개 샘플
  python scripts/fetch_fixtures.py --public --skip-synthetic
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # buildtwin/
FIXTURES = ROOT / "tests" / "fixtures"
GENERATOR = FIXTURES / "gen" / "make_fixtures.py"
PUBLIC_DIR = FIXTURES / "public"
DOWNLOAD_TIMEOUT_S = 120

# 공개 샘플 목록. 출처: buildingSMART Sample-Test-Files (https://github.com/buildingSMART/Sample-Test-Files, CC BY 4.0).
# sha256=None 은 자리표시자 — 최초 성공 다운로드 시 출력되는 값을 확인해 기입한다(그 뒤로는 불일치 시 파일을 버린다).
PUBLIC_SAMPLES: list[dict] = [
    {
        "name": "Duplex_A_20110907.ifc",
        "url": "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/main/IFC%202x3/Duplex%20Apartment/Duplex_A_20110907.ifc",
        "sha256": None,
        "note": "IFC2x3 Duplex Apartment — 벽·슬래브·기둥·문·창. ingest 스모크용",
    },
    {
        "name": "Clinic_A_20110906.ifc",
        "url": "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/main/IFC%202x3/Clinic/Clinic_A_20110906.ifc",
        "sha256": None,
        "note": "IFC2x3 Clinic 건축 모델 — 대형 파일 성능 확인용",
    },
    {
        "name": "column-straight-rectangle-tessellation.ifc",
        "url": "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/main/IFC%204.0/BuildingSMARTSpec/column-straight-rectangle-tessellation.ifc",
        "sha256": None,
        "note": "IFC4 기둥 단품 — IfcColumn 기하 파서 확인용",
    },
]


def _warn(msg: str) -> None:
    print(f"[fetch_fixtures] WARNING: {msg}", file=sys.stderr)


def run_synthetic() -> int:
    print(f"[fetch_fixtures] generating synthetic fixtures via {GENERATOR.relative_to(ROOT)}")
    proc = subprocess.run([sys.executable, str(GENERATOR)], cwd=str(ROOT))
    if proc.returncode != 0:
        _warn(f"synthetic fixture generation failed (exit {proc.returncode})")
    return proc.returncode


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_public(force: bool = False) -> tuple[int, int]:
    """(성공 수, 건너뜀 수). 실패는 예외가 아니라 경고."""
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    ok = skipped = 0
    for sample in PUBLIC_SAMPLES:
        dest = PUBLIC_DIR / sample["name"]
        expected = sample.get("sha256")
        if dest.exists() and not force:
            if expected and _sha256(dest) != expected:
                _warn(f"{dest.name}: existing file sha256 mismatch — re-downloading")
            else:
                print(f"[fetch_fixtures] {dest.name}: already present, skip")
                ok += 1
                continue
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            print(f"[fetch_fixtures] downloading {sample['url']}")
            req = urllib.request.Request(sample["url"], headers={"User-Agent": "buildtwin-qa/fetch_fixtures"})
            with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_S) as resp, tmp.open("wb") as out:
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
            head = tmp.read_bytes()[:64]
            if not head.startswith(b"ISO-10303-21"):
                raise ValueError(f"not a STEP/IFC file (starts with {head[:16]!r})")
            digest = _sha256(tmp)
            if expected is None:
                _warn(f"{dest.name}: sha256 not pinned — computed {digest}; add it to PUBLIC_SAMPLES")
            elif digest != expected:
                raise ValueError(f"sha256 mismatch: expected {expected}, got {digest}")
            tmp.replace(dest)
            print(f"[fetch_fixtures] {dest.name}: ok ({dest.stat().st_size} bytes, sha256 {digest[:12]}…)")
            ok += 1
        except Exception as exc:   # noqa: BLE001 — 공개 샘플은 선택 사항: 어떤 실패든 건너뛴다
            _warn(f"{dest.name}: skipped ({exc})")
            tmp.unlink(missing_ok=True)
            skipped += 1
    return ok, skipped


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--public", action="store_true", help="buildingSMART 공개 샘플 IFC 도 내려받는다(실패 시 경고 후 건너뜀)")
    ap.add_argument("--skip-synthetic", action="store_true", help="합성 픽스처 재생성을 건너뛴다")
    ap.add_argument("--force", action="store_true", help="공개 샘플이 이미 있어도 다시 받는다")
    args = ap.parse_args(argv)

    rc = 0
    if not args.skip_synthetic:
        rc = run_synthetic()
    if args.public:
        ok, skipped = fetch_public(force=args.force)
        print(f"[fetch_fixtures] public samples: {ok} ok, {skipped} skipped → {PUBLIC_DIR.relative_to(ROOT)}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
