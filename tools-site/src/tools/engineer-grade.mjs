export default {
  slug: "건설기술인-배치기준",
  title: "건설기술인 배치기준 계산기 | 공사금액별 자격·경력 요건",
  description: "공사예정금액을 넣으면 건설산업기본법 시행령 별표5에 따른 배치 자격과 대체 인정 요건을 모두 보여줍니다.",
  h1: "건설기술인 배치기준",
  lede: "공사예정금액만 넣으면 배치 자격이 나옵니다. 경력으로 인정되는 대체 요건까지 함께 봅니다.",
  indexLabel: "건설기술인 배치기준",
  indexDesc: "공사금액 → 자격·경력 요건 (별표5)",
  body: `
<section class="tool">
  <div class="body">
    <div class="field">
      <label for="amt">공사예정금액 (원)</label>
      <input type="number" id="amt" inputmode="numeric" value="905520000" min="0" step="1000000">
      <span class="hint" id="krwLabel"></span>
    </div>
    <details class="more">
      <summary>전체 구간표 보기</summary>
      <table class="tiers" id="tierTable">
        <thead><tr><th>공사예정금액</th><th>배치기준</th></tr></thead>
        <tbody></tbody>
      </table>
    </details>
  </div>
  <div class="out" id="out">
    <div class="big" id="grade">—</div>
    <div class="sub" id="sub"></div>
  </div>
  <div class="basis"><b>근거</b> 건설산업기본법 제40조, 같은 법 시행령 제35조제2항 및 별표5(공사예정금액의 규모별 건설기술인 배치기준)</div>
</section>

<div class="explain">
  <h2>등급만으로 정해지지 않는다</h2>
  <p>별표5는 구간마다 하나의 등급을 지정하는 것이 아니라, 인정되는 자격·경력 조합을 여러 개 열거합니다. 예를 들어 300억원 이상 구간은 기술사 또는 기능장이 원칙이지만, 특급기술인이 같은 종류의 공사현장에서 시공관리 업무에 3년 이상 종사했거나 기사 자격 취득 후 해당 직무분야에 10년 이상 종사한 경우에도 인정됩니다.</p>
  <h2>흔한 착오</h2>
  <p>30억원 이상 구간을 중급기술인으로 잡는 경우가 있는데, 이 구간의 원칙은 <b>고급기술인 이상</b>입니다. 중급기술인은 같은 종류의 공사현장에서 시공관리 업무에 3년 이상 종사한 경우에 한해 인정됩니다. 30억원 미만 구간도 마찬가지로 원칙은 중급기술인 이상이고, 초급기술인은 경력 요건을 갖춘 경우에 인정됩니다.</p>
  <h2>확인할 것</h2>
  <p>700억원 이상 구간의 적용 여부는 대상 시설물의 종류와도 관련됩니다. 또한 이 표는 개정될 수 있으므로, 실제 배치 전에는 국가법령정보센터에서 시행일 기준 현행 별표5 원문을 확인하십시오.</p>
</div>`,
  script: `
/* 건설산업기본법 시행령 별표5 (공사예정금액의 규모별 건설기술인 배치기준).
   min 은 "이상"의 하한(원). options 는 원문에 열거된 인정 요건.
   ※ 개정 시 이 표를 갱신할 것. */
var TIERS=[
 {min:70000000000, head:"기술사", options:[
   "기술사"]},
 {min:50000000000, head:"기술사 또는 기능장", options:[
   "기술사 또는 기능장",
   "특급기술인으로서 동종현장에 배치되어 시공관리업무에 5년 이상 종사한 사람"]},
 {min:30000000000, head:"기술사 또는 기능장", options:[
   "기술사 또는 기능장",
   "특급기술인으로서 동종현장에 배치되어 시공관리업무에 3년 이상 종사한 사람",
   "기사 자격 취득 후 해당 직무분야에 10년 이상 종사한 사람"]},
 {min:10000000000, head:"기술사·기능장 또는 특급기술인", options:[
   "기술사 또는 기능장",
   "특급기술인",
   "고급기술인으로서 동종현장에 배치되어 시공관리업무에 3년 이상 종사한 사람",
   "기사 자격 취득 후 해당 직무분야에 5년 이상 종사한 사람",
   "산업기사 자격 취득 후 해당 직무분야에 7년 이상 종사한 사람"]},
 {min:3000000000, head:"고급기술인 이상", options:[
   "고급기술인 이상인 사람",
   "중급기술인으로서 동종현장에 배치되어 시공관리업무에 3년 이상 종사한 사람",
   "기사 이상 자격 취득자로서 해당 직무분야에 3년 이상 종사한 사람",
   "산업기사 자격 취득 후 해당 직무분야에 5년 이상 종사한 사람"]},
 {min:0, head:"중급기술인 이상", options:[
   "중급기술인 이상인 사람",
   "초급기술인으로서 동종현장에 배치되어 시공관리업무에 3년 이상 종사한 사람",
   "산업기사 이상 자격 취득자로서 해당 직무분야에 3년 이상 종사한 사람"]}
];

var amt=$("amt"), tbody=document.querySelector("#tierTable tbody");
function tierLabel(t){ return t.min===0 ? "30억원 미만" : krw(t.min)+" 이상"; }

function renderTable(hit){
  tbody.innerHTML="";
  TIERS.forEach(function(t,i){
    var tr=document.createElement("tr");
    if(i===hit) tr.className="hit";
    var a=document.createElement("td"); a.textContent=tierLabel(t);
    var b=document.createElement("td"); b.textContent=t.head;
    tr.appendChild(a); tr.appendChild(b); tbody.appendChild(tr);
  });
}

function calc(){
  var v=Number(amt.value);
  $("krwLabel").textContent=krw(v);
  var i=TIERS.findIndex(function(t){return v>=t.min;});
  if(i<0) i=TIERS.length-1;
  var t=TIERS[i];
  $("grade").textContent=t.head;
  var rest=t.options.slice(1);
  $("sub").textContent = rest.length
    ? "다음도 인정됩니다 — "+rest.join(" / ")
    : "이 구간은 기술사만 인정됩니다.";
  renderTable(i);
}
amt.addEventListener("input",calc); calc();
`,
};
