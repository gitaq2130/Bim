# BuildTwin — 담당: qa
# make dev / make test / make lint / make docs / make fixtures

.PHONY: dev test lint docs fixtures test-py test-web lint-py lint-web

dev: ## API + Celery worker + web dev server
	docker compose up --build

fixtures: ## 샘플 IFC/DXF/E57 다운로드·합성
	python scripts/fetch_fixtures.py

test: test-py test-web ## 커밋 전 필수

test-py:
	pytest tests -q

test-web:
	cd apps/web && npm run test --if-present

lint: lint-py lint-web

lint-py:
	ruff check services packages tests
	mypy services packages

lint-web:
	cd apps/web && npm run lint --if-present && npx tsc --noEmit

docs: ## OpenAPI → docs/api.md (api 에이전트 스크립트)
	python services/api/scripts/gen_api_doc.py
