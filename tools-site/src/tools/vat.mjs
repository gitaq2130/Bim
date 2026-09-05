export default {
  slug: "부가세-계산기",
  title: "부가세 계산기 | 공급가액·부가세·합계액 역산",
  description: "공급가액에서 합계액을, 합계액에서 공급가액을 양방향으로 계산합니다. 세금계산서 금액 맞출 때 쓰는 계산.",
  h1: "부가세 계산",
  lede: "어느 쪽 금액을 알든 나머지가 나옵니다. 합계액에서 거꾸로 뽑는 계산도 됩니다.",
  indexLabel: "부가세 계산",
  indexDesc: "공급가액 ↔ 합계액 양방향",
  body: `
<section class="tool">
  <div class="body">
    <div class="field">
      <label for="mode">입력 기준</label>
      <select id="mode">
        <option value="supply">공급가액을 안다 (부가세 별도 금액)</option>
        <option value="total">합계액을 안다 (부가세 포함 금액)</option>
      </select>
    </div>
    <div class="field">
      <label for="amt" id="amtLabel">공급가액 (원)</label>
      <input type="number" id="amt" inputmode="numeric" value="1000000" min="0" step="1000">
      <span class="hint" id="krwLabel"></span>
    </div>
    <div class="field">
      <label for="rate">세율 (%)</label>
      <input type="number" id="rate" inputmode="decimal" value="10" min="0" step="0.1">
      <span class="hint">일반적인 부가가치세율은 10%입니다. 영세율이면 0을 넣으세요.</span>
    </div>
  </div>
  <div class="out">
    <div class="big" id="total">—</div>
    <div class="sub" id="breakdown"></div>
  </div>
  <div class="basis"><b>계산</b> 합계액 = 공급가액 × (1 + 세율), 공급가액 = 합계액 ÷ (1 + 세율). 원 단위 미만은 버림</div>
</section>

<div class="explain">
  <h2>합계액에서 역산할 때 흔한 실수</h2>
  <p>합계액에 0.1을 곱하면 부가세가 나오지 않습니다. 합계액은 이미 110%이므로 11로 나누어야 부가세가 됩니다. 예를 들어 합계 1,100,000원이면 부가세는 110,000원이 아니라 100,000원입니다.</p>
  <h2>단수 처리</h2>
  <p>이 계산기는 원 단위 미만을 버립니다. 실제 세금계산서는 거래처·시스템마다 반올림 규칙이 다를 수 있으므로 상대방 계산서와 1원 차이가 나면 그 규칙을 확인하십시오.</p>
</div>`,
  script: `
var mode=$("mode"), amt=$("amt"), rate=$("rate");
function calc(){
  var isSupply = mode.value==="supply";
  $("amtLabel").textContent = isSupply ? "공급가액 (원)" : "합계액 (원)";
  var v=Number(amt.value), r=Number(rate.value)/100;
  $("krwLabel").textContent = krw(v);
  if(!isFinite(v)||v<0||!isFinite(r)||r<0){ $("total").textContent="—"; $("breakdown").textContent=""; return; }
  var supply, vat, total;
  if(isSupply){ supply=Math.floor(v); vat=Math.floor(supply*r); total=supply+vat; }
  else {
    total=Math.floor(v);
    /* total/(1+r) 은 1100000/1.1 = 999999.9999... 처럼 부동소수점 오차가 생긴다.
       그대로 버림하면 1원이 어긋나므로 유효자리로 정리한 뒤 버림한다. */
    supply=Math.floor(Number((total/(1+r)).toFixed(6)));
    vat=total-supply;
  }
  $("total").textContent = nf.format(total)+"원";
  $("breakdown").textContent = "공급가액 "+nf.format(supply)+"원  ·  부가세 "+nf.format(vat)+"원";
}
[mode,amt,rate].forEach(function(el){el.addEventListener("input",calc);});
mode.addEventListener("change",calc); calc();
`,
};
