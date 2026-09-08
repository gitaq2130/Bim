# BuildTwin — 담당: qa
# make env / make dev / make test / make lint / make docs / make fixtures / make e2e / make api / make web / make seed

.PHONY: env dev test lint docs fixtures fixtures-public test-py test-unit test-invariants test-regression test-integration test-web e2e e2e-deps web-build lint-py lint-web api web setup db-reset seed

PY := . .venv/bin/activate &&

setup: ## 로컬 개발 환경(venv + npm)
	python3 -m venv .venv
	$(PY) pip install -q --upgrade pip && pip install -q -e ".[dev]"
	cd apps/web && npm install

env: ## .env 가 없으면 만든다(문 1·2). 있으면 **한 바이트도 바꾸지 않는다**(ADR 0019 §2-3).
	@if [ -e .env ]; then \
	  echo "※ .env 가 이미 있다 — 한 바이트도 바꾸지 않는다(ADR 0019 §2-3). 새 난수가 필요하면 지우고 다시 부른다."; \
	else \
	  secret=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))'); \
	  if [ -z "$$secret" ]; then echo "make env: JWT_SECRET 난수 생성에 실패했다(python3?) — .env 를 만들지 않는다." >&2; exit 1; fi; \
	  umask 077; \
	  { echo "# BuildTwin — 'make env' 가 만들었다. 커밋 금지(.gitignore). 키 이름 전체는 .env.example."; \
	    echo "# JWT_SECRET: compose 갈래(DATABASE_URL 이 postgres)는 이 값이 없으면 로그인에서 죽는다 —"; \
	    echo "#   packages/core/settings.py 의 resolve_jwt_secret 이 RuntimeError 를 낸다. 값은 난수이고"; \
	    echo "#   저장소의 어떤 파일에도 상수로 없다(CLAUDE.md §3-4)."; \
	    echo "# 다른 키는 비워서 적지 않는다 — 빈 값은 기본값을 덮는다(실측: 'DATABASE_URL=' 한 줄이면"; \
	    echo "#   settings.database_url 이 빈 문자열이 되어 호스트 sqlite 기본값이 사라진다)."; \
	    echo "JWT_SECRET=$$secret"; } > .env; \
	  echo "created .env — JWT_SECRET(난수)만 담았다. 값은 출력하지 않는다."; \
	fi

dev: ## API + Celery worker + web dev server (docker compose)
	@echo "※ 로컬 SQLite(buildtwin.db)를 쓰다가 모델에 컬럼이 추가된 뒤라면 먼저 'make db-reset'."
	@echo "  packages/core/db.init_db 는 create_all 뿐이라 **기존 파일에 새 컬럼을 추가하지 않는다** —"
	@echo "  예: ADR 0009 의 documents.title_identity / identity_fingerprint (계획 0003 §8)."
	docker compose up --build

seed: ## 데모 계정·데모 프로젝트를 만드는 **명시적 명령**(ADR 0018 §2-2). 멱등 — 이미 시드된 DB 에는 아무것도 만들지 않는다.
	@echo "※ 시드는 DATABASE_URL 이 가리키는 DB 에 만든다 — 이 명령은 어떤 DB 인지 가리지 않는다(ADR 0018 §2-4 ㉠)."
	@echo "  이 셸의 DATABASE_URL 이 비어 있으면 packages/core/db 의 기본값(로컬 sqlite ./buildtwin.db)이다."
	$(PY) python -m services.api.seed

db-reset: ## 로컬 개발용 SQLite 폐기(대장·문서는 대장 재업로드로 재생성된다 — ADR 0007 §1 규칙 1: 대장이 정본)
	@echo "removing local sqlite dev database(s): $(wildcard *.db)"
	rm -f *.db

api: ## 로컬 API만 (SQLite, Celery eager) — 모델에 컬럼이 추가된 뒤라면 'make db-reset' 먼저
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

web-build: ## apps/web → dist (Playwright 스모크가 vite preview 로 서빙)
	cd apps/web && npm run build

e2e-deps: ## Playwright(python) — 로컬은 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers 의 내장 Chromium 사용, CI 는 playwright install
	$(PY) pip install -q "playwright==1.56.*" pytest-playwright

e2e: fixtures web-build ## 핵심 흐름 E2E(TestClient 8단계) + Playwright 스모크(uvicorn + vite preview 자동 기동)
	$(PY) pytest tests/e2e -q

lint: lint-py lint-web

lint-py:
	$(PY) ruff check services packages tests scripts
	$(PY) mypy services packages

lint-web:
	cd apps/web && npm run lint --if-present && npx tsc --noEmit

docs: ## OpenAPI → docs/api.md (api 에이전트 스크립트)
	$(PY) python services/api/scripts/gen_api_doc.py
