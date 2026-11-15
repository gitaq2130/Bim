# 변경 이력

형식: `- YYYY-MM-DD [track] vN: 요약` (최신이 위)

## 2026-11-15
- [cost] v3: 설계변경 리포트 — 공종·층별 증감, 엑셀 출력(비교·차수별 갑지), 승인 기준 변경 계약금액 누계
- [cost] v2: Core 1.1.0 정합 — 내역 미등록 코드(SPK·PNL·LGT·CLG 등) 경고와 기본 내역 보충, 합계 금액 표시 수정
- [core] 1.1.0: MEP·인테리어 트랙 신설 — 공종 F(소방)·I(인테리어) 추가, P를 배관(위생)으로 변경, 객체 sprinkler·panel·light·ceiling·room 추가(3D 박스·외곽·물량 코드 SPK·PNL·LGT·CLG), P.mep·P.interior 추가, TOOLS에 mep·interior 등록, js/mep.js→mep 트랙·js/furn.js와 tools/furn3d.js→interior 트랙으로 소유 이관, 상단 탭 간격 조정
- [mep] v1: 계통별 집계(공종 탭), 층별 천장 속 높이 배분 점검
- [interior] v1: 실 목록, 광속법 평균 조도와 목표 조도(용도별) 판정, 슬래브에서 실 만들기, 부족한 실 조명 자동 배치
- [core] 1.0.0: Git 저장소 기준선 구축 — 아티팩트 버전 1794697024-befc의 app/ 전체(48개 파일) 이관, 트랙 8개 분리, 코어 규격(docs/CORE.md), 소유 범위 검사, CI 추가
