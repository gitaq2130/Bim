export default {
  slug: "연장근로수당-계산기",
  title: "연장·야간·휴일근로수당 계산기 | 가산율 50%·100%",
  description: "통상시급과 시간만 넣으면 연장·야간·휴일근로 가산수당이 나옵니다. 휴일 8시간 초과분 100% 가산과 5인 미만 사업장 적용 제외까지 반영합니다.",
  h1: "연장·야간·휴일근로수당 계산",
  lede: "가산율이 붙는 자리가 서로 겹칩니다. 야간에 한 연장근로는 100%입니다.",
  indexLabel: "연장·야간·휴일수당",
  group: "노무",
  indexDesc: "가산율 50% · 100% 계산",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="wage">통상시급 (원)</label>
        <input type="number" id="wage" inputmode="numeric" value="10320" min="0" step="10">
        <span class="hint">월급제는 월 통상임금 ÷ 209.</span>
      </div>
      <div class="field">
        <label for="scale">사업장 규모</label>
        <select id="scale">
          <option value="5">상시 5명 이상</option>
          <option value="4">상시 5명 미만</option>
        </select>
      </div>
    </div>
    <div class="row2">
      <div class="field">
        <label for="ot">연장근로시간</label>
        <input type="number" id="ot" inputmode="decimal" value="10" min="0" step="0.5">
        <span class="hint">1일 8시간 · 1주 40시간을 넘긴 시간.</span>
      </div>
      <div class="field">
        <label for="night">야간근로시간</label>
        <input type="number" id="night" inputmode="decimal" value="0" min="0" step="0.5">
        <span class="hint">22시~06시 사이. 연장·휴일 시간과 <b>겹쳐서</b> 넣습니다.</span>
      </div>
    </div>
    <div class="field">
      <label for="hol">휴일근로시간</label>
      <input type="number" id="hol" inputmode="decimal" value="0" min="0" step="0.5">
      <span class="hint">1일 기준입니다. 8시간까지는 50%, 넘는 시간은 100% 가산됩니다.</span>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="result">—</div>
    <div class="sub" id="detail"></div>
    <div class="sub" id="note"></div>
  </div>
  <div class="basis"><b>근거</b> 근로기준법 제56조(연장·야간근로 통상임금의 50% 이상 가산, 휴일근로 8시간 이내 50%·8시간 초과 100% 가산), 제11조 제1항 및 시행령 별표1(상시 4명 이하 사업장은 제56조 적용 제외)</div>
</section>

<div class="explain">
  <h2>야간수당은 따로 더해집니다</h2>
  <p>야간근로 가산은 연장근로 가산과 별개로 붙습니다. 22시 이후에 한 연장근로 1시간은 연장 50% + 야간 50% = 통상시급의 <b>2배</b>입니다. 그래서 이 계산기에서 야간시간은 연장시간과 겹쳐서 넣는 것이 맞고, 야간 칸에는 가산분 0.5배만 계산됩니다.</p>
  <h2>휴일근로 8시간이 경계입니다</h2>
  <p>2018년 근로기준법 개정으로 휴일근로 가산율이 명문화되었습니다. 8시간 이내는 50%, 8시간을 넘는 시간은 100%입니다. 휴일에 10시간 일했다면 8시간은 1.5배, 2시간은 2배로 계산합니다. 휴일근로에 대해 연장 가산을 중복해서 붙이지는 않습니다.</p>
  <h2>5인 미만 사업장</h2>
  <p>상시 근로자 4명 이하 사업장에는 제56조가 적용되지 않습니다. 연장·야간·휴일에 일해도 가산 없이 일한 시간만큼의 임금만 지급하면 법 위반이 아닙니다. 다만 최저임금법과 주휴수당(제55조)은 5인 미만에도 적용됩니다. 여기서 &lsquo;상시&rsquo;는 등기부상 인원이 아니라 실제 사용 인원의 1개월 평균으로 봅니다.</p>
  <h2>포괄임금제라도</h2>
  <p>포괄임금 약정이 있어도 실제 근로시간으로 계산한 법정수당이 약정액을 넘으면 차액을 지급해야 합니다. 약정으로 법정 기준을 낮출 수는 없습니다.</p>
</div>`,
  script: `
var ids=["wage","scale","ot","night","hol"];
function calc(){
  var w=Number($("wage").value), ot=Number($("ot").value)||0,
      nt=Number($("night").value)||0, hl=Number($("hol").value)||0;
  var small = $("scale").value==="4";
  var out=$("out");
  out.className="out";
  if(!isFinite(w)||w<0){ $("result").textContent="—"; $("detail").textContent=""; $("note").textContent=""; return; }
  var hol8=Math.min(hl,8), holOver=Math.max(hl-8,0);
  var rOT=small?1:1.5, rH8=small?1:1.5, rHO=small?1:2, rN=small?0:0.5;
  var pOT=ot*w*rOT, pH8=hol8*w*rH8, pHO=holOver*w*rHO, pN=nt*w*rN;
  var total=Math.floor(pOT+pH8+pHO+pN);
  $("result").textContent=nf.format(total)+"원";
  var parts=[];
  if(ot) parts.push("연장 "+ot+"h × "+rOT+"배 = "+nf.format(Math.floor(pOT))+"원");
  if(hol8) parts.push("휴일 8h이내 "+hol8+"h × "+rH8+"배 = "+nf.format(Math.floor(pH8))+"원");
  if(holOver) parts.push("휴일 8h초과 "+holOver+"h × "+rHO+"배 = "+nf.format(Math.floor(pHO))+"원");
  if(nt && rN) parts.push("야간가산 "+nt+"h × "+rN+"배 = "+nf.format(Math.floor(pN))+"원");
  $("detail").textContent = parts.length ? parts.join("  ·  ") : "시간을 입력하세요.";
  if(small){
    out.className="out is-warn";
    $("note").textContent="5인 미만 사업장이라 가산율이 적용되지 않습니다. 일한 시간만큼의 임금만 계산했습니다.";
  } else if(nt>ot+hl){
    out.className="out is-warn";
    $("note").textContent="야간시간이 연장·휴일 시간의 합보다 큽니다. 야간은 연장·휴일 시간과 겹쳐 넣는 값이니 확인하세요.";
  } else {
    $("note").textContent = total ? "통상시급 "+nf.format(w)+"원 기준  ·  "+krw(total) : "";
  }
}
ids.forEach(function(id){ $(id).addEventListener("input",calc); $(id).addEventListener("change",calc); });
calc();
`,
};
