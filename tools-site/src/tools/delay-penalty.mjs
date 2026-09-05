export default {
  slug: "지체상금-계산기",
  title: "지체상금 계산기 | 계약금액 지체일수 요율",
  description: "계약금액, 지체일수, 지체상금률을 넣으면 지체상금을 계산합니다. 계약금액 대비 비율도 함께 보여줍니다.",
  h1: "지체상금",
  lede: "계약서에 정한 요율을 넣으면 금액이 나옵니다. 계약금액 대비 몇 %인지도 같이 봅니다.",
  indexLabel: "지체상금",
  indexDesc: "계약금액 · 지체일수 → 금액",
  body: `
<section class="tool">
  <div class="body">
    <div class="field">
      <label for="amt">계약금액 (원)</label>
      <input type="number" id="amt" inputmode="numeric" value="1097204046" min="0" step="1000000">
      <span class="hint" id="krwLabel"></span>
    </div>
    <div class="row2">
      <div class="field">
        <label for="days">지체일수</label>
        <input type="number" id="days" inputmode="numeric" value="15" min="0" step="1">
      </div>
      <div class="field">
        <label for="rate">지체상금률 (1일당, %)</label>
        <input type="number" id="rate" inputmode="decimal" value="0.05" min="0" step="0.001">
      </div>
    </div>
    <span class="hint">요율은 계약서에 정한 값을 그대로 넣으십시오. 계약 종류마다 다릅니다.</span>
  </div>
  <div class="out" id="out">
    <div class="big" id="penalty">—</div>
    <div class="sub" id="detail"></div>
  </div>
  <div class="basis"><b>계산</b> 계약금액 × 지체상금률 × 지체일수. 요율·기산일·상한은 계약서와 관계 법령에 따르므로 반드시 계약 조건을 확인할 것</div>
</section>

<div class="explain">
  <h2>요율을 직접 넣는 이유</h2>
  <p>지체상금률은 계약의 종류와 근거 규정에 따라 다르고 개정되기도 합니다. 이 계산기는 특정 요율을 가정하지 않고 계약서에 적힌 값을 그대로 받습니다. 계약서의 지체상금 조항을 그대로 옮겨 넣으십시오.</p>
  <h2>상한과 공제</h2>
  <p>계약에 따라 지체상금에 상한이 있거나, 기성 부분·불가항력 기간을 공제하는 규정이 있습니다. 이 계산기는 그런 조정을 하지 않은 단순 곱셈 결과이므로, 실제 청구·정산 금액과 다를 수 있습니다.</p>
</div>`,
  script: `
var amt=$("amt"), days=$("days"), rate=$("rate");
function calc(){
  var A=Number(amt.value), D=Number(days.value), R=Number(rate.value)/100;
  $("krwLabel").textContent=krw(A);
  var out=$("out"), p=$("penalty"), det=$("detail");
  out.className="out";
  if(!isFinite(A)||A<0||!isFinite(D)||D<0||!isFinite(R)||R<0){
    p.textContent="—"; det.textContent="값을 확인하세요."; return; }
  var v=Math.floor(A*R*D);
  p.textContent=nf.format(v)+"원";
  var pct=A>0?(v/A*100):0;
  det.textContent=krw(v)+"  ·  계약금액의 "+pct.toFixed(2)+"%";
  if(pct>=10){ out.className="out is-warn";
    det.textContent+="  —  계약상 상한 여부를 확인하십시오."; }
}
[amt,days,rate].forEach(function(el){el.addEventListener("input",calc);}); calc();
`,
};
