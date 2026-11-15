# 변경 이력

형식: `- YYYY-MM-DD [track] vN: 요약` (최신이 위)

## 2026-11-15
- [struct] v15: 철골 횡비틀림좌굴·플랜지 국부좌굴(슬래브 구속·모멘트도로 Lb·Cb 자동), 기둥 세장효과(층 안정지수 Q·접합부 ψ로 k 자동, RC δns·δs, 철골 B1·B2)
- [core] 1.1.0: MEP·인테리어 트랙 신설 — 공종 F(소방)·I(인테리어) 추가, P를 배관(위생)으로 변경, 객체 sprinkler·panel·light·ceiling·room 추가(3D 박스·외곽·물량 코드 SPK·PNL·LGT·CLG), P.mep·P.interior 추가, TOOLS에 mep·interior 등록, js/mep.js→mep 트랙·js/furn.js와 tools/furn3d.js→interior 트랙으로 소유 이관, 상단 탭 간격 조정
- [mep] v1: 계통별 집계(공종 탭), 층별 천장 속 높이 배분 점검
- [interior] v1: 실 목록, 광속법 평균 조도와 목표 조도(용도별) 판정, 슬래브에서 실 만들기, 부족한 실 조명 자동 배치
- [core] 1.0.0: Git 저장소 기준선 구축 — 아티팩트 버전 1794697024-befc의 app/ 전체(48개 파일) 이관, 트랙 8개 분리, 코어 규격(docs/CORE.md), 소유 범위 검사, CI 추가
