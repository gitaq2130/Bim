# BuildTwin — 담당: qa
# make dev / make test / make lint / make docs / make fixtures / make api / make web

.PHONY: dev test lint docs fixtures test-py test-web lint-py lint-web api web setup

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

fixtures: ## 합성 샘플 IFC/DXF/PLY/공정표 생성(seed 고정, 재현 가능)
	$(PY) python tests/fixtures/gen/make_fixtures.py

test: fixtures test-py test-web ## 커밋 전 필수

test-py:
	$(PY) pytest tests -q

test-web:
	cd apps/web && npx vitest run

lint: lint-py lint-web

lint-py:
	$(PY) ruff check services packages tests
	$(PY) mypy services packages

lint-web:
	cd apps/web && npm run lint --if-present && npx tsc --noEmit

docs: ## OpenAPI → docs/api.md (api 에이전트 스크립트)
	$(PY) python services/api/scripts/gen_api_doc.py
