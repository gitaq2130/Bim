export default {
  slug: "설계변경-증감률-계산기",
  title: "설계변경 증감률 계산기 | 당초금액 대비 증감액·증감률",
  description: "당초 계약금액과 변경 후 금액을 넣으면 증감액과 증감률을 계산합니다. 증액은 +, 감액은 △로 표기합니다.",
  h1: "설계변경 증감률",
  lede: "당초와 변경 금액만 넣으면 증감액·증감률이 나옵니다. 보고서에 쓰는 부호 표기 그대로 나옵니다.",
  indexLabel: "설계변경 증감률",
  indexDesc: "당초 · 변경 금액 → 증감",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="before">당초 계약금액 (원)</label>
        <input type="number" id="before" inputmode="numeric" value="1097204046" min="0" step="1000000">
      </div>
      <div class="field">
        <label for="after">변경 후 금액 (원)</label>
        <input type="number" id="after" inputmode="numeric" value="1160204046" min="0" step="1000000">
      </div>
    </div>
    <span class="hint" id="krwLabel"></span>
  </div>
  <div class="out" id="out">
    <div class="big" id="delta">—</div>
    <div class="sub" id="detail"></div>
  </div>
  <div class="basis"><b>표기</b> 증액은 +, 감액은 △. 건설현장 보고서·회의록에서 쓰는 관행 표기를 따릅니다</div>
</section>

<div class="explain">
  <h2>부호를 왜 △로 쓰나</h2>
  <p>건설 실무 문서에서는 감액을 마이너스 기호 대신 △로 적는 관행이 있습니다. 표에서 하이픈이나 마이너스가 다른 뜻으로 읽힐 여지를 없애기 위해서입니다. 이 계산기도 같은 표기로 보여줍니다.</p>
  <h2>누계 증감률은 따로 본다</h2>
  <p>여기 나오는 값은 이번 변경 한 건의 증감률입니다. 여러 차례 설계변경이 있었다면 최초 계약금액 대비 누계 증감률을 따로 계산해야 하며, 계약이나 지침에 따라 일정 비율을 넘으면 별도 절차가 필요할 수 있습니다.</p>
</div>`,
  script: `
var b=$("before"), a=$("after");
function calc(){
  var B=Number(b.value), A=Number(a.value);
  $("krwLabel").textContent="당초 "+krw(B)+"  ·  변경 "+krw(A);
  var out=$("out"), d=$("delta"), det=$("detail");
  out.className="out";
  if(!isFinite(B)||B<=0){ d.textContent="—"; det.textContent="당초 금액을 입력하세요."; return; }
  var diff=A-B, rate=(diff/B)*100;
  var sign = diff>0 ? "+" : (diff<0 ? "△" : "");
  d.textContent = sign+nf.format(Math.abs(diff))+"원  ("+sign+Math.abs(rate).toFixed(2)+"%)";
  det.textContent = "당초 "+nf.format(B)+"원 → 변경 "+nf.format(A)+"원  ·  "+krw(Math.abs(diff))+" "+(diff>=0?"증액":"감액");
  if(diff>0) out.className="out is-warn";
  else if(diff<0) out.className="out is-ok";
}
[b,a].forEach(function(el){el.addEventListener("input",calc);}); calc();
`,
};
