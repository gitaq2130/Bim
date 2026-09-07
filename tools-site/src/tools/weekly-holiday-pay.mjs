export default {
  slug: "주휴수당-계산기",
  title: "주휴수당 계산기 | 주 15시간 기준·월 환산 시간",
  description: "1주 소정근로시간과 시급으로 주휴수당을 계산합니다. 주 15시간 요건, 월 환산 209시간의 근거, 2026년 최저임금 미달 여부까지 확인합니다.",
  h1: "주휴수당 계산",
  lede: "주 15시간을 넘기면 유급휴일이 생깁니다. 단시간 근로자는 시간에 비례해서 붙습니다.",
  indexLabel: "주휴수당",
  group: "노무",
  indexDesc: "주 15시간 요건 · 월 환산 시간",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="hours">1주 소정근로시간</label>
        <input type="number" id="hours" inputmode="decimal" value="40" min="0" max="68" step="0.5">
        <span class="hint">실제 일한 시간이 아니라 <b>계약상 정한 시간</b>입니다. 연장근로는 뺍니다.</span>
      </div>
      <div class="field">
        <label for="wage">시급 (원)</label>
        <input type="number" id="wage" inputmode="numeric" value="10320" min="0" step="10">
        <span class="hint">2026년 최저임금은 10,320원입니다.</span>
      </div>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="result">—</div>
    <div class="sub" id="detail"></div>
    <div class="sub" id="monthly"></div>
    <div class="sub" id="minwage"></div>
  </div>
  <div class="basis"><b>근거</b> 근로기준법 제55조 제1항(1주 평균 1회 이상의 유급휴일), 같은 법 시행령 제30조 제1항(1주 소정근로일 개근), 제18조 제3호(4주 평균 1주 15시간 미만 근로자 적용 제외) · 2026년 적용 최저임금 고시(시간급 10,320원)</div>
</section>

<div class="explain">
  <h2>단시간 근로자의 주휴시간</h2>
  <p>주 40시간을 채우지 못하는 근로자는 주휴수당이 없는 것이 아니라 <b>시간에 비례해서</b> 붙습니다. 계산식은 (1주 소정근로시간 ÷ 40) × 8시간입니다. 주 20시간이면 4시간분, 주 30시간이면 6시간분이 유급으로 처리됩니다. 주 40시간을 넘겨도 주휴시간은 8시간이 상한입니다.</p>
  <h2>주 15시간이 갈림길입니다</h2>
  <p>4주를 평균했을 때 1주 소정근로시간이 15시간 미만이면 주휴일 규정 자체가 적용되지 않습니다. 주휴수당도, 연차휴가도, 퇴직금도 여기서 갈립니다. 주 14시간과 주 15시간의 차이가 시급 한 시간어치가 아닌 이유입니다.</p>
  <h2>209시간은 어디서 나온 숫자인가</h2>
  <p>주 40시간 근로자의 1주 유급시간은 소정근로 40시간에 주휴 8시간을 더한 48시간입니다. 이것을 월로 환산하면 48 × 365 ÷ 12 ÷ 7 = 208.57시간이고, 관행상 209시간으로 씁니다. 월급제 근로자의 통상시급을 구할 때 월급을 209로 나누는 근거가 이것입니다.</p>
  <h2>개근이 조건입니다</h2>
  <p>주휴일은 소정근로일을 개근한 주에 대해 유급으로 부여합니다. 결근한 주는 주휴수당이 발생하지 않습니다. 다만 지각·조퇴는 결근이 아니며, 연차휴가를 쓴 날은 출근한 것으로 봅니다.</p>
</div>`,
  script: `
var MIN_WAGE=10320;
function calc(){
  var h=Number($("hours").value), w=Number($("wage").value);
  var out=$("out"), res=$("result");
  out.className="out";
  if(!isFinite(h)||h<0||!isFinite(w)||w<0){ res.textContent="—"; $("detail").textContent=""; $("monthly").textContent=""; $("minwage").textContent=""; return; }
  if(h<15){
    out.className="out is-warn";
    res.textContent="발생하지 않음";
    $("detail").textContent="1주 소정근로시간 "+h+"시간 — 15시간 미만이면 주휴일 규정이 적용되지 않습니다.";
    $("monthly").textContent="연차휴가·퇴직금도 같은 기준으로 갈립니다.";
    $("minwage").textContent="";
    return;
  }
  var holidayHours=Math.min(h,40)/40*8;
  var pay=Math.floor(holidayHours*w);
  var weekPaid=h+holidayHours;
  var monthHours=weekPaid*365/12/7;
  res.textContent=nf.format(pay)+"원 / 주";
  $("detail").textContent="주휴시간 "+(+holidayHours.toFixed(2))+"시간 × 시급 "+nf.format(w)+"원";
  $("monthly").textContent="월 환산 유급시간 "+Math.round(monthHours)+"시간(="+(+monthHours.toFixed(2))+")  ·  월 임금 "+nf.format(Math.floor(Math.round(monthHours)*w))+"원";
  if(w<MIN_WAGE){
    out.className="out is-warn";
    $("minwage").textContent="시급이 2026년 최저임금 "+nf.format(MIN_WAGE)+"원에 "+nf.format(MIN_WAGE-w)+"원 미달합니다.";
  } else {
    $("minwage").textContent="";
  }
}
["hours","wage"].forEach(function(id){ $(id).addEventListener("input",calc); });
calc();
`,
};
