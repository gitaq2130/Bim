// 태양 위치 (SunCalc 알고리즘 기반, 자체 구현)
const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
const toDays = (date) => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const decl = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const meanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
const eclLon = (M) => { const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); return M + C + rad * 102.9372 + Math.PI; };

// 반환: altitude(rad), azimuth(rad, 남쪽 기준 서쪽 +)
export function sunPosition(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const M = meanAnomaly(d), L = eclLon(M), dec = decl(L, 0), r = ra(L, 0);
  const H = rad * (280.16 + 360.9856235 * d) - lw - r;
  return {
    azimuth: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
    altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
  };
}
// 평면 좌표계(x=도면 오른쪽, y=도면 위, z=위)에서 태양 방향 단위벡터
// north: 진북이 도면 위쪽(+y)에서 시계방향으로 회전한 각도(°)
export function sunVector(date, lat, lng, north = 0) {
  const { azimuth, altitude } = sunPosition(date, lat, lng);
  const ce = Math.cos(altitude);
  const east = -Math.sin(azimuth) * ce, nrt = -Math.cos(azimuth) * ce, up = Math.sin(altitude);
  const t = north * rad;
  return { x: east * Math.cos(t) + nrt * Math.sin(t), y: -east * Math.sin(t) + nrt * Math.cos(t), z: up, altitude, azimuth };
}
// 현지 날짜/시간(시간대 tz 시간) → Date
export function localToDate(ymd, hours, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + (hours - tz) * 3600000);
}
export const toDeg = (r) => r / rad;
