export default {
  slug: "금액-한글-변환",
  title: "금액 한글 변환 | 숫자를 계약서용 한글 금액으로",
  description: "숫자 금액을 계약서에 적는 한글 표기로 바꿉니다. 관행 표기와 계약서용 표기를 함께 보여줍니다.",
  h1: "금액 한글 표기",
  lede: "계약서에 손으로 적던 금액입니다. 숫자만 넣으면 그대로 옮겨 적을 수 있습니다.",
  indexLabel: "금액 한글 표기",
  indexDesc: "숫자 → 계약서용 한글",
  body: `
<section class="tool">
  <div class="body">
    <div class="field">
      <label for="amt">금액 (원)</label>
      <input type="number" id="amt" inputmode="numeric" value="1097204046" min="0" step="1">
      <span class="hint" id="krwLabel"></span>
    </div>
    <div class="field">
      <label for="style">표기 방식</label>
      <select id="style">
        <option value="contract">계약서 표기 (일천구백… — 앞자리 '일'을 살림)</option>
        <option value="plain">관행 표기 (천구백… — 앞자리 '일'을 생략)</option>
      </select>
    </div>
  </div>
  <div class="out" id="out">
    <div class="big" id="hangul" style="font-size:1.25rem;line-height:1.5;word-break:keep-all">—</div>
    <div class="sub" id="detail"></div>
  </div>
  <div class="basis"><b>표기</b> 앞에 金, 뒤에 整을 붙이는 것이 계약서 관행입니다. 위·변조를 막기 위해 앞자리 '일'을 생략하지 않는 편이 안전합니다</div>
</section>

<div class="explain">
  <h2>왜 '일'을 살리나</h2>
  <p>115를 '백십오'로 적으면 앞에 숫자를 덧붙여 고치기 쉽습니다. '일백일십오'로 적으면 그런 여지가 줄어듭니다. 계약서·어음 같은 문서에서 앞자리 일을 생략하지 않는 관행은 여기서 나왔습니다.</p>
  <h2>金과 整</h2>
  <p>금액 앞의 金(금)과 끝의 整(정)은 그 앞뒤로 숫자를 더 적어 넣지 못하게 막는 표시입니다. 한글로는 '일금 …원정'으로도 씁니다.</p>
</div>`,
  script: `
var DIGITS=["","일","이","삼","사","오","육","칠","팔","구"];
var SMALL=["","십","백","천"];
var BIG=["","만","억","조","경"];

function fourDigits(n, keepOne){
  var out="", s=String(n).padStart(4,"0");
  for(var i=0;i<4;i++){
    var d=Number(s[i]), unit=SMALL[3-i];
    if(d===0) continue;
    if(d===1 && unit && !keepOne) out+=unit;
    else out+=DIGITS[d]+unit;
  }
  return out;
}

function toHangul(n, keepOne){
  if(!isFinite(n)||n<0) return "";
  n=Math.floor(n);
  if(n===0) return "영";
  var groups=[];
  while(n>0){ groups.push(n%10000); n=Math.floor(n/10000); }
  var parts=[];
  for(var i=groups.length-1;i>=0;i--){
    if(groups[i]===0) continue;
    var head=fourDigits(groups[i], keepOne);
    /* 관행 표기에서 10,000 은 "일만"이 아니라 "만"으로 읽는다.
       억·조는 "일억", "일조"로 읽으므로 만 자리에만 적용한다. */
    if(!keepOne && groups[i]===1 && i===1) head="";
    parts.push(head+BIG[i]);
  }
  return parts.join("");
}

var amt=$("amt"), style=$("style");
function calc(){
  var v=Number(amt.value);
  $("krwLabel").textContent=krw(v);
  var keepOne = style.value==="contract";
  var h=toHangul(v, keepOne);
  if(!h){ $("hangul").textContent="—"; $("detail").textContent="금액을 입력하세요."; return; }
  $("hangul").textContent="金 "+h+"원整";
  $("detail").textContent="일금 "+h+"원정  ·  "+nf.format(Math.floor(v))+"원";
}
[amt].forEach(function(el){el.addEventListener("input",calc);});
style.addEventListener("change",calc); calc();
`,
};
