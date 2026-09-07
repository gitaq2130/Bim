/** 도구 스크립트가 공통으로 쓰는 헬퍼. 빌드 시 각 페이지에 인라인된다. */
export const HELPERS = `
var nf = new Intl.NumberFormat("ko-KR");
function krw(n){
  if(!isFinite(n)||n<=0) return "—";
  n=Math.floor(n);
  var eok=Math.floor(n/100000000), man=Math.floor((n%100000000)/10000), rest=n%10000, out=[];
  if(eok) out.push(nf.format(eok)+"억");
  if(man) out.push(nf.format(man)+"만");
  if(!out.length) return nf.format(n)+"원";
  /* 만 단위 미만을 버리므로 딱 떨어지지 않으면 "약" 을 붙인다.
     154,800원을 "15만원" 으로 단정해 보여주면 옆의 정확한 금액과 어긋나 보인다. */
  return (rest?"약 ":"")+out.join(" ")+"원";
}
function $(id){ return document.getElementById(id); }
`;
