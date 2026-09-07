export default {
  slug: "퇴직금-계산기",
  title: "퇴직금 계산기 | 평균임금·재직일수 기준 법정 퇴직금",
  description: "입사일·퇴사일과 최근 3개월 임금으로 법정 퇴직금을 계산합니다. 연간 상여금과 연차수당의 3/12 가산까지 반영합니다.",
  h1: "퇴직금 계산",
  lede: "1일 평균임금 × 30일 × (재직일수 ÷ 365). 상여금·연차수당을 빠뜨리면 금액이 줄어듭니다.",
  indexLabel: "퇴직금",
  group: "노무",
  indexDesc: "평균임금 × 30일 × 재직일수/365",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="join">입사일</label>
        <input type="date" id="join" value="2023-03-02">
      </div>
      <div class="field">
        <label for="quit">퇴직일</label>
        <input type="date" id="quit" value="2026-09-01">
        <span class="hint">마지막 근무일의 <b>다음 날</b>을 넣습니다.</span>
      </div>
    </div>
    <div class="field">
      <label for="wage3">산정기간 3개월 임금총액 (원)</label>
      <input type="number" id="wage3" inputmode="numeric" value="10500000" min="0" step="10000">
      <span class="hint" id="periodHint"></span>
    </div>
    <div class="row2">
      <div class="field">
        <label for="bonus">연간 상여금 (원)</label>
        <input type="number" id="bonus" inputmode="numeric" value="0" min="0" step="10000">
        <span class="hint">퇴직 전 1년치. 3/12만 반영됩니다.</span>
      </div>
      <div class="field">
        <label for="annual">연차수당 (원)</label>
        <input type="number" id="annual" inputmode="numeric" value="0" min="0" step="10000">
        <span class="hint">전전년도 미사용분에 대해 받은 금액. 3/12만 반영됩니다.</span>
      </div>
    </div>
    <div class="field">
      <label for="ordinary">1일 통상임금 (원, 선택)</label>
      <input type="number" id="ordinary" inputmode="numeric" value="0" min="0" step="1000">
      <span class="hint">넣으면 평균임금과 비교해 <b>큰 쪽</b>으로 계산합니다. 모르면 0으로 두세요.</span>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="result">—</div>
    <div class="sub" id="detail"></div>
    <div class="sub" id="note"></div>
  </div>
  <div class="basis"><b>근거</b> 근로자퇴직급여 보장법 제8조 제1항(계속근로기간 1년에 대하여 30일분 이상의 평균임금), 근로기준법 제2조 제1항 제6호·제2항(평균임금의 정의, 통상임금 하한)</div>
</section>

<div class="explain">
  <h2>평균임금 산정기간이 3개월인 이유</h2>
  <p>근로기준법은 평균임금을 &ldquo;산정 사유가 발생한 날 이전 3개월 동안 지급된 임금 총액을 그 기간의 총일수로 나눈 금액&rdquo;으로 정의합니다. 여기서 총일수는 근무일수가 아니라 <b>달력상 일수</b>입니다. 그래서 같은 월급이어도 산정기간에 며칠이 들어가느냐에 따라 1일 평균임금이 조금씩 달라집니다.</p>
  <h2>상여금과 연차수당을 빼면 안 됩니다</h2>
  <p>연간 상여금은 3개월분에 해당하는 3/12을, 연차수당도 같은 비율로 임금 총액에 더합니다. 매달 나오는 돈이 아니라는 이유로 빠뜨리는 경우가 많은데, 이건 근로자에게 불리한 계산입니다. 상여금 400만원이면 100만원이, 연차수당 60만원이면 15만원이 산정 기초에 들어갑니다.</p>
  <h2>평균임금이 통상임금보다 적으면</h2>
  <p>근로기준법 제2조 제2항은 평균임금이 통상임금보다 적으면 통상임금을 평균임금으로 하도록 정하고 있습니다. 퇴직 직전에 결근·휴업이 있어 임금이 줄었다면 이 조항 때문에 결과가 달라집니다. 1일 통상임금을 넣으면 큰 쪽으로 계산합니다.</p>
  <h2>1년 미만이면</h2>
  <p>계속근로기간이 1년 미만이면 퇴직급여 지급 의무가 없습니다(근퇴법 제4조 제1항 단서). 4주 평균 1주 소정근로시간이 15시간 미만인 경우도 같습니다. 다만 <b>계속근로기간은 수습·인턴 기간을 포함</b>해서 봅니다.</p>
</div>`,
  script: `
var ids=["join","quit","wage3","bonus","annual","ordinary"];
var MS=86400000;
function d(v){ return v ? new Date(v+"T00:00:00") : null; }
function minusMonths(dt,m){
  var t=new Date(dt.getFullYear(), dt.getMonth()-m, 1);
  var last=new Date(t.getFullYear(), t.getMonth()+1, 0).getDate();
  t.setDate(Math.min(dt.getDate(), last));
  return t;
}
function iso(dt){
  return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");
}
function calc(){
  var out=$("out"), res=$("result"), det=$("detail"), note=$("note");
  out.className="out"; note.textContent="";
  var J=d($("join").value), Q=d($("quit").value);
  if(!J||!Q||!(Q>J)){ res.textContent="—"; det.textContent="퇴직일이 입사일보다 뒤여야 합니다."; $("periodHint").textContent=""; return; }
  var start=minusMonths(Q,3);
  var periodDays=Math.round((Q-start)/MS);
  $("periodHint").textContent="산정기간 "+iso(start)+" ~ "+iso(new Date(Q-MS))+" ("+periodDays+"일)";
  var served=Math.round((Q-J)/MS);
  var W=Number($("wage3").value)||0, B=Number($("bonus").value)||0, A=Number($("annual").value)||0;
  var base=W + B*3/12 + A*3/12;
  var avg=base/periodDays;
  var ord=Number($("ordinary").value)||0;
  var usedOrdinary = ord>avg;
  var daily = usedOrdinary ? ord : avg;
  var pay=Math.floor(daily*30*(served/365));
  if(served<365){
    out.className="out is-warn";
    res.textContent="지급 의무 없음";
    det.textContent="재직일수 "+nf.format(served)+"일 — 계속근로 1년 미만입니다.";
    note.textContent="참고로 1년을 채웠다고 가정하면 "+nf.format(Math.floor(daily*30))+"원(30일분)입니다.";
    return;
  }
  res.textContent=nf.format(pay)+"원";
  det.textContent="재직일수 "+nf.format(served)+"일  ·  1일 평균임금 "+nf.format(Math.round(avg))+"원  ·  "+krw(pay);
  note.textContent = usedOrdinary
    ? "평균임금("+nf.format(Math.round(avg))+"원)보다 통상임금이 커서 통상임금으로 계산했습니다."
    : "산정 기초 "+nf.format(Math.round(base))+"원 ÷ "+periodDays+"일";
}
ids.forEach(function(id){ $(id).addEventListener("input",calc); $(id).addEventListener("change",calc); });
calc();
`,
};
