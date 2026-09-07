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
/* 별표5 원문 대조 완료(2026-09-05). 두 독립 출처 일치. */
const TIERS=[
 {min:70000000000,label:"기술사"},
 {min:50000000000,label:"기술사 또는 기능장"},
 {min:30000000000,label:"기술사 또는 기능장"},
 {min:10000000000,label:"기술사·기능장 또는 특급기술인"},
 {min:3000000000,label:"고급기술인 이상"},
 {min:0,label:"중급기술인 이상"}];
function grade(v){ let i=TIERS.findIndex(t=>v>=t.min); if(i<0)i=TIERS.length-1; return TIERS[i].label; }
eq("9억", grade(905520000), "중급기술인 이상");
eq("30억 경계", grade(3000000000), "고급기술인 이상");
eq("29.99억", grade(2999999999), "중급기술인 이상");
eq("100억 경계", grade(10000000000), "기술사·기능장 또는 특급기술인");
eq("500억 경계", grade(50000000000), "기술사 또는 기능장");
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

/* --- 일용직 소득세 --- */
function dayTax(pay){
  const basis=Math.max(0,pay-150000);
  const raw=Number((basis*0.06*(1-0.55)).toFixed(6));   // (1-0.55) 부동소수점 오차를 유효자리로 정리
  let income=Math.floor(raw);
  if(income<1000) income=0;
  const local=Math.floor(income*0.1);
  return {income, local, total:income+local};
}
eq("일용 일당 20만 소득세", dayTax(200000).income, 1350);
eq("일용 일당 20만 지방세", dayTax(200000).local, 135);
eq("일용 일당 20만 합계", dayTax(200000).total, 1485);
eq("일용 일당 18만 소액부징수", dayTax(180000).total, 0);
eq("일용 187,037원 경계 아래", dayTax(187037).income, 0);
eq("일용 187,038원 경계 위", dayTax(187038).income, 1000);
eq("일용 일당 15만 공제 후 0", dayTax(150000).total, 0);
eq("일용 일당 10만(공제 초과)", dayTax(100000).total, 0);

/* --- 주휴수당 --- */
function weekly(h,w){
  if(h<15) return {ok:false, pay:0, holidayHours:0, monthHours:0};
  const holidayHours=Math.min(h,40)/40*8;
  const monthHours=(h+holidayHours)*365/12/7;
  return {ok:true, pay:Math.floor(holidayHours*w), holidayHours, monthHours:Math.round(monthHours)};
}
eq("주휴 주40시간 시급10320", weekly(40,10320).pay, 82560);
eq("주휴 주40시간 월환산시간", weekly(40,10320).monthHours, 209);
eq("주휴 209시간 × 최저임금 = 고시 월환산액", 209*10320, 2156880);
eq("주휴 주20시간 비례", weekly(20,10320).holidayHours, 4);
eq("주휴 주15시간 발생", weekly(15,10000).holidayHours, 3);
eq("주휴 주14시간 미발생", weekly(14,10000).ok, false);
eq("주휴 주48시간 상한 8시간", weekly(48,10000).holidayHours, 8);

/* --- 연장·야간·휴일 가산 --- */
function overtime(w,ot,nt,hl,small){
  const hol8=Math.min(hl,8), holOver=Math.max(hl-8,0);
  const rOT=small?1:1.5, rH8=small?1:1.5, rHO=small?1:2, rN=small?0:0.5;
  return Math.floor(ot*w*rOT + hol8*w*rH8 + holOver*w*rHO + nt*w*rN);
}
eq("연장 10h 시급1만", overtime(10000,10,0,0,false), 150000);
eq("휴일 10h (8h 1.5배 + 2h 2배)", overtime(10000,0,0,10,false), 160000);
eq("야간 겹친 연장 10h = 2배", overtime(10000,10,10,0,false), 200000);
eq("5인미만 연장 10h 가산없음", overtime(10000,10,0,0,true), 100000);
eq("5인미만 야간 가산없음", overtime(10000,0,10,0,true), 0);
eq("휴일 8h 정확히", overtime(10000,0,0,8,false), 120000);

/* --- 퇴직금 --- */
const MS=86400000;
function minusMonths(dt,m){
  const t=new Date(dt.getFullYear(), dt.getMonth()-m, 1);
  const last=new Date(t.getFullYear(), t.getMonth()+1, 0).getDate();
  t.setDate(Math.min(dt.getDate(), last));
  return t;
}
function isoOf(dt){
  return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");
}
function severance(joinISO, quitISO, wage3, bonus, annual, ordinary){
  const J=new Date(joinISO+"T00:00:00"), Q=new Date(quitISO+"T00:00:00");
  const start=minusMonths(Q,3);
  const periodDays=Math.round((Q-start)/MS);
  const served=Math.round((Q-J)/MS);
  const avg=(wage3 + bonus*3/12 + annual*3/12)/periodDays;
  const daily=Math.max(avg, ordinary||0);
  return {periodDays, served, avg, daily, pay: served<365 ? 0 : Math.floor(daily*30*(served/365))};
}
eq("평균임금 산정기간 말일 보정(5/31-3개월)", isoOf(minusMonths(new Date("2026-05-31T00:00:00"),3)), "2026-02-28");
eq("평균임금 산정기간 일수(9/1 기준)", severance("2023-03-02","2026-09-01",10500000,0,0,0).periodDays, 92);
let sv=severance("2023-03-02","2026-09-01",10500000,4000000,600000,0);
eq("퇴직금 재직일수", sv.served, 1279);
eq("퇴직금 1일 평균임금(반올림)", Math.round(sv.avg), 126630);   // (10,500,000 + 상여 1,000,000 + 연차 150,000) ÷ 92일
eq("퇴직금 금액", sv.pay, 13311807);
eq("상여·연차 반영 시 평균임금이 커진다", sv.avg > severance("2023-03-02","2026-09-01",10500000,0,0,0).avg, true);
eq("1년 미만은 0", severance("2026-01-01","2026-06-01",6000000,0,0,0).pay, 0);
let sv2=severance("2023-03-02","2026-09-01",10500000,0,0,200000);
eq("통상임금이 크면 통상임금 채택", sv2.daily, 200000);

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
