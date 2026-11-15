# 빌더 저장소 — Claude 작업 규칙

이 브랜치 계열(`builder/*`)은 **빌더**(건축물 생애주기 통합 플랫폼)입니다. 같은 저장소의 `claude/agendatalk-*` 브랜치는 별개 제품(안건톡)이므로 건드리지 않습니다.

## 시작할 때
1. 사용자가 지정한 트랙을 확인합니다 (core, cad, view3d, struct, cost, review, field, admin, mep, interior, civil, landscape, csim). 지정하지 않았으면 먼저 물어봅니다.
2. 읽는 순서: `docs/CORE.md` → `docs/tools/<track>.md` (core는 `docs/sessions/core-requests.md`) → `CHANGELOG.md`
3. 작업 브랜치 `builder/<track>`에서 작업합니다. 브랜치가 없으면 `builder/main`에서 만듭니다.

## 반드시 지킬 것
- 트랙 소유 파일만 수정합니다 (`scripts/owners.mjs`). 코어 변경이 필요하면 `docs/sessions/core-requests.md`에 요청을 추가합니다.
- 다른 트랙 소유의 `P.*` 데이터 키는 읽기만 합니다 (`docs/CORE.md` 5장).
- `P`를 수정한 뒤 `ctx.touch()`, 객체(els)를 수정한 뒤 `ctx.bus.emit('model')`을 호출합니다.
- 단위는 mm입니다. 구조 설계값은 툴이 자동으로 산정하고, 사용자는 현장 수치와 용도만 입력합니다.
- UI 문구는 한국어로 씁니다.
- `app/lib/`(벤더 파일)는 수정하지 않습니다.

## 끝낼 때
- `node scripts/check-syntax.mjs`, `node scripts/check-ownership.mjs` 통과
- 트랙 문서의 Rev +1, 변경 이력과 `CHANGELOG.md`에 한 줄씩 기록
- 커밋 `[track] vN: 요약` → `builder/<track>` push → `builder/main`으로 PR
- 본 아티팩트 게시는 core 트랙만 합니다.

## 로컬 실행
`npm run serve` → http://localhost:8080 (ES 모듈이라 file://로는 열리지 않습니다)
