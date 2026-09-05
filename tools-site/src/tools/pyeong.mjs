export default {
  slug: "평-제곱미터-변환",
  title: "평 제곱미터 변환 | 평수 ↔ ㎡ 계산기",
  description: "평을 제곱미터로, 제곱미터를 평으로 바꿉니다. 1평 = 3.3058㎡ 기준. 연면적·전용면적 확인할 때 쓰는 계산.",
  h1: "평 ↔ 제곱미터",
  lede: "도면은 제곱미터인데 이야기는 평으로 합니다. 양쪽을 한 번에 봅니다.",
  indexLabel: "평 ↔ 제곱미터",
  indexDesc: "면적 단위 변환",
  body: `
<section class="tool">
  <div class="body">
    <div class="row2">
      <div class="field">
        <label for="sqm">제곱미터 (㎡)</label>
        <input type="number" id="sqm" inputmode="decimal" value="84" min="0" step="0.01">
      </div>
      <div class="field">
        <label for="py">평</label>
        <input type="number" id="py" inputmode="decimal" value="25.41" min="0" step="0.01">
      </div>
    </div>
    <span class="hint">한쪽에 입력하면 반대쪽이 자동으로 바뀝니다.</span>
  </div>
  <div class="out">
    <div class="big" id="headline">—</div>
    <div class="sub" id="detail"></div>
  </div>
  <div class="basis"><b>환산</b> 1평 = 400/121 ㎡ ≈ 3.305785㎡. 계량에 관한 법률상 거래·증명에는 제곱미터를 씁니다</div>
</section>

<div class="explain">
  <h2>왜 3.3이 아니라 3.3058인가</h2>
  <p>1평은 사방 6자로, 정확히는 400/121 제곱미터입니다. 3.3으로 어림하면 큰 면적에서 오차가 눈에 띄게 커집니다. 100평이면 약 0.6㎡ 차이가 납니다.</p>
  <h2>공식 문서에는 제곱미터로</h2>
  <p>계약서·도면·공부상 면적은 제곱미터가 기준입니다. 평은 관행적인 표현이므로 문서에 옮길 때는 제곱미터 값을 쓰고, 평은 참고로만 적는 편이 안전합니다.</p>
</div>`,
  script: `
var sqm=$("sqm"), py=$("py");
var RATIO=400/121;
var lock=false;
function show(){
  var s=Number(sqm.value), p=Number(py.value);
  if(!isFinite(s)||s<0){ $("headline").textContent="—"; $("detail").textContent=""; return; }
  $("headline").textContent = s.toFixed(2)+" ㎡  =  "+p.toFixed(2)+" 평";
  $("detail").textContent = "1평 = "+RATIO.toFixed(6)+"㎡ 기준";
}
sqm.addEventListener("input",function(){
  if(lock) return; lock=true;
  var s=Number(sqm.value);
  py.value = isFinite(s) ? (s/RATIO).toFixed(2) : "";
  lock=false; show();
});
py.addEventListener("input",function(){
  if(lock) return; lock=true;
  var p=Number(py.value);
  sqm.value = isFinite(p) ? (p*RATIO).toFixed(2) : "";
  lock=false; show();
});
show();
`,
};
