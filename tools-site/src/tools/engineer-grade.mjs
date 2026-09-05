export default {
  slug: "건설기술인-배치기준",
  title: "건설기술인 배치기준 계산기 | 공사금액별 최소 등급",
  description: "공사예정금액을 넣으면 건설산업기본법 시행령 별표5에 따른 최소 인정 등급(초급·중급·고급·특급·기술사)을 바로 계산합니다.",
  h1: "건설기술인 배치기준",
  lede: "공사예정금액만 넣으면 최소 인정 등급이 나옵니다. 별표5를 매번 열어볼 필요가 없습니다.",
  indexLabel: "건설기술인 배치기준",
  indexDesc: "공사금액 → 최소 등급 (별표5)",
  body: `
<section class="tool">
  <div class="body">
    <div class="field">
      <label for="amt">공사예정금액 (원)</label>
      <input type="number" id="amt" inputmode="numeric" value="905520000" min="0" step="1000000">
      <span class="hint" id="krwLabel"></span>
    </div>
    <details class="more">
      <summary>구간표 보기</summary>
      <table class="tiers" id="tierTable">
        <thead><tr><th>공사예정금액</th><th>최소 인정 등급</th></tr></thead>
        <tbody></tbody>
      </table>
    </details>
  </div>
  <div class="out" id="out">
    <div class="big" id="grade">—</div>
    <div class="sub" id="sub"></div>
  </div>
  <div class="basis"><b>근거</b> 건설산업기본법 제40조, 같은 법 시행령 제35조제2항 및 별표5</div>
</section>

<div class="explain">
  <h2>어떻게 계산하나</h2>
  <p>건설산업기본법 시행령 별표5는 공사예정금액 구간마다 현장에 배치해야 할 건설기술인의 최소 등급을 정하고 있습니다. 이 계산기는 입력한 금액이 어느 구간에 들어가는지 찾아 해당 구간의 최소 인정 등급을 보여줍니다.</p>
  <h2>대체 요건</h2>
  <p>각 구간에는 한 단계 낮은 등급이라도 해당 직무분야 경력을 일정 기간 이상 갖추면 인정되는 대체 요건이 함께 규정되어 있습니다. 하도급계약 검토·확인서 같은 서식에는 통상 최소 인정 등급만 간략히 적습니다.</p>
  <h2>주의</h2>
  <p>일정 규모 이상의 특정 시설물 공사에는 별도의 기준이 적용될 수 있습니다. 실제 배치 전에는 현행 별표5 원문과 해당 공사의 시설물 종류를 함께 확인하십시오.</p>
</div>`,
  script: `
/* 구간표. min 은 "이상"의 하한(원).
   ※ 현행 별표5와 대조해 갱신할 것. */
var TIERS=[
 {min:70000000000,label:"기술사",note:"법 제93조제1항 대상 시설물 여부를 별도로 확인해야 합니다."},
 {min:50000000000,label:"특급기술인 이상"},
 {min:30000000000,label:"특급기술인 이상"},
 {min:10000000000,label:"고급기술인 이상"},
 {min:3000000000,label:"중급기술인 이상"},
 {min:0,label:"초급기술인 이상"}
];
var amt=$("amt"), tbody=document.querySelector("#tierTable tbody");
function tierLabel(t){ return t.min===0 ? "30억원 미만" : krw(t.min)+" 이상"; }
function renderTable(hit){
  tbody.innerHTML="";
  TIERS.forEach(function(t,i){
    var tr=document.createElement("tr");
    if(i===hit) tr.className="hit";
    var a=document.createElement("td"); a.textContent=tierLabel(t);
    var b=document.createElement("td"); b.textContent=t.label;
    tr.appendChild(a); tr.appendChild(b); tbody.appendChild(tr);
  });
}
function calc(){
  var v=Number(amt.value);
  $("krwLabel").textContent=krw(v);
  var i=TIERS.findIndex(function(t){return v>=t.min;});
  if(i<0) i=TIERS.length-1;
  var t=TIERS[i];
  $("grade").textContent=t.label;
  $("sub").textContent = t.note || "각 구간에는 하위 등급에 경력을 더해 인정되는 대체 요건이 있습니다.";
  renderTable(i);
}
amt.addEventListener("input",calc); calc();
`,
};
