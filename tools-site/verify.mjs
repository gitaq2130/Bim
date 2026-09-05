/* 각 도구의 계산 로직을 브라우저 없이 재현해 검증한다. */
let pass=0, fail=0;
function eq(label, got, want){
  const ok = got===want;
  console.log((ok?"  PASS  ":"  FAIL  ")+label+"  got="+got+" want="+want);
  ok?pass++:fail++;
}

/* --- 부가세 --- */
function vatFromSupply(v,r){ const s=Math.floor(v), t=Math.floor(s*r); return {supply:s,vat:t,total:s+t}; }
function vatFromTotal(v,r){ const t=Math.floor(v), s=Math.floor(Number((t/(1+r)).toFixed(6))); return {supply:s,vat:t-s,total:t}; }
let a=vatFromSupply(1000000,0.1);
eq("부가세 공급가액 100만 → 합계", a.total, 1100000);
eq("부가세 공급가액 100만 → 세액", a.vat, 100000);
let b=vatFromTotal(1100000,0.1);
eq("부가세 합계 110만 → 공급가액", b.supply, 1000000);
eq("부가세 합계 110만 → 세액(합계×0.1 아님)", b.vat, 100000);
let c=vatFromTotal(1100001,0.1);
eq("합계 1,100,001 → 공급가액(버림 유지)", c.supply, 1000000);
let e2=vatFromTotal(3300000,0.1);
eq("합계 330만 → 공급가액", e2.supply, 3000000);
let z=vatFromSupply(1000000,0);
eq("영세율 합계", z.total, 1000000);

/* --- 평 변환 --- */
const RATIO=400/121;
eq("84㎡ → 평", (84/RATIO).toFixed(2), "25.41");
eq("25.41평 → ㎡", (25.41*RATIO).toFixed(2), "84.00");
eq("1평 → ㎡", RATIO.toFixed(6), "3.305785");

/* --- 공사기간 --- */
function days(sv,ev,incl){
  const A=new Date(sv+"T00:00:00"), B=new Date(ev+"T00:00:00"), MS=86400000;
  const diff=Math.round((B-A)/MS);
  const total=diff+(incl?1:0);
  let work=0, cur=new Date(A), last=new Date(B);
  if(!incl) last.setDate(last.getDate()-1);
  while(cur<=last){ const w=cur.getDay(); if(w!==0&&w!==6) work++; cur.setDate(cur.getDate()+1); }
  return {total, work};
}
let d1=days("2027-02-01","2027-04-30",true);
eq("2027-02-01~04-30 양끝포함 일수", d1.total, 89);   // 28+31+30
let d2=days("2027-02-01","2027-04-30",false);
eq("동일구간 차이만", d2.total, 88);
let d3=days("2026-09-07","2026-09-11",true);          // 월~금
eq("월~금 5일 양끝포함", d3.total, 5);
eq("월~금 근무일", d3.work, 5);
let d4=days("2026-09-05","2026-09-06",true);          // 토~일
eq("토~일 근무일 0", d4.work, 0);

/* --- 지체상금 --- */
function penalty(A,R,D){ return Math.floor(A*R*D); }
eq("10억 × 0.05% × 15일", penalty(1000000000,0.0005,15), 7500000);
eq("지체 0일", penalty(1000000000,0.0005,0), 0);

/* --- 직접출석 --- */
function quorum(total,direct,need){
  const required=Math.ceil(total*need/100);
  return {required, ok:direct>=required, pct:+((direct/total)*100).toFixed(1)};
}
let q1=quorum(486,62,10);
eq("486명 10% 필요인원", q1.required, 49);
eq("직접출석 62명 충족", q1.ok, true);
eq("비율", q1.pct, 12.8);
let q2=quorum(486,62,20);
eq("486명 20% 필요인원", q2.required, 98);
eq("62명이면 미달", q2.ok, false);
let q3=quorum(100,10,10);
eq("정확히 10%면 충족", q3.ok, true);

/* --- 하도급률 --- */
eq("하도급률", ((905520000/1097204046)*100).toFixed(1), "82.5");

/* --- 배치기준 구간 --- */
const TIERS=[
 {min:70000000000,label:"기술사"},{min:50000000000,label:"특급기술인 이상"},
 {min:30000000000,label:"특급기술인 이상"},{min:10000000000,label:"고급기술인 이상"},
 {min:3000000000,label:"중급기술인 이상"},{min:0,label:"초급기술인 이상"}];
function grade(v){ let i=TIERS.findIndex(t=>v>=t.min); if(i<0)i=TIERS.length-1; return TIERS[i].label; }
eq("9억", grade(905520000), "초급기술인 이상");
eq("30억 경계", grade(3000000000), "중급기술인 이상");
eq("29.99억", grade(2999999999), "초급기술인 이상");
eq("100억 경계", grade(10000000000), "고급기술인 이상");
eq("700억", grade(70000000000), "기술사");

/* --- 설계변경 증감률 --- */
function change(B,A){ const d=A-B; return {diff:d, rate:+((d/B)*100).toFixed(2),
  sign: d>0?"+":(d<0?"△":"")}; }
let ch=change(1097204046,1160204046);
eq("설계변경 증감액", ch.diff, 63000000);
eq("설계변경 부호", ch.sign, "+");
let ch2=change(1000000000,900000000);
eq("감액 부호 △", ch2.sign, "△");
eq("감액 증감률", ch2.rate, -10);

/* --- 기성금 --- */
function claim(C,R,P,ADV,AR){
  const cum=Math.floor(C*R), settle=Math.floor(ADV*AR);
  return {cum, settle, claim: cum-P-settle};
}
let pc=claim(1000000000,0.425,300000000,100000000,0.425);
eq("누계 기성금액", pc.cum, 425000000);
eq("선금 정산액", pc.settle, 42500000);
eq("이번 청구액", pc.claim, 82500000);

/* --- 면적 안분 --- */
function share(T,TA,MA){ return Math.floor(T*(MA/TA)); }
eq("면적 안분 100만/1000㎡ 중 100㎡", share(1000000,1000,100), 100000);
eq("안분 0면적", share(1000000,1000,0), 0);

/* --- 금액 한글 --- */
const DIGITS=["","일","이","삼","사","오","육","칠","팔","구"];
const SMALL=["","십","백","천"], BIG=["","만","억","조","경"];
function fourDigits(n,keepOne){
  let out="", s=String(n).padStart(4,"0");
  for(let i=0;i<4;i++){
    const d=Number(s[i]), unit=SMALL[3-i];
    if(d===0) continue;
    if(d===1 && unit && !keepOne) out+=unit; else out+=DIGITS[d]+unit;
  }
  return out;
}
function toHangul(n,keepOne){
  n=Math.floor(n); if(n===0) return "영";
  const g=[]; while(n>0){ g.push(n%10000); n=Math.floor(n/10000); }
  const parts=[];
  for(let i=g.length-1;i>=0;i--){
    if(g[i]===0) continue;
    let head=fourDigits(g[i],keepOne);
    if(!keepOne && g[i]===1 && i===1) head="";
    parts.push(head+BIG[i]);
  }
  return parts.join("");
}
eq("한글 0", toHangul(0,true), "영");
eq("한글 15 계약서", toHangul(15,true), "일십오");
eq("한글 15 관행", toHangul(15,false), "십오");
eq("한글 115 계약서", toHangul(115,true), "일백일십오");
eq("한글 115 관행", toHangul(115,false), "백십오");
eq("한글 1억", toHangul(100000000,true), "일억");
eq("한글 1만", toHangul(10000,true), "일만");
eq("한글 1만 관행", toHangul(10000,false), "만");
eq("한글 10203", toHangul(10203,true), "일만이백삼");
eq("한글 1097204046", toHangul(1097204046,true), "일십억구천칠백이십만사천사십육");
eq("한글 1000000", toHangul(1000000,true), "일백만");
eq("한글 20000000", toHangul(20000000,true), "이천만");
eq("한글 1억 관행(일억 유지)", toHangul(100000000,false), "일억");
eq("한글 12000 관행", toHangul(12000,false), "만이천");
eq("한글 10001 관행", toHangul(10001,false), "만일");

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
