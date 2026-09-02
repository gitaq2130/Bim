"""OpenAPI → docs/api.md. `make docs` 또는 `python services/api/scripts/gen_api_doc.py [out]`. 수동 편집 금지."""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_OUT = ROOT / "docs" / "api.md"
HEADER = ("# BuildTwin API\n\n"
          "> 이 파일은 `make docs`(`services/api/scripts/gen_api_doc.py`)가 OpenAPI 스펙에서 **자동 생성**한다. 수동 편집 금지.\n"
          "> 인증: `Authorization: Bearer <JWT>` (POST /api/auth/login). 역할: contractor | cm | client | admin.\n"
          "> 모든 판정·상태 응답은 `confidence` 와 `evidence` 를 포함한다.\n\n")


def _ref_name(schema: dict[str, Any] | None) -> str:
    if not schema:
        return "-"
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]
    if schema.get("type") == "array":
        return f"{_ref_name(schema.get('items'))}[]"
    if "anyOf" in schema:
        return " | ".join(_ref_name(s) for s in schema["anyOf"])
    return str(schema.get("type") or schema.get("title") or "object")


def _body_schema(op: dict[str, Any]) -> str:
    content = (op.get("requestBody") or {}).get("content") or {}
    names = [f"{ctype.split('/')[-1]}: {_ref_name(c.get('schema'))}" for ctype, c in content.items()]
    return "; ".join(names) if names else "-"


def _response_schema(op: dict[str, Any]) -> str:
    for code, resp in (op.get("responses") or {}).items():
        if str(code).startswith("2"):
            content = resp.get("content") or {}
            for c in content.values():
                return _ref_name(c.get("schema"))
            return "-"
    return "-"


def _params(op: dict[str, Any]) -> str:
    out = []
    for p in op.get("parameters") or []:
        if p.get("in") in ("query", "path"):
            out.append(f"{p['name']}{'*' if p.get('required') else ''}({p['in']})")
    return ", ".join(out) or "-"


def render(spec: dict[str, Any]) -> str:
    by_tag: dict[str, list[tuple[str, str, dict[str, Any]]]] = defaultdict(list)
    for path, methods in sorted(spec.get("paths", {}).items()):
        for method, op in methods.items():
            if method.lower() not in ("get", "post", "put", "patch", "delete"):
                continue
            tag = (op.get("tags") or ["default"])[0]
            by_tag[tag].append((method.upper(), path, op))
    lines = [HEADER, f"- 버전: {spec.get('info', {}).get('version', '?')}\n", "\n## 엔드포인트\n"]
    for tag in sorted(by_tag):
        lines.append(f"\n### {tag}\n\n| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |\n|---|---|---|---|---|---|\n")
        for method, path, op in by_tag[tag]:
            summary = (op.get("summary") or (op.get("description") or "").split("\n")[0]).replace("|", "\\|")
            lines.append(f"| {method} | `{path}` | {summary} | {_params(op)} | {_body_schema(op)} | {_response_schema(op)} |\n")
    schemas = (spec.get("components") or {}).get("schemas") or {}
    lines.append("\n## 스키마\n\n| 이름 | 필드 |\n|---|---|\n")
    for name, schema in sorted(schemas.items()):
        props = schema.get("properties") or {}
        required = set(schema.get("required") or [])
        fields = ", ".join(f"`{k}`{'*' if k in required else ''}" for k in props) or (
            "enum: " + ", ".join(map(str, schema.get("enum") or [])) if schema.get("enum") else "-")
        lines.append(f"| {name} | {fields} |\n")
    lines.append("\n`*` = 필수.\n")
    return "".join(lines)


def generate(out: Path = DEFAULT_OUT) -> Path:
    from services.api.main import create_app

    spec = create_app().openapi()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(spec), encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    out = Path(args[0]) if args else DEFAULT_OUT
    path = generate(out)
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
