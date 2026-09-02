# BuildTwin — 담당: qa
# make dev / make test / make lint / make docs / make fixtures / make e2e / make api / make web

.PHONY: dev test lint docs fixtures fixtures-public test-py test-unit test-invariants test-regression test-integration test-web e2e lint-py lint-web api web setup

PY := . .venv/bin/activate &&

setup: ## 로컬 개발 환경(venv + npm)
	python3 -m venv .venv
	$(PY) pip install -q --upgrade pip && pip install -q -e ".[dev]"
	cd apps/web && npm install

dev: ## API + Celery worker + web dev server (docker compose)
	docker compose up --build

api: ## 로컬 API만 (SQLite, Celery eager)
	$(PY) uvicorn services.api.main:app --reload --port 8000

web:
	cd apps/web && npm run dev

fixtures: ## 합성 샘플 IFC/DXF/PLY/공정표 생성(seed 고정, 재현 가능) — scripts/fetch_fixtures.py
	$(PY) python scripts/fetch_fixtures.py

fixtures-public: ## + buildingSMART 공개 샘플 IFC 다운로드(tests/fixtures/public/, git 미추적, 실패 시 경고 후 건너뜀)
	$(PY) python scripts/fetch_fixtures.py --public

test: fixtures test-py test-web ## 커밋 전 필수 (fixtures + unit + invariants + regression + integration + web)

test-py: test-unit test-invariants test-regression test-integration

test-unit:
	$(PY) pytest tests/unit -q

test-invariants: ## ADR 0001 불변식(CONFIRMED·confidence/evidence·좌표 하드코딩·rules 로드)
	$(PY) pytest tests/invariants -q

test-regression: ## tests/metrics.json 회귀 기준 강제, 측정값 → tests/metrics.measured.json
	$(PY) pytest tests/regression -q

test-integration: ## API + Celery(eager) + DB
	$(PY) pytest tests/integration -q

test-web:
	cd apps/web && npx vitest run

e2e: fixtures ## 핵심 흐름 E2E(tests/e2e, Playwright) — 로컬 API 필요 시 make api 를 먼저 띄운다
	$(PY) pytest tests/e2e -q

lint: lint-py lint-web

lint-py:
	$(PY) ruff check services packages tests scripts
	$(PY) mypy services packages

lint-web:
	cd apps/web && npm run lint --if-present && npx tsc --noEmit

docs: ## OpenAPI → docs/api.md (api 에이전트 스크립트)
	$(PY) python services/api/scripts/gen_api_doc.py
