export default {
  slug: "조합총회-직접출석-계산기",
  title: "조합 총회 직접출석 요건 계산기 | 정비사업 총회 정족수",
  description: "총 조합원 수와 직접 출석 수를 넣으면 직접출석 비율과 요건 충족 여부를 판정합니다. 일반 안건 10%, 창립총회·정비사업비 안건 20% 기준.",
  h1: "조합 총회 직접출석 요건",
  lede: "총회 전에 몇 명이 더 와야 하는지 바로 나옵니다. 미달이면 부족한 인원까지 보여줍니다.",
  indexLabel: "조합 총회 직접출석 요건",
  indexDesc: "총원 · 직접출석 → 충족 여부",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="total">총 조합원 수</label>
        <input type="number" id="total" inputmode="numeric" value="486" min="1" step="1">
      </div>
      <div class="field">
        <label for="direct">직접 출석 수</label>
        <input type="number" id="direct" inputmode="numeric" value="62" min="0" step="1">
      </div>
    </div>
    <div class="field">
      <label for="kind">안건 유형</label>
      <select id="kind">
        <option value="10">일반 안건 (직접출석 10% 이상)</option>
        <option value="20">창립총회 · 정비사업비의 사용 및 변경 (20% 이상)</option>
      </select>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="pct">—</div>
    <div class="sub" id="verdict"></div>
  </div>
  <div class="basis"><b>근거</b> 도시 및 주거환경정비법 제45조. 정관에 다른 정함이 있으면 정관이 우선합니다</div>
</section>

<div class="explain">
  <h2>왜 직접출석 수를 따로 세나</h2>
  <p>총회 의결은 조합원 과반수 출석과 출석 조합원 과반수 찬성으로 합니다. 여기서 출석에는 서면 의결이 포함되지만, 그와 별도로 <b>일정 비율 이상은 직접 출석</b>해야 합니다. 이 요건을 못 채우면 결의의 효력이 다투어질 수 있습니다.</p>
  <h2>안건에 따라 기준이 다르다</h2>
  <p>일반 안건은 10% 이상, 창립총회와 정비사업비의 사용 및 변경을 위한 총회는 20% 이상이 요구됩니다. 한 총회에 두 유형이 섞여 있으면 높은 기준을 맞춰야 안전합니다.</p>
  <h2>정관이 우선한다</h2>
  <p>법에 정한 것보다 정관이 더 엄격한 기준을 두는 경우가 있습니다. 총회를 열기 전에 해당 조합 정관의 의결 조항을 함께 확인하십시오.</p>
</div>`,
  script: `
var t=$("total"), d=$("direct"), k=$("kind");
function calc(){
  var total=Number(t.value), direct=Number(d.value), need=Number(k.value);
  var out=$("out"), pct=$("pct"), v=$("verdict");
  out.className="out";
  if(!total||total<=0){ pct.textContent="—"; v.textContent="총 조합원 수를 입력하세요."; return; }
  if(direct>total){ out.className="out is-warn"; pct.textContent="입력 오류";
    v.textContent="직접 출석 수가 총 조합원 수보다 많습니다."; return; }
  var required=Math.ceil(total*need/100);
  pct.textContent=((direct/total)*100).toFixed(1)+"%";
  if(direct>=required){ out.className="out is-ok";
    v.textContent="요건 충족 — "+need+"% 기준 "+nf.format(required)+"명 이상 필요, 현재 "+nf.format(direct)+"명"; }
  else { out.className="out is-warn";
    v.textContent="요건 미달 — "+need+"% 기준 "+nf.format(required)+"명 이상 필요, "+nf.format(required-direct)+"명 부족"; }
}
[t,d].forEach(function(el){el.addEventListener("input",calc);});
k.addEventListener("change",calc); calc();
`,
};
