export default {
  slug: "일용직-소득세-계산기",
  title: "일용직 소득세 계산기 | 원천징수세액·소액부징수 기준",
  description: "일당에서 원천징수할 소득세와 지방소득세를 계산합니다. 1일 15만원 근로소득공제, 55% 세액공제, 1,000원 미만 소액부징수를 반영합니다.",
  h1: "일용직 소득세 계산",
  lede: "일당 187,037원까지는 뗄 세금이 없습니다. 소액부징수 때문입니다.",
  indexLabel: "일용직 소득세",
  group: "세무·금액",
  indexDesc: "원천징수세액 · 소액부징수",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="pay">1일 일당 (원)</label>
        <input type="number" id="pay" inputmode="numeric" value="200000" min="0" step="1000">
        <span class="hint" id="krwLabel"></span>
      </div>
      <div class="field">
        <label for="days">근무일수</label>
        <input type="number" id="days" inputmode="numeric" value="20" min="1" step="1">
        <span class="hint">소액부징수는 <b>하루 단위</b>로 판단합니다.</span>
      </div>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="result">—</div>
    <div class="sub" id="detail"></div>
    <div class="sub" id="steps"></div>
    <div class="sub" id="net"></div>
  </div>
  <div class="basis"><b>근거</b> 소득세법 제47조 제2항(일용근로자 근로소득공제 1일 15만원), 제129조 제1항 제4호(원천징수세율 6%), 제59조 제3항(근로소득세액공제 산출세액의 55%), 제86조(소액부징수 1천원 미만), 지방세법 제103조의13(지방소득세 소득세액의 10%)</div>
</section>

<div class="explain">
  <h2>계산 순서</h2>
  <p>일당에서 1일 15만원을 공제한 금액에 6%를 곱해 산출세액을 구하고, 거기서 55%를 세액공제로 뺍니다. 결과적으로 <b>(일당 − 150,000) × 2.7%</b> 가 소득세입니다. 여기에 지방소득세 10%가 더 붙습니다.</p>
  <h2>187,037원이라는 경계</h2>
  <p>계산된 소득세가 1,000원 미만이면 소액부징수 규정으로 징수하지 않습니다. (일당 − 150,000) × 2.7% = 1,000원이 되는 지점이 187,037.04원이므로, <b>일당 187,037원까지는 원천징수세액이 0원</b>입니다. 일당 18만원짜리 현장에서 소득세를 떼고 있다면 잘못 계산한 것입니다.</p>
  <h2>일 단위로 판단합니다</h2>
  <p>소액부징수는 지급액 전체가 아니라 하루치 세액으로 봅니다. 일당 18만원으로 20일을 일해 360만원을 한 번에 받아도, 하루 세액이 810원이므로 20일 전체가 비과세입니다. 지급 총액을 기준으로 1,000원을 넘는지 보면 틀립니다.</p>
  <h2>일용직으로 볼 수 있는가</h2>
  <p>동일한 고용주에게 <b>3개월(건설공사는 1년) 이상 계속 고용</b>되면 일용근로자가 아니라 일반 근로자로 봅니다. 이 경우 간이세액표에 따라 원천징수하고 연말정산 대상이 됩니다. 건설현장에서 같은 사람을 1년 넘게 쓰면서 계속 일용으로 신고하는 것이 흔한 오류입니다.</p>
  <h2>연말정산·종합소득세</h2>
  <p>일용근로소득은 원천징수로 납세의무가 끝나는 분리과세입니다. 다른 소득과 합산하지 않고 연말정산도 하지 않습니다. 반대로 말하면 여기서 낸 세금은 환급받을 수 없습니다.</p>
</div>`,
  script: `
var DEDUCT=150000, RATE=0.06, CREDIT=0.55, MINOR=1000, LOCAL=0.1;
function dayTax(pay){
  var basis=Math.max(0, pay-DEDUCT);
  var gross=basis*RATE;
  /* 6% 를 곱한 뒤 (1-0.55) 를 곱하면 0.44999999999999996 이 되어 일당 20만원의
     세액이 1,350 이 아니라 1,349 로 떨어진다. 실효율 2.7% 로 한 번에 곱하고
     유효자리로 정리한 뒤 버림한다. */
  var net=Number((basis*RATE*(1-CREDIT)).toFixed(6));
  var income=Math.floor(net);
  if(income<MINOR) income=0;
  var local=Math.floor(income*LOCAL);
  return {basis:basis, gross:gross, raw:net, income:income, local:local, total:income+local};
}
function calc(){
  var pay=Number($("pay").value), days=Math.max(1, Math.floor(Number($("days").value)||1));
  $("krwLabel").textContent=krw(pay);
  var out=$("out");
  out.className="out";
  if(!isFinite(pay)||pay<0){ $("result").textContent="—"; $("detail").textContent=""; $("steps").textContent=""; $("net").textContent=""; return; }
  var t=dayTax(pay);
  var totalTax=t.total*days, totalPay=pay*days;
  $("result").textContent=nf.format(totalTax)+"원";
  $("detail").textContent="1일 소득세 "+nf.format(t.income)+"원 + 지방소득세 "+nf.format(t.local)+"원 = "+nf.format(t.total)+"원  ×  "+days+"일";
  if(t.income===0){
    out.className="out is-ok";
    $("steps").textContent="산출세액에서 세액공제를 뺀 "+nf.format(Math.floor(t.raw))+"원이 1,000원 미만 — 소액부징수로 징수하지 않습니다.";
  } else {
    $("steps").textContent="(일당 "+nf.format(pay)+" − 공제 150,000) × 6% × 45% = "+nf.format(Math.floor(t.raw))+"원";
  }
  $("net").textContent="지급총액 "+nf.format(totalPay)+"원  →  실지급 "+nf.format(totalPay-totalTax)+"원";
}
["pay","days"].forEach(function(id){ $(id).addEventListener("input",calc); });
calc();
`,
};
