"""불변식 테스트 — 담당: qa. CLAUDE.md §0·§3, ADR 0001, .claude/agents/qa.md "불변식 테스트".

(a) ScanState 에 CONFIRMED 없음 (스캔 AI 는 '완료 추정'까지만)
(b) StateTransition(to=CONFIRMED, actor!=cm) 은 모든 from-state × 모든 non-cm actor 에서 예외
(c) 판정 모델(ScanVerdict, EntityObjectMapping, ActivityObjectMapping, RuleVerdict, ReadinessScore, ReviewRequest)에
    confidence(0~1 제약)·evidence(필수) 필드 존재 — 리플렉션 + 실제 검증
(d) services/** · apps/web/src/** (전체 — viewer2d/viewer3d 뿐 아니라 lib/coordinate.ts, sync/*, pages/*.tsx,
    components/*.tsx, domain/* 포함) 에 좌표 상수 하드코딩 없음 (grep 기반 lint)
(e) services/scan/** 소스에 문자열 "CONFIRMED" 없음 (주석·docstring·assert 제외, AST 기반)
(f) services/<svc>/README.md 가 CLAUDE.md 의 담당 에이전트를 명시
(g) rules/**/*.yaml 전부가 해당 로더로 로드됨 (risk → knowledge.load_rules, verification → progress.load_patterns,
    layer_mapping → sync.load_layer_rules, cases → knowledge.CaseStore) — 로더가 모르는 yaml 은 실패
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
import yaml
from pydantic import BaseModel, ValidationError

from packages.core.models import (
    ALLOWED_TRANSITIONS,
    ActivityObjectMapping,
    Actor,
    EntityObjectMapping,
    Evidence,
    InvalidTransitionError,
    ObjectState,
    ReadinessScore,
    ReviewRequest,
    RiskLevel,
    RuleVerdict,
    ScanState,
    ScanVerdict,
    StateTransition,
    validate_transition,
)

ROOT = Path(__file__).resolve().parents[2]          # buildtwin/
SERVICES = ROOT / "services"
RULES = ROOT / "rules"
WEB_SRC = ROOT / "apps/web/src"                     # 전체 트리(뷰어 포함)를 좌표 하드코딩 lint 대상으로 스캔한다

EV = Evidence(source_type="cm_action", source_id="invariant-test", method="test")


# ------------------------------------------------------------------ (a) ScanState
def test_scan_state_has_no_confirmed():
    assert "CONFIRMED" not in ScanState.__members__
    assert "CONFIRMED" not in {s.value for s in ScanState}
    assert {s.value for s in ScanState} == {"NOT_BUILT", "IN_PROGRESS", "ESTIMATED_DONE", "MISMATCH", "UNVERIFIABLE"}


def test_scan_verdict_rejects_confirmed_state():
    with pytest.raises(ValidationError):
        ScanVerdict(scan_id="s", global_id="g", state="CONFIRMED", confidence=1.0, evidence=EV)  # type: ignore[arg-type]


# ------------------------------------------------------------------ (b) CONFIRMED 는 cm 만
NON_CM_ACTORS = [a for a in Actor if a is not Actor.CM]


@pytest.mark.parametrize("actor", NON_CM_ACTORS, ids=lambda a: a.value)
@pytest.mark.parametrize("from_state", list(ObjectState), ids=lambda s: s.value)
def test_transition_to_confirmed_requires_cm(from_state: ObjectState, actor: Actor):
    with pytest.raises(InvalidTransitionError):
        validate_transition(from_state, ObjectState.CONFIRMED, actor)
    with pytest.raises((ValidationError, InvalidTransitionError)):
        StateTransition(global_id="G", from_state=from_state, to_state=ObjectState.CONFIRMED, actor=actor,
                        confidence=1.0, evidence=EV)


@pytest.mark.parametrize("actor", NON_CM_ACTORS, ids=lambda a: a.value)
@pytest.mark.parametrize("to_state", list(ObjectState), ids=lambda s: s.value)
def test_leaving_confirmed_requires_cm(to_state: ObjectState, actor: Actor):
    with pytest.raises(InvalidTransitionError):
        validate_transition(ObjectState.CONFIRMED, to_state, actor)


def test_allowed_transition_table_only_lets_cm_into_confirmed():
    into = {k: v for k, v in ALLOWED_TRANSITIONS.items() if k[1] is ObjectState.CONFIRMED}
    assert into, "table must contain a cm path into CONFIRMED"
    assert all(actors == frozenset({Actor.CM}) for actors in into.values()), into
    assert (ObjectState.INSPECTION_REQUESTED, ObjectState.CONFIRMED) in into


def test_cm_can_confirm_from_inspection_requested_with_evidence():
    t = StateTransition(global_id="G", from_state=ObjectState.INSPECTION_REQUESTED, to_state=ObjectState.CONFIRMED,
                        actor=Actor.CM, actor_id="cm-1", evidence=EV)
    assert t.to_state is ObjectState.CONFIRMED and t.actor is Actor.CM
    with pytest.raises(ValidationError):
        StateTransition(global_id="G", from_state=ObjectState.INSPECTION_REQUESTED, to_state=ObjectState.CONFIRMED,
                        actor=Actor.CM)  # type: ignore[call-arg]  # evidence 누락


# ------------------------------------------------------------------ (c) confidence·evidence 리플렉션
JUDGEMENT_MODELS: dict[type[BaseModel], dict] = {
    ScanVerdict: dict(scan_id="s", global_id="g", state=ScanState.NOT_BUILT),
    EntityObjectMapping: dict(drawing_id="d", entity_handle="h", global_id="g"),
    ActivityObjectMapping: dict(activity_id="a", global_id="g"),
    RuleVerdict: dict(rule_id="RULE-X", rule_version=1, risk_level=RiskLevel.LOW, action="확인", required_evidence=[]),
    ReadinessScore: dict(activity_id="a", score=0.5, components={}, weights={}, blockers=[]),
    ReviewRequest: dict(project_id="p", kind="verification", title="t"),
}


def _bounds(model: type[BaseModel], field: str) -> tuple[float | None, float | None]:
    ge = le = None
    for m in model.model_fields[field].metadata:
        ge = getattr(m, "ge", ge)
        le = getattr(m, "le", le)
    return ge, le


@pytest.mark.parametrize("model", list(JUDGEMENT_MODELS), ids=lambda m: m.__name__)
def test_judgement_model_declares_confidence_0_1_and_required_evidence(model: type[BaseModel]):
    fields = model.model_fields
    assert "confidence" in fields, f"{model.__name__} has no confidence field"
    assert "evidence" in fields, f"{model.__name__} has no evidence field"
    assert _bounds(model, "confidence") == (0.0, 1.0), f"{model.__name__}.confidence must be Field(ge=0, le=1)"
    assert fields["confidence"].is_required(), f"{model.__name__}.confidence must be required (no default)"
    assert fields["evidence"].is_required(), f"{model.__name__}.evidence must be required"
    assert fields["evidence"].annotation is Evidence, f"{model.__name__}.evidence must be typed Evidence"


@pytest.mark.parametrize("model", list(JUDGEMENT_MODELS), ids=lambda m: m.__name__)
def test_judgement_model_enforces_confidence_and_evidence_at_runtime(model: type[BaseModel]):
    base = JUDGEMENT_MODELS[model]
    ok = model(**base, confidence=0.5, evidence=EV)
    assert ok.confidence == 0.5 and ok.evidence is EV
    for bad in (-0.01, 1.01):
        with pytest.raises(ValidationError):
            model(**base, confidence=bad, evidence=EV)
    with pytest.raises(ValidationError):
        model(**base, confidence=0.5)          # evidence 누락
    with pytest.raises(ValidationError):
        model(**base, evidence=EV)             # confidence 누락


def test_state_transition_confidence_bounded_and_evidence_required():
    assert _bounds(StateTransition, "confidence") == (0.0, 1.0)
    assert StateTransition.model_fields["evidence"].is_required()
    with pytest.raises(ValidationError):
        StateTransition(global_id="G", from_state=ObjectState.PLANNED, to_state=ObjectState.REPORTED,
                        actor=Actor.CONTRACTOR)  # type: ignore[call-arg]


# ------------------------------------------------------------------ (d) 좌표 상수 하드코딩 lint
COORD_ASSIGN = re.compile(r"\b(origin|rotation(?:_deg)?|scale|epsg)\s*[:=]\s*([-+]?\d+(?:\.\d+)?)")
EPSG_LITERAL = re.compile(r"""["']EPSG:\d+["']""")
IDENTITY_MARKER = re.compile(r"identity|항등", re.IGNORECASE)
IDENTITY_LOOKBACK = 6
IDENTITY_VALUES = {"origin": {0.0}, "rotation": {0.0}, "rotation_deg": {0.0}, "scale": {1.0}}   # epsg 에는 항등값이 없다
SKIP_DIR_NAMES = {"__pycache__", "node_modules", "tests", "__tests__", "test", "dist", "storage"}
SKIP_FILE_PATTERNS = (re.compile(r".*\.test\.tsx?$"), re.compile(r"^test_.*\.py$"), re.compile(r".*_test\.py$"),
                      re.compile(r"^vitest\.config\.ts$"), re.compile(r"^conftest\.py$"))
COMMENT_PREFIXES = ("#", "//", "/*", "*")
STRING_LITERAL = re.compile(r"""(["'`])(?:\\.|(?!\1).)*\1""")   # "…" '…' `…` (이스케이프 허용). 메시지 텍스트는 코드 상수가 아니다


def _scan_targets() -> list[Path]:
    """검사 대상: services/**/*.py, apps/web/src/**/*.ts|tsx (viewer2d/viewer3d 뿐 아니라 lib/coordinate.ts,
    sync/*, pages/*.tsx, components/*.tsx, domain/* 등 웹 소스 트리 전체).
    제외(설계상 명시): 테스트 파일·디렉터리(tests/, __tests__/, apps/web/src/test/, *.test.ts(x), test_*.py, *_test.py,
    conftest.py), vitest.config.ts, __pycache__/node_modules/dist/storage, 그리고 코드가 아닌 파일(yaml/json/md 는
    애초에 대상이 아님). services/api 는 API 라우터도 좌표를 하드코딩하면 안 되므로 포함한다."""
    out: list[Path] = []
    roots = [(SERVICES, ("*.py",)), (WEB_SRC, ("*.ts", "*.tsx"))]
    for root, globs in roots:
        for g in globs:
            for p in root.rglob(g):
                if any(part in SKIP_DIR_NAMES for part in p.relative_to(ROOT).parts):
                    continue
                if any(pat.match(p.name) for pat in SKIP_FILE_PATTERNS):
                    continue
                out.append(p)
    return sorted(out)


def _code_only(line: str, suffix: str) -> str:
    """문자열 리터럴을 비우고(사용자 메시지·로그 문구 제외) 꼬리 주석을 자른다. 문자열을 먼저 비우므로 문자열 속 #/// 는 안전하다."""
    code = STRING_LITERAL.sub('""', line)
    marker = "#" if suffix == ".py" else "//"
    idx = code.find(marker)
    return code if idx < 0 else code[:idx]


def _is_identity_exempt(lines: list[str], i: int, key: str, value: float) -> bool:
    """항등값(origin 0 / rotation 0 / scale 1)이고, 같은 줄 또는 위 IDENTITY_LOOKBACK 줄 안에 'identity'/'항등' 표기가 있으면 허용.
    "변환 없음"을 뜻하는 자리표시자(예: viewer3d IDENTITY_MODEL_CS)만 통과시키기 위한 유일한 예외다.
    `default` / `# fixture` 같은 주석 마커는 services 에서 예외로 인정하지 않는다(테스트·픽스처는 경로로 제외)."""
    if value not in IDENTITY_VALUES.get(key, set()):
        return False
    window = lines[max(0, i - IDENTITY_LOOKBACK): i + 1]
    return any(IDENTITY_MARKER.search(w) for w in window)


def _coordinate_constant_violations() -> list[str]:
    violations: list[str] = []
    for path in _scan_targets():
        lines = path.read_text(encoding="utf-8").splitlines()
        for i, raw in enumerate(lines):
            stripped = raw.strip()
            if not stripped or stripped.startswith(COMMENT_PREFIXES):
                continue
            code = _code_only(raw, path.suffix)
            for m in COORD_ASSIGN.finditer(code):
                key, value = m.group(1), float(m.group(2))
                if _is_identity_exempt(lines, i, key, value):
                    continue
                violations.append(f"{path.relative_to(ROOT)}:{i + 1}: {stripped}")
            if EPSG_LITERAL.search(raw):   # 문자열 리터럴 검사이므로 원본 줄에서
                violations.append(f"{path.relative_to(ROOT)}:{i + 1}: EPSG literal: {stripped}")
    return violations


def test_lint_targets_are_nonempty():
    targets = _scan_targets()
    assert any(p.suffix == ".py" for p in targets) and any(p.suffix in (".ts", ".tsx") for p in targets)
    assert not any("test" in p.name for p in targets)


def test_lint_targets_cover_whole_web_src_tree_not_just_viewers():
    """회귀 방지: (d) 의 스캔 범위가 다시 viewer2d/viewer3d 로 좁아지면 실패해야 한다."""
    rels = {p.relative_to(ROOT).as_posix() for p in _scan_targets()}
    must_include = {
        "apps/web/src/lib/coordinate.ts",
        "apps/web/src/sync/broker.ts",
        "apps/web/src/sync/selectionSlice.ts",
        "apps/web/src/pages/ViewerPage.tsx",
        "apps/web/src/components/AppLayout.tsx",
        "apps/web/src/domain/labels.ts",
        "apps/web/src/viewer2d/overlay.ts",
        "apps/web/src/viewer3d/Viewer3D.tsx",
    }
    missing = must_include - rels
    assert not missing, f"coordinate lint no longer scans: {missing}"
    must_exclude = {
        "apps/web/src/lib/coordinate.test.ts",
        "apps/web/src/sync/broker.test.ts",
        "apps/web/src/test/fixtures.ts",
        "apps/web/src/test/setup.ts",
        "apps/web/src/test/utils.tsx",
        "apps/web/src/viewer3d/vitest.config.ts",
    }
    leaked = must_exclude & rels
    assert not leaked, f"coordinate lint must not scan test-only files: {leaked}"


def test_lint_regex_catches_hardcoded_coordinates(tmp_path: Path):
    """lint 자체의 자기검증: 하드코딩은 잡고, 표기된 항등값은 통과."""
    assert COORD_ASSIGN.search("origin = (123.4, 5)") is None          # 튜플 시작 — 값이 숫자 리터럴이 아님(생성 코드)
    assert COORD_ASSIGN.search("origin=123.4") is not None
    assert COORD_ASSIGN.search("rotation_deg: 15") is not None
    assert COORD_ASSIGN.search("scale: 0.001,") is not None
    assert COORD_ASSIGN.search("epsg = 5186") is not None
    assert COORD_ASSIGN.search("unit_scale = 1.0") is None            # \b 경계: unit_scale 은 대상이 아님
    assert EPSG_LITERAL.search('crs = "EPSG:5186"') is not None
    assert COORD_ASSIGN.search(_code_only('msg = f"scale=1.0으로 두었으니 확인"  # scale=2', ".py")) is None   # 문자열·주석 제외
    assert COORD_ASSIGN.search(_code_only("scale = 0.001  // mm", ".ts")) is not None
    lines = ["/** identity: 변환 없음 */", "const CS = {", "  rotation_deg: 0,", "  scale: 1,", "  epsg: 0,"]
    assert _is_identity_exempt(lines, 2, "rotation_deg", 0.0)
    assert _is_identity_exempt(lines, 3, "scale", 1.0)
    assert not _is_identity_exempt(lines, 4, "epsg", 0.0)
    assert not _is_identity_exempt(["x", "scale: 1"], 1, "scale", 1.0)   # 표기 없는 항등값은 불허
    assert not _is_identity_exempt(["// identity", "scale: 2"], 1, "scale", 2.0)


def test_no_hardcoded_coordinate_constants_in_services_and_viewers():
    violations = _coordinate_constant_violations()
    assert not violations, "coordinate constants must come from CoordinateSystem (DB/user input), not code:\n" + "\n".join(violations)


# ------------------------------------------------------------------ (e) services/scan 에 CONFIRMED 없음
def _rel(path: Path) -> str:
    return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name


def _confirmed_references(path: Path) -> list[str]:
    """AST 기반: 주석은 AST 에 없고, docstring(Expr 첫 문장)과 assert 안의 참조는 제외한다."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
                docstrings.add(id(body[0].value))
    inside_assert: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assert):
            for sub in ast.walk(node):
                inside_assert.add(id(sub))
    hits: list[str] = []
    for node in ast.walk(tree):
        if id(node) in inside_assert or id(node) in docstrings:
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and "CONFIRMED" in node.value:
            hits.append(f"{_rel(path)}:{node.lineno}: string {node.value!r}")
        elif isinstance(node, ast.Attribute) and node.attr == "CONFIRMED":
            hits.append(f"{_rel(path)}:{node.lineno}: attribute .CONFIRMED")
        elif isinstance(node, ast.Name) and node.id == "CONFIRMED":
            hits.append(f"{_rel(path)}:{node.lineno}: name CONFIRMED")
    return hits


def test_confirmed_reference_detector_self_check(tmp_path: Path):
    src = '"""docstring CONFIRMED ok"""\n# comment CONFIRMED ok\nassert "CONFIRMED" not in X\nstate = "CONFIRMED"\ny = S.CONFIRMED\n'
    p = tmp_path / "m.py"
    p.write_text(src, encoding="utf-8")
    hits = _confirmed_references(p)
    assert len(hits) == 2 and hits[0].endswith(":4: string 'CONFIRMED'") and "attribute" in hits[1]


def test_scan_service_never_mentions_confirmed_in_code():
    files = [p for p in (SERVICES / "scan").rglob("*.py") if "__pycache__" not in p.parts]
    assert files
    hits = [h for p in files for h in _confirmed_references(p)]
    assert not hits, "services/scan must not produce/reference CONFIRMED (scan AI stops at ESTIMATED_DONE):\n" + "\n".join(hits)


# ------------------------------------------------------------------ (f) README 담당 에이전트
SERVICE_OWNERS = {   # CLAUDE.md §2 디렉터리 구조 / §4 에이전트 표
    "ingest": "bim-ingest", "sync": "sync-2d3d", "scan": "reality-capture",
    "progress": "progress-engine", "knowledge": "knowledge", "api": "api",
}


def test_claude_md_agrees_with_service_owner_table():
    text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    for svc, agent in SERVICE_OWNERS.items():
        assert re.search(rf"`{re.escape(agent)}`\s*\|[^|\n]*\|\s*`services/{svc}/`", text), f"CLAUDE.md agent table: {agent} → services/{svc}/"


@pytest.mark.parametrize("svc", sorted(SERVICE_OWNERS), ids=str)
def test_service_readme_names_its_agent(svc: str):
    readme = SERVICES / svc / "README.md"
    assert readme.is_file(), f"services/{svc}/README.md missing"
    text = readme.read_text(encoding="utf-8")
    agent = SERVICE_OWNERS[svc]
    assert re.search(rf"담당 에이전트\s*[:：]\s*`?{re.escape(agent)}`?", text), f"services/{svc}/README.md must name agent `{agent}`"
    others = [a for a in SERVICE_OWNERS.values() if a != agent and a != svc]
    for other in others:
        assert not re.search(rf"담당 에이전트\s*[:：]\s*`?{re.escape(other)}`?", text), f"services/{svc}/README.md names wrong agent {other}"


# ------------------------------------------------------------------ (g) rules/**/*.yaml 로드
def _yaml_files(base: Path) -> list[Path]:
    return sorted(p for p in base.rglob("*") if p.suffix in (".yaml", ".yml"))


def test_all_rule_yaml_files_are_covered_by_a_loader():
    covered = {p for p in _yaml_files(RULES / "risk")} | {p for p in _yaml_files(RULES / "cases")}
    covered |= {RULES / "verification.yaml", RULES / "layer_mapping.yaml"}
    unknown = [str(p.relative_to(ROOT)) for p in _yaml_files(RULES) if p not in covered]
    assert not unknown, f"rules yaml without a loader/test: {unknown}"
    assert (RULES / "verification.yaml").is_file() and (RULES / "layer_mapping.yaml").is_file()


def test_risk_rules_load_with_knowledge_loader():
    from services.knowledge import load_rules

    files = _yaml_files(RULES / "risk")
    assert files
    rules = load_rules(RULES)
    raw_ids = [r["id"] for f in files for r in (yaml.safe_load(f.read_text(encoding="utf-8")) or [])]
    assert sorted(raw_ids) == sorted(r.id for r in rules), "every rule in rules/risk/*.yaml must load"
    assert 5 <= len(rules)


def test_verification_patterns_load_with_progress_loader():
    from services.common.safe_expr import validate
    from services.progress.verification import clear_pattern_cache, load_patterns

    raw = yaml.safe_load((RULES / "verification.yaml").read_text(encoding="utf-8"))
    raw_ids = [p["id"] for p in raw["patterns"]]
    assert raw_ids and len(raw_ids) == len(set(raw_ids))
    for p in raw["patterns"]:
        validate(p["when"])
        assert 0.0 <= float(p["confidence"]) <= 1.0, p["id"]
    clear_pattern_cache()
    loaded = load_patterns()
    assert [p["id"] for p in loaded] == raw_ids, "load_patterns() silently skipped a pattern (bad `when`?)"
    assert all(callable(p["_eval"]) for p in loaded)


def test_layer_mapping_loads_with_sync_loader():
    from services.sync.rules import load_layer_rules

    rules = load_layer_rules(RULES / "layer_mapping.yaml")
    raw = yaml.safe_load((RULES / "layer_mapping.yaml").read_text(encoding="utf-8"))
    assert len(rules.layers) == len(raw["layers"]) and len(rules.blocks) == len(raw["blocks"])
    assert rules.grid_layers == raw["grid_layers"]
    assert all(0.0 <= r.weight <= 1.0 and r.ifc_types for r in rules.layers + rules.blocks)


def test_case_yaml_files_load_with_case_store():
    from services.knowledge import CaseStore

    files = _yaml_files(RULES / "cases")
    assert files
    raw_ids = [c["case_id"] for f in files for c in (yaml.safe_load(f.read_text(encoding="utf-8")) or [])]
    store = CaseStore(RULES / "cases")
    assert sorted(c.case_id for c in store.all()) == sorted(raw_ids)
