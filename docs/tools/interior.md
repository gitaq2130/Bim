# 인테리어·조명 — 트랙 문서

| 항목 | 값 |
|---|---|
| Rev | v1 |
| 요구 Core | 1.1.0 |
| 브랜치 | `builder/interior` |
| 포함 툴 | 인테리어·조명(interior) |
| 소유 파일 | `app/tools/interior.js`, `app/js/furn.js`, `app/tools/furn3d.js` |

## 기능
실(방)을 정의하고 용도를 고르면 목표 조도가 정해지고, 조명기구 배치로 평균 조도를 계산합니다 (광속법). 슬래브에서 실 만들기, 목표 조도 기준 조명 자동 배치를 제공합니다. 가구 카탈로그와 가구 3D 형상도 이 트랙 소유입니다.

## 데이터
- 읽기: P.content(slab 등), P.levels
- 쓰기: P.interior, 인테리어 객체(room·ceiling·light·furn)
- 다른 트랙에 제공하는 함수: `tools/interior.js`(roomLighting·LUX_BY_USE) → mep, `js/furn.js` → core·cad·ifcout, `tools/furn3d.js` → view3d

### 설계 원칙
- 사용자는 실 용도만 고르고, 목표 조도(KS A 3011 대표값)와 기구 수·배치는 툴이 산정한다.
- 조명기구는 interior가 배치하고, 전기 부하·회로는 mep가 light 객체의 watt를 읽어 계산한다.

## 다음 작업 후보
- [ ] 실별 마감표 (바닥·벽·천장) 입력과 물량 연동
- [ ] 천장 자동 생성 (실 → 천장, 천장고)
- [ ] 조도 분포 계산 (점광원 축점법)과 3D 조명 미리보기
- [ ] 조명 회로 지정 → mep 부하 연동
- [ ] 가구 배치 도구를 cad에서 interior로 이관 검토

## 변경 이력
- v1 (2026-11-15): 트랙 신설 (Core 1.1.0) — 계통 집계·높이 배분 / 실·광속법 조도·조명 자동 배치 기본 기능
