export default {
  slug: "공사기간-계산기",
  title: "공사기간 계산기 | 착공일 준공일 일수 계산",
  description: "착공일과 준공일을 넣으면 총 공사일수를 계산합니다. 달력일과 토·일 제외 근무일수를 함께 보여줍니다.",
  h1: "공사기간 계산",
  lede: "착공일과 준공일만 넣으면 됩니다. 달력일과 주말 제외 일수를 같이 봅니다.",
  indexLabel: "공사기간",
  indexDesc: "착공·준공일 → 일수",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="start">착공일</label>
        <input type="date" id="start" value="2027-02-01">
      </div>
      <div class="field">
        <label for="end">준공일</label>
        <input type="date" id="end" value="2027-04-30">
      </div>
    </div>
    <div class="field">
      <label for="incl">기산 방식</label>
      <select id="incl">
        <option value="1">양쪽 끝 포함 (착공일·준공일 모두 산입)</option>
        <option value="0">기간만 계산 (준공일 − 착공일)</option>
      </select>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="days">—</div>
    <div class="sub" id="detail"></div>
  </div>
  <div class="basis"><b>주의</b> 계약상 공사기간의 기산·만료일 산정 방식은 계약서와 관계 법령에 따릅니다. 이 계산기는 달력 기준 일수만 셉니다</div>
</section>

<div class="explain">
  <h2>양쪽 끝을 포함하나</h2>
  <p>공사기간을 세는 방식은 계약마다 다릅니다. 착공일과 준공일을 모두 넣어 세는 경우가 많지만, 순수한 기간(차이)만 보는 경우도 있습니다. 두 값이 하루 차이 나므로 어느 쪽 기준인지 계약서를 확인하십시오.</p>
  <h2>근무일수는 참고값</h2>
  <p>여기서 빼는 것은 토요일과 일요일뿐입니다. 공휴일과 현장 휴무일은 반영되지 않으므로, 실제 가동일수는 이 값보다 적습니다.</p>
</div>`,
  script: `
var s=$("start"), e=$("end"), incl=$("incl");
function calc(){
  var out=$("out"), d=$("days"), det=$("detail");
  out.className="out";
  var a=new Date(s.value+"T00:00:00"), b=new Date(e.value+"T00:00:00");
  if(isNaN(a)||isNaN(b)){ d.textContent="—"; det.textContent="날짜를 입력하세요."; return; }
  if(b<a){ out.className="out is-warn"; d.textContent="입력 오류"; det.textContent="준공일이 착공일보다 빠릅니다."; return; }
  var MS=86400000;
  var diff=Math.round((b-a)/MS);
  var total=diff+(incl.value==="1"?1:0);
  var work=0, cur=new Date(a);
  var last=new Date(b); if(incl.value!=="1") last.setDate(last.getDate()-1);
  while(cur<=last){ var w=cur.getDay(); if(w!==0&&w!==6) work++; cur.setDate(cur.getDate()+1); }
  d.textContent=nf.format(total)+"일";
  var months=(total/30.4375);
  det.textContent="토·일 제외 "+nf.format(work)+"일  ·  약 "+months.toFixed(1)+"개월";
}
[s,e].forEach(function(el){el.addEventListener("input",calc);});
incl.addEventListener("change",calc); calc();
`,
};
