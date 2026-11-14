// 가구·설비·조경 카탈로그 + 평면 기호 (로컬 좌표: 중심 원점, x=폭, y=깊이, +y가 뒤(벽쪽))
export const FURN = {
  sofa: { name: '소파(3인)', cat: '거실', w: 2400, d: 950, h: 820 },
  armchair: { name: '안락의자', cat: '거실', w: 850, d: 850, h: 820 },
  coffee: { name: '커피 테이블', cat: '거실', w: 1200, d: 600, h: 400 },
  tvunit: { name: 'TV·거실장', cat: '거실', w: 2400, d: 450, h: 500 },
  rug: { name: '러그', cat: '거실', w: 3000, d: 2000, h: 12 },
  plant: { name: '실내 화분', cat: '거실', w: 500, d: 500, h: 1300 },
  dining4: { name: '식탁(4인)', cat: '주방', w: 1400, d: 850, h: 740 },
  dining6: { name: '식탁(6인)', cat: '주방', w: 1800, d: 900, h: 740 },
  kitchen: { name: '주방 싱크대(상·하부장)', cat: '주방', w: 3600, d: 600, h: 850 },
  island: { name: '아일랜드 식탁', cat: '주방', w: 2400, d: 900, h: 900 },
  fridge: { name: '양문형 냉장고', cat: '주방', w: 900, d: 750, h: 1850 },
  bed_s: { name: '침대(싱글)', cat: '침실', w: 1100, d: 2100, h: 520 },
  bed_q: { name: '침대(퀸)', cat: '침실', w: 1600, d: 2150, h: 520 },
  bed_k: { name: '침대(킹)', cat: '침실', w: 1850, d: 2150, h: 520 },
  nightstand: { name: '협탁', cat: '침실', w: 450, d: 400, h: 500 },
  wardrobe: { name: '붙박이장', cat: '침실', w: 2400, d: 600, h: 2300 },
  desk: { name: '책상+의자', cat: '침실', w: 1200, d: 600, h: 740 },
  bookshelf: { name: '책장', cat: '침실', w: 1800, d: 350, h: 2000 },
  toilet: { name: '양변기', cat: '욕실', w: 400, d: 700, h: 780 },
  vanity: { name: '세면대(하부장)', cat: '욕실', w: 900, d: 500, h: 850 },
  bath: { name: '욕조', cat: '욕실', w: 1600, d: 750, h: 550 },
  shower: { name: '샤워부스', cat: '욕실', w: 1000, d: 1000, h: 2000 },
  washer: { name: '세탁기', cat: '다용도', w: 650, d: 650, h: 850 },
  counter: { name: '다용도 선반·싱크', cat: '다용도', w: 1500, d: 600, h: 850 },
  shoe: { name: '신발장', cat: '현관', w: 1800, d: 400, h: 2100 },
  stair: { name: '계단(직선)', cat: '건축', w: 1100, d: 4700, h: 3300 },
  rail: { name: '난간(유리)', cat: '건축', w: 3000, d: 50, h: 1100 },
  floor: { name: '바닥 마감(부분)', cat: '건축', w: 3000, d: 3000, h: 8 },
  car: { name: '자동차', cat: '외부', w: 1850, d: 4700, h: 1450 },
  tree: { name: '교목(수목)', cat: '조경', w: 4000, d: 4000, h: 6000 },
  shrub: { name: '관목', cat: '조경', w: 1000, d: 1000, h: 900 },
  deck: { name: '목재 데크', cat: '조경', w: 4000, d: 2500, h: 150 },
  paving: { name: '포장(진입로)', cat: '조경', w: 3000, d: 3000, h: 40 },
  fence: { name: '담장·펜스', cat: '조경', w: 10000, d: 60, h: 1200 },
  outdoor: { name: '야외 테이블 세트', cat: '조경', w: 1000, d: 1000, h: 720 },
  stair_u: { name: '계단(U자형)', cat: '건축', w: 3000, d: 4000, h: 4200 },
  elevator: { name: '엘리베이터 카', cat: '건축', w: 2000, d: 1700, h: 2500 },
  workstation: { name: '워크스테이션(4인)', cat: '사무', w: 2800, d: 1600, h: 1150 },
  meeting: { name: '회의 테이블(8인)', cat: '사무', w: 3600, d: 1200, h: 740 },
  reception: { name: '안내 데스크', cat: '사무', w: 4000, d: 900, h: 1100 },
  ahu: { name: '공조기(AHU)', cat: '기계설비', w: 4000, d: 2000, h: 2400 },
  chiller: { name: '냉동기', cat: '기계설비', w: 3600, d: 1600, h: 2200 },
  ctower: { name: '냉각탑', cat: '기계설비', w: 4000, d: 4000, h: 4500 },
  pump: { name: '펌프', cat: '기계설비', w: 1200, d: 700, h: 900 },
  tank: { name: '저수조', cat: '기계설비', w: 4000, d: 3000, h: 3000 },
  vav: { name: 'VAV 유닛', cat: '기계설비', w: 900, d: 600, h: 450 },
  louver: { name: '외기 루버', cat: '기계설비', w: 1500, d: 600, h: 1500 },
  fan: { name: '배기팬', cat: '기계설비', w: 1500, d: 1500, h: 1200 },
  grille: { name: '리턴 그릴', cat: '기계설비', w: 600, d: 600, h: 60 },
  pit: { name: '오배수 배출구(맨홀)', cat: '기계설비', w: 900, d: 900, h: 120 },
  tr: { name: '변압기', cat: '전기설비', w: 2400, d: 1600, h: 2200 },
  swgr: { name: '수배전반', cat: '전기설비', w: 4000, d: 1000, h: 2300 },
  gen: { name: '비상발전기', cat: '전기설비', w: 5000, d: 2000, h: 2500 },
  panel: { name: '분전반', cat: '전기설비', w: 1000, d: 300, h: 2000 },
};
export const FURN_CATS = [...new Set(Object.values(FURN).map(f => f.cat))];
export const furnName = (el) => FURN[el.type]?.name || '가구';

const R = (x0, y0, x1, y1) => ({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
const L = (a, b) => ({ poly: [a, b] });
const C = (x, y, r) => ({ circle: [x, y, r] });
// 평면 기호 (로컬)
export function furnPlan(el) {
  const w = el.w, d = el.d, hw = w / 2, hd = d / 2, t = el.type, out = [R(-hw, -hd, hw, hd)];
  const chair = (cx, cy, a) => { const c = Math.cos(a), s = Math.sin(a), q = (x, y) => [cx + x * c - y * s, cy + x * s + y * c]; return [{ poly: [q(-220, -220), q(220, -220), q(220, 220), q(-220, 220)], closed: true }, { poly: [q(-220, 180), q(220, 180)] }]; };
  switch (t) {
    case 'sofa': out.push(R(-hw, hd - 220, hw, hd), R(-hw, -hd, -hw + 200, hd), R(hw - 200, -hd, hw, hd), L([-hw / 3 + 70, -hd], [-hw / 3 + 70, hd - 220]), L([hw / 3 - 70, -hd], [hw / 3 - 70, hd - 220])); break;
    case 'armchair': out.push(R(-hw, hd - 200, hw, hd), R(-hw, -hd, -hw + 160, hd), R(hw - 160, -hd, hw, hd)); break;
    case 'tvunit': out.push(R(-hw * 0.7, hd - 80, hw * 0.7, hd - 20)); break;
    case 'dining4': case 'dining6': { const n = t === 'dining6' ? 3 : 2; for (let i = 0; i < n; i++) { const x = -hw + w * (i + 0.5) / n; out.push(...chair(x, -hd - 280, 0), ...chair(x, hd + 280, Math.PI)); } break; }
    case 'kitchen': out.push(L([-hw, -hd + 30], [hw, -hd + 30]), R(-hw * 0.35, -hd + 120, -hw * 0.05, hd - 100), C(hw * 0.35 - 150, 0, 110), C(hw * 0.35 + 150, 0, 110), C(hw * 0.35 - 150, 0 - 0, 60)); break;
    case 'island': for (const x of [-hw * 0.6, 0, hw * 0.6]) out.push(C(x, -hd - 300, 180)); break;
    case 'fridge': out.push(L([0, -hd], [0, hd - 50]), L([-hw, -hd + 40], [hw, -hd + 40])); break;
    case 'bed_s': case 'bed_q': case 'bed_k': { const pw = t === 'bed_s' ? w - 300 : (w - 300) / 2 - 50; out.push(R(-hw, hd - 80, hw, hd)); if (t === 'bed_s') out.push(R(-pw / 2, hd - 550, pw / 2, hd - 150)); else out.push(R(-hw + 150, hd - 550, -hw + 150 + pw, hd - 150), R(hw - 150 - pw, hd - 550, hw - 150, hd - 150)); out.push(L([-hw, hd - 700], [hw, hd - 900])); break; }
    case 'wardrobe': case 'shoe': { const n = Math.max(2, Math.round(w / 600)); for (let i = 1; i < n; i++) out.push(L([-hw + w * i / n, -hd], [-hw + w * i / n, hd])); out.push(L([-hw, -hd], [hw, hd])); break; }
    case 'desk': out.push(...chair(0, -hd - 300, 0)); break;
    case 'bookshelf': for (let i = 1; i < 4; i++) out.push(L([-hw + w * i / 4, -hd], [-hw + w * i / 4, hd])); break;
    case 'toilet': out.push(R(-hw, hd - 180, hw, hd), { ellipse: [0, -hd * 0.25, hw * 0.85, hd * 0.6] }); break;
    case 'vanity': out.push({ ellipse: [0, -20, hw * 0.55, hd * 0.55] }); break;
    case 'bath': out.push({ rrect: [-hw + 80, -hd + 80, hw - 80, hd - 80, 220] }, C(hw - 260, 0, 40)); break;
    case 'shower': out.push(L([-hw, -hd], [hw, hd]), L([hw, -hd], [-hw, hd]), C(0, 0, 50)); break;
    case 'washer': out.push(C(0, -20, Math.min(hw, hd) * 0.7)); break;
    case 'counter': out.push(R(-hw * 0.4, -hd + 100, hw * 0.1, hd - 100)); break;
    case 'stair': { const n = Math.max(2, Math.round(el.h / 180)); for (let i = 1; i < n; i++) out.push(L([-hw, -hd + d * i / n], [hw, -hd + d * i / n])); out.push(L([0, -hd + 150], [0, hd - 200]), { poly: [[-120, hd - 450], [0, hd - 200], [120, hd - 450]] }, L([-hw, hd * 0.2], [hw, hd * 0.25])); break; }
    case 'rail': out.push(L([-hw, 0], [hw, 0])); break;
    case 'car': out.push({ rrect: [-hw, -hd, hw, hd, 350] }, R(-hw + 150, -hd + 1300, hw - 150, -hd + 1900), R(-hw + 150, hd - 1500, hw - 150, hd - 1000)); out.shift(); break;
    case 'tree': { out.shift(); const r = Math.min(hw, hd); out.push(C(0, 0, r), C(0, 0, r * 0.08)); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, b = a + 0.3; out.push({ poly: [[Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1], [Math.cos(b) * r * 0.85, Math.sin(b) * r * 0.85]] }); } break; }
    case 'shrub': { out.shift(); const r = Math.min(hw, hd); out.push(C(0, 0, r)); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; out.push(C(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.35)); } break; }
    case 'deck': { const n = Math.max(2, Math.round(d / 150)); for (let i = 1; i < n; i += 2) out.push(L([-hw, -hd + d * i / n], [hw, -hd + d * i / n])); break; }
    case 'paving': { for (let x = -hw + 600; x < hw; x += 600) out.push(L([x, -hd], [x, hd])); break; }
    case 'floor': break;
    case 'fence': { for (let x = -hw; x <= hw; x += 2000) out.push(R(x - 50, -hd - 30, x + 50, hd + 30)); break; }
    case 'outdoor': out.shift(); out.push(C(0, 0, hw * 0.45)); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; out.push(C(Math.cos(a) * hw * 0.75, Math.sin(a) * hw * 0.75, 200)); } break;
    case 'stair_u': { const fw = (w - 100) / 2, n = Math.max(4, Math.round(el.h / 180 / 2)), land = 1200, run = d - land; for (let i = 1; i < n; i++) { const y = -hd + run * i / n; out.push(L([-hw, y], [-hw + fw, y]), L([hw - fw, y], [hw, y])); } out.push(L([-50, -hd], [-50, hd - land]), L([50, -hd], [50, hd - land]), L([-hw, hd - land], [hw, hd - land]), L([-hw + fw / 2, -hd + 200], [-hw + fw / 2, hd - land - 100]), { poly: [[-hw + fw / 2 - 120, hd - land - 350], [-hw + fw / 2, hd - land - 100], [-hw + fw / 2 + 120, hd - land - 350]] }); break; }
    case 'elevator': out.push(L([-hw, -hd], [hw, hd]), L([hw, -hd], [-hw, hd])); break;
    case 'workstation': out.push(L([-hw, 0], [hw, 0]), L([0, -hd], [0, hd]), ...chair(-hw / 2, -hd - 250, 0), ...chair(hw / 2, -hd - 250, 0), ...chair(-hw / 2, hd + 250, Math.PI), ...chair(hw / 2, hd + 250, Math.PI)); break;
    case 'meeting': for (let i = 0; i < 4; i++) { const x = -hw + w * (i + 0.5) / 4; out.push(...chair(x, -hd - 280, 0), ...chair(x, hd + 280, Math.PI)); } break;
    case 'reception': out.push(R(-hw, -hd, hw, -hd + 250)); break;
    case 'ahu': case 'chiller': case 'tr': case 'swgr': case 'gen': case 'panel': case 'tank': case 'pump': case 'vav': case 'louver': case 'grille': case 'pit': out.push(L([-hw, -hd], [hw, hd]), L([hw, -hd], [-hw, hd]), R(-hw * 0.6, -hd * 0.6, hw * 0.6, hd * 0.6)); break;
    case 'ctower': case 'fan': out.push(C(0, 0, Math.min(hw, hd) * 0.8), C(0, 0, Math.min(hw, hd) * 0.2)); break;
    case 'plant': out.shift(); out.push(C(0, 0, hw), C(0, 0, hw * 0.5)); break;
    case 'coffee': out.push(R(-hw + 40, -hd + 40, hw - 40, hd - 40)); break;
    case 'rug': out.push(R(-hw + 100, -hd + 100, hw - 100, hd - 100)); break;
  }
  return out;
}
// 로컬 → 평면 좌표
export function furnXf(el) { const a = (el.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return (q) => [el.p[0] + q[0] * c - q[1] * s, el.p[1] + q[0] * s + q[1] * c]; }
