# 코어 변경 요청

툴 트랙은 코어(데이터 모델·ctx·이벤트·공용 모듈·TOOLS 등록) 변경이 필요할 때 여기에 추가합니다.
허브·코어 트랙이 반영한 뒤 "처리됨"으로 옮깁니다.

형식:
```
### [트랙] 제목 — YYYY-MM-DD
- 변경: 무엇을 (파일·키·함수)
- 이유:
- 영향 트랙:
```

## 대기

### [interior] 실 마감 물량을 내역(BOQ)에 연동 — 2026-11-15
- 변경: `js/model.js` DEFAULT_BOQ에 코드 추가 — `FLR 바닥 마감 m²`, `WLF 벽 마감 m²`, `BSE 걸레받이 m`. `takeoff(P)`가 실(room)별로 `tools/interior.js`의 `roomFinishes(P)` 결과(`q.floor·q.wall·q.base`, 마감명 `fin.*`)를 물량 행으로 추가. 천장은 ceiling 객체가 이미 CLG로 들어가므로 제외.
  - 순환 import(model → tools/interior → model)가 걱정되면, 대안으로 `app/js/finish.js`를 interior 소유로 신설해 계산부를 옮기는 방식도 가능 (owners.mjs 등록 필요).
- 이유: 인테리어 v2에서 실별 마감표·물량을 산정하지만 내역·기성에는 천장(CLG)만 반영됨. 바닥·벽·걸레받이 물량이 물량·기성 화면에 나와야 함.
- 영향 트랙: cost(물량·기성 표시), core(model.js)

## 처리됨

(없음)
