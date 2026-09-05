export default {
  slug: "기성금-청구액-계산기",
  title: "기성금 청구액 계산기 | 기성률 선금정산 공제",
  description: "계약금액과 기성률을 넣으면 기성금액을 계산하고, 선금 정산분과 기수령액을 공제해 이번 청구액을 뽑습니다.",
  h1: "기성금 청구액",
  lede: "기성률에서 이번에 실제로 청구할 금액까지 한 번에 나옵니다.",
  indexLabel: "기성금 청구액",
  indexDesc: "기성률 · 선금정산 → 청구액",
  body: `
<section class="tool">
  <div class="body">
    <div class="field">
      <label for="contract">계약금액 (원)</label>
      <input type="number" id="contract" inputmode="numeric" value="1097204046" min="0" step="1000000">
      <span class="hint" id="krwLabel"></span>
    </div>
    <div class="row2">
      <div class="field">
        <label for="rate">누계 기성률 (%)</label>
        <input type="number" id="rate" inputmode="decimal" value="42.5" min="0" max="100" step="0.1">
      </div>
      <div class="field">
        <label for="paid">기수령액 (원)</label>
        <input type="number" id="paid" inputmode="numeric" value="300000000" min="0" step="1000000">
      </div>
    </div>
    <div class="row2">
      <div class="field">
        <label for="advance">선금 수령액 (원)</label>
        <input type="number" id="advance" inputmode="numeric" value="100000000" min="0" step="1000000">
      </div>
      <div class="field">
        <label for="advRate">선금 정산률 (%)</label>
        <input type="number" id="advRate" inputmode="decimal" value="42.5" min="0" max="100" step="0.1">
      </div>
    </div>
    <span class="hint">선금 정산률은 통상 기성률에 맞춰 정산합니다. 계약 조건에 따라 다르므로 계약서를 확인하십시오.</span>
  </div>
  <div class="out" id="out">
    <div class="big" id="claim">—</div>
    <div class="sub" id="detail"></div>
  </div>
  <div class="basis"><b>계산</b> 누계 기성금액 = 계약금액 × 기성률. 이번 청구액 = 누계 기성금액 − 기수령액 − 선금 정산액</div>
</section>

<div class="explain">
  <h2>선금은 왜 빼나</h2>
  <p>선금은 이미 받은 돈이므로 기성금을 지급받을 때 정해진 비율만큼 정산(공제)합니다. 통상 기성률에 비례해 정산하지만, 계약에 따라 정산 시점과 비율이 다를 수 있습니다.</p>
  <h2>이 계산기가 하지 않는 것</h2>
  <p>하자보수보증금 예치, 지체상금 상계, 부가가치세, 유보금 등은 반영하지 않았습니다. 실제 청구서에는 계약 조건에 따라 추가 공제·가산 항목이 붙습니다.</p>
</div>`,
  script: `
var c=$("contract"), r=$("rate"), p=$("paid"), adv=$("advance"), ar=$("advRate");
function calc(){
  var C=Number(c.value), R=Number(r.value)/100, P=Number(p.value);
  var ADV=Number(adv.value), AR=Number(ar.value)/100;
  $("krwLabel").textContent=krw(C);
  var out=$("out"), cl=$("claim"), det=$("detail");
  out.className="out";
  if(!isFinite(C)||C<=0){ cl.textContent="—"; det.textContent="계약금액을 입력하세요."; return; }
  var cumulative=Math.floor(C*R);
  var advSettle=Math.floor(ADV*AR);
  var claim=cumulative-P-advSettle;
  cl.textContent=nf.format(claim)+"원";
  det.textContent="누계 기성 "+nf.format(cumulative)+"원  −  기수령 "+nf.format(P)
    +"원  −  선금정산 "+nf.format(advSettle)+"원";
  if(claim<0){ out.className="out is-warn";
    det.textContent+="   —  공제액이 기성금액을 넘습니다. 입력값을 확인하세요."; }
}
[c,r,p,adv,ar].forEach(function(el){el.addEventListener("input",calc);}); calc();
`,
};
