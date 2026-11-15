# 빌더 — 건축물 생애주기 통합 플랫폼

작도·3D·구조·물량·기성·간섭·정합·공정·현장·일보·이슈·법규·MEP·인테리어 툴을 하나의 프로젝트 데이터 위에서 연동하는 웹 플랫폼입니다.

- 실행본(아티팩트): https://claude.ai/artifact/UYzd44TWdduydr5QtkyyLG
- 코어 규격: [docs/CORE.md](docs/CORE.md)
- Claude 작업 규칙: [CLAUDE.md](CLAUDE.md)

## 폴더

```
app/                 배포 단위 (아티팩트에 그대로 게시)
  index.html
  js/                코어 공용 모듈 + 구조 엔진 등
  tools/             툴 모듈 (mount(root, ctx))
  lib/               벤더 파일 (pdf.js, web-ifc)
docs/
  CORE.md            코어 규격 — 데이터 모델, ctx, 이벤트, 버전 규칙
  tools/<track>.md   트랙별 기능·소유 파일·Rev·다음 작업
  sessions/<track>.md  새 대화창에 붙여 넣는 세션 시작 문서
  sessions/core-requests.md  코어 변경 요청함
scripts/             소유 범위 정의·검사, 문법 검사
CORE_VERSION         코어 버전
CHANGELOG.md
```

## 트랙 (대화창 단위)

| 트랙 | 툴 | 브랜치 | Rev |
|---|---|---|---|
| core 허브·코어 | 통합 대시보드, 데이터 모델, 저장, 입출력 | `builder/core` | Core 1.1.0 |
| cad 작도 | cad | `builder/cad` | v1 |
| view3d 3D 뷰어 | view3d | `builder/view3d` | v1 |
| struct 구조 | struct | `builder/struct` | v14 |
| cost 물량·기성 | qto, bill | `builder/cost` | v1 |
| review 간섭·정합 | clash, check | `builder/review` | v1 |
| field 공정·현장·일보 | sched, site, daily | `builder/field` | v1 |
| admin 이슈·법규 | issue, code | `builder/admin` | v1 |
| mep 설비·전기·소방 | mep | `builder/mep` | v1 |
| interior 인테리어·조명 | interior | `builder/interior` | v1 |

## 작업 흐름

1. `docs/sessions/<track>.md`의 블록을 새 대화창(또는 Claude Code 세션)에 붙여 넣고, 이번 작업을 적습니다.
2. 트랙 세션이 `builder/<track>`에서 작업하고 `builder/main`으로 PR을 만듭니다.
3. 코어 변경이 필요하면 `core-requests.md`에 요청 → 허브 세션이 반영하고 버전을 올립니다.
4. 허브 세션이 PR을 병합하고 아티팩트를 갱신합니다.

## 로컬 실행

```bash
npm run serve   # http://localhost:8080
npm run check   # 문법 검사
```
