# 변경 이력

형식: `- YYYY-MM-DD [track] vN: 요약` (최신이 위)

## 2026-11-15
- [admin] v2: 법령 데이터 내장 — 21개 용도지역 법정 건폐율·용적률(국토계획법 시행령 §84·§85), 서울 조례, 건축법 시행령 §86·§34 근거·시행일, 진행 중 개정 목록, 지자체 선택·법령 기준일 경고·보고서 근거 표기, 주간 개정 점검 체계
- [core] 1.1.0: MEP·인테리어 트랙 신설 — 공종 F(소방)·I(인테리어) 추가, P를 배관(위생)으로 변경, 객체 sprinkler·panel·light·ceiling·room 추가(3D 박스·외곽·물량 코드 SPK·PNL·LGT·CLG), P.mep·P.interior 추가, TOOLS에 mep·interior 등록, js/mep.js→mep 트랙·js/furn.js와 tools/furn3d.js→interior 트랙으로 소유 이관, 상단 탭 간격 조정
- [mep] v1: 계통별 집계(공종 탭), 층별 천장 속 높이 배분 점검
- [interior] v1: 실 목록, 광속법 평균 조도와 목표 조도(용도별) 판정, 슬래브에서 실 만들기, 부족한 실 조명 자동 배치
- [core] 1.0.0: Git 저장소 기준선 구축 — 아티팩트 버전 1794697024-befc의 app/ 전체(48개 파일) 이관, 트랙 8개 분리, 코어 규격(docs/CORE.md), 소유 범위 검사, CI 추가
