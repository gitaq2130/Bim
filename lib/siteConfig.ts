/**
 * 현장 식별 정보 — 배포처마다 바뀌는 값을 한곳에 모은다.
 *
 * 앱 어디에도 현장명·주소·좌표를 하드코딩하지 않는다. 새 현장에 납품할 때는
 * 이 파일 하나만 교체하면 된다.
 *
 * 여기 들어가는 값과 `lib/seed.ts`의 시드 데이터는 모두 가상의 데모용이다.
 * 실제 프로젝트명, 발주처, 참여사, 개인 연락처를 넣지 말 것.
 */
export interface SiteConfig {
  /** 정식 공사명 */
  projectName: string;
  /** 현장 표기(짧은 형태) */
  siteName: string;
  /** 지역 표기 — 화면 라벨에 쓰인다 */
  regionLabel: string;
  /** 명함·프로필에 노출되는 현장 주소 */
  address: string;
  /** 날씨 조회 좌표 */
  coords: { latitude: number; longitude: number };
  /**
   * 일일 작업보고 원문에서 보고 블록의 시작 줄을 찾을 때 쓰는 현장 토큰.
   * 보고서 제목이 "<토큰> ... 착수보고" 형태인 것을 전제로 한다.
   */
  reportToken: string;
}

export const SITE_CONFIG: SiteConfig = {
  projectName: "한들 물류센터 신축공사",
  siteName: "한들 물류센터 신축현장",
  regionLabel: "한들시",
  address: "한들시 산단로 100 물류센터 신축현장",
  coords: { latitude: 37.5665, longitude: 126.978 },
  reportToken: "한들 물류",
};
