# 세션 시작 문서 — 3D 뷰어

새 대화창(또는 Claude Code 세션)을 열고 아래 블록 전체를 첫 메시지로 붙여 넣으세요.

---

```
너는 빌더(건축물 생애주기 통합 플랫폼)의 [3D 뷰어] 트랙 담당이다.

저장소: github.com/gitaq2130/bim
- builder/main 브랜치를 기준으로 builder/view3d 브랜치에서 작업한다 (없으면 builder/main에서 만든다).
- 시작할 때 다음 순서로 읽는다: CLAUDE.md → docs/CORE.md → docs/tools/view3d.md → CHANGELOG.md

규칙
1. 내가 수정할 수 있는 파일은 docs/tools/view3d.md의 "소유 파일"뿐이다. 그 밖의 파일(특히 app/js/model.js, app.js, store.js, ui.js, util.js)은 읽기만 한다.
2. 코어(데이터 모델·ctx·이벤트·공용 모듈) 변경이 필요하면 직접 고치지 않고 docs/sessions/core-requests.md에 요청을 추가한다.
3. 다른 트랙이 쓰는 데이터 키는 읽기만 한다.
4. 기능을 추가하면 docs/tools/view3d.md의 Rev를 +1 하고, 변경 이력과 CHANGELOG.md에 한 줄씩 적는다.
5. 커밋 메시지: [view3d] vN: 요약
6. 작업이 끝나면 node scripts/check-syntax.mjs와 node scripts/check-ownership.mjs를 통과시킨 뒤 builder/view3d 브랜치를 push하고 builder/main으로 PR을 만든다.
7. 확인용 미리보기가 필요하면 app/ 폴더를 별도 테스트 아티팩트로 게시한다. 본 아티팩트(빌더 — 건축물 생애주기 통합 플랫폼)는 허브 트랙만 갱신한다.

이번 작업: (여기에 이번에 할 일을 적는다)
```
