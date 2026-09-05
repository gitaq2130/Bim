export default {
  slug: "하도급률-계산기",
  title: "하도급률 계산기 | 원도급액 대비 하도급액 비율",
  description: "원도급액과 하도급액을 넣으면 하도급률을 소수 첫째자리까지 계산합니다. 하도급계약 검토·확인서에 기재하는 값과 동일합니다.",
  h1: "하도급률",
  lede: "원도급액과 하도급액만 넣으면 됩니다. 검토서에 그대로 옮겨 적을 수 있는 형식으로 나옵니다.",
  indexLabel: "하도급률",
  indexDesc: "원도급액 · 하도급액 → 비율",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="prime">원도급액 (원)</label>
        <input type="number" id="prime" inputmode="numeric" value="1097204046" min="0" step="1000000">
      </div>
      <div class="field">
        <label for="sub">하도급액 (원)</label>
        <input type="number" id="sub" inputmode="numeric" value="905520000" min="0" step="1000000">
      </div>
    </div>
    <span class="hint" id="krwLabel"></span>
  </div>
  <div class="out" id="out">
    <div class="big" id="rate">—</div>
    <div class="sub" id="note"></div>
  </div>
  <div class="basis"><b>계산</b> 하도급액 ÷ 원도급액 × 100, 소수 첫째자리까지</div>
</section>

<div class="explain">
  <h2>어떤 금액을 넣나</h2>
  <p>하도급계약 통보서의 해당 하도급 부분 원도급 금액과 하도급(예정)금액을 그대로 넣습니다. 부가가치세 포함 여부는 두 값이 같은 기준이어야 비율이 맞습니다.</p>
  <h2>표기 방식</h2>
  <p>검토 서식에는 통상 소수 첫째자리까지 적습니다. 이 계산기도 같은 자리수로 보여줍니다.</p>
</div>`,
  script: `
var p=$("prime"), s=$("sub");
function calc(){
  var P=Number(p.value), S=Number(s.value);
  $("krwLabel").textContent="원도급 "+krw(P)+"  ·  하도급 "+krw(S);
  var out=$("out"), rate=$("rate"), note=$("note");
  out.className="out";
  if(!P||P<=0){ rate.textContent="—"; note.textContent="원도급액을 입력하세요."; return; }
  rate.textContent=((S/P)*100).toFixed(1)+"%";
  if(S>P){ out.className="out is-warn"; note.textContent="하도급액이 원도급액보다 큽니다. 입력값을 확인하세요."; }
  else { note.textContent="차액 "+krw(P-S); }
}
[p,s].forEach(function(el){el.addEventListener("input",calc);}); calc();
`,
};
