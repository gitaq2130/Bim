export default {
  slug: "면적-안분-계산기",
  title: "면적 안분 계산기 | 공용 비용 세대별 부담액",
  description: "총 비용과 총 면적, 우리 세대 면적을 넣으면 면적 비율에 따른 부담액을 계산합니다. 관리비·공사비 안분에 씁니다.",
  h1: "면적 안분",
  lede: "총액을 면적 비율로 나눕니다. 우리 몫이 얼마인지 바로 나옵니다.",
  indexLabel: "면적 안분",
  indexDesc: "총액 · 면적 → 세대 부담액",
  body: `
<section class="tool">
  <div class="body">
    <div class="field">
      <label for="total">안분할 총 금액 (원)</label>
      <input type="number" id="total" inputmode="numeric" value="48000000" min="0" step="10000">
      <span class="hint" id="krwLabel"></span>
    </div>
    <div class="row2">
      <div class="field">
        <label for="totalArea">총 면적 (㎡)</label>
        <input type="number" id="totalArea" inputmode="decimal" value="24500" min="0" step="0.01">
      </div>
      <div class="field">
        <label for="myArea">해당 세대 면적 (㎡)</label>
        <input type="number" id="myArea" inputmode="decimal" value="84.96" min="0" step="0.01">
      </div>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="share">—</div>
    <div class="sub" id="detail"></div>
  </div>
  <div class="basis"><b>계산</b> 부담액 = 총 금액 × (해당 면적 ÷ 총 면적). 원 단위 미만은 버림</div>
</section>

<div class="explain">
  <h2>어떤 면적을 쓰나</h2>
  <p>관리규약이나 계약에서 정한 기준 면적을 씁니다. 전용면적으로 나누는 경우와 공급면적으로 나누는 경우가 있고, 어느 쪽을 쓰느냐에 따라 부담액이 달라집니다. 총 면적과 개별 면적은 반드시 같은 기준이어야 합니다.</p>
  <h2>단수 처리</h2>
  <p>세대별로 버림하면 합계가 총액보다 조금 모자랍니다. 실무에서는 그 차액을 특정 세대나 관리주체가 흡수하도록 규약에 정해두는 경우가 많습니다.</p>
</div>`,
  script: `
var t=$("total"), ta=$("totalArea"), ma=$("myArea");
function calc(){
  var T=Number(t.value), TA=Number(ta.value), MA=Number(ma.value);
  $("krwLabel").textContent=krw(T);
  var out=$("out"), s=$("share"), det=$("detail");
  out.className="out";
  if(!isFinite(TA)||TA<=0){ s.textContent="—"; det.textContent="총 면적을 입력하세요."; return; }
  if(MA>TA){ out.className="out is-warn"; s.textContent="입력 오류";
    det.textContent="세대 면적이 총 면적보다 큽니다."; return; }
  var ratio=MA/TA, v=Math.floor(T*ratio);
  s.textContent=nf.format(v)+"원";
  det.textContent="지분율 "+(ratio*100).toFixed(4)+"%  ·  ㎡당 "+nf.format(Math.floor(T/TA))+"원";
}
[t,ta,ma].forEach(function(el){el.addEventListener("input",calc);}); calc();
`,
};
