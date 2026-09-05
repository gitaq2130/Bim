/** 모든 도구 페이지가 공유하는 HTML 껍데기. */

export const SITE = {
  name: "현장 실무 계산기",
  tagline: "매번 표 찾아보던 것들",
  // 배포 도메인. 배포 후 실제 주소로 바꾼다(정규 URL·OG 태그에 쓰인다).
  origin: "https://example.com",
  // 애드센스 게시자 ID. 승인 후 "ca-pub-..." 를 넣으면 광고 스크립트가 자동으로 삽입된다.
  adsensePublisherId: "",
};

const CSS = `
:root{--bg:#F6F8F7;--card:#FFF;--sunken:#EDF1EF;--ink:#14181A;--ink-2:#48565A;--ink-3:#7C8B8E;
--line:#D6DEDB;--line-soft:#E7EDEA;--brand:#0E6E6E;--brand-bg:#E3F0EF;--warn:#B3261E;--warn-bg:#FBEAE8;
--ok:#1F6F43;--ok-bg:#E6F2EB;--f-ui:"Gothic A1","Malgun Gothic",system-ui,sans-serif;--f-num:"Roboto Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0E1213;--card:#171D1E;--sunken:#121818;
--ink:#E8EEEC;--ink-2:#A9B8B8;--ink-3:#758585;--line:#2C3739;--line-soft:#222B2C;--brand:#5FBDBA;
--brand-bg:#12292A;--warn:#E8877E;--warn-bg:#2C1917;--ok:#74C295;--ok-bg:#14261C}}
:root[data-theme="dark"]{--bg:#0E1213;--card:#171D1E;--sunken:#121818;--ink:#E8EEEC;--ink-2:#A9B8B8;
--ink-3:#758585;--line:#2C3739;--line-soft:#222B2C;--brand:#5FBDBA;--brand-bg:#12292A;--warn:#E8877E;
--warn-bg:#2C1917;--ok:#74C295;--ok-bg:#14261C}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--f-ui);font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}
.wrap{max-width:44rem;margin:0 auto;padding:0 1rem 4rem}
a{color:var(--brand)}
header.top{padding:1.5rem 0 1.1rem;border-bottom:2px solid var(--ink);display:grid;gap:.4rem}
.kicker{font-family:var(--f-num);font-size:.6875rem;letter-spacing:.16em;color:var(--brand);font-weight:700}
.kicker a{text-decoration:none}
h1{margin:0;font-size:1.75rem;font-weight:900;letter-spacing:-.02em;text-wrap:balance}
header.top p{margin:0;color:var(--ink-2);max-width:40ch}
.tool{background:var(--card);border:1px solid var(--line);border-radius:3px;margin-top:1.5rem;overflow:hidden}
.body{padding:1.1rem;display:grid;gap:.9rem}
.field{display:grid;gap:.35rem}
.field label{font-size:.8125rem;color:var(--ink-2);font-weight:500}
.hint{font-size:.75rem;color:var(--ink-3)}
input[type=number],input[type=text],select{width:100%;font-family:var(--f-num);font-size:1rem;padding:.6rem .7rem;
color:var(--ink);background:var(--sunken);border:1px solid var(--line);border-radius:2px;-moz-appearance:textfield}
input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
select{font-family:var(--f-ui)}
input:focus-visible,select:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
@media (max-width:30rem){.row2{grid-template-columns:1fr}}
.out{background:var(--sunken);border-top:1px solid var(--line-soft);padding:1rem 1.1rem;display:grid;gap:.45rem}
.out .big{font-family:var(--f-num);font-size:1.5rem;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.25}
.out .sub{font-size:.8125rem;color:var(--ink-2)}
.out.is-warn{background:var(--warn-bg)}.out.is-warn .big{color:var(--warn)}
.out.is-ok{background:var(--ok-bg)}.out.is-ok .big{color:var(--ok)}
.basis{padding:.65rem 1.1rem;border-top:1px solid var(--line-soft);font-size:.75rem;color:var(--ink-3)}
.basis b{color:var(--ink-2);font-weight:700}
table.tiers{width:100%;border-collapse:collapse;font-size:.8125rem;margin-top:.2rem}
table.tiers th,table.tiers td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--line-soft)}
table.tiers th{font-size:.6875rem;letter-spacing:.08em;color:var(--ink-3);font-weight:700}
table.tiers td:first-child{font-family:var(--f-num);white-space:nowrap}
table.tiers tr.hit td{background:var(--brand-bg);font-weight:700;color:var(--brand)}
details.more{margin-top:.3rem}
details.more summary{cursor:pointer;font-size:.8125rem;color:var(--brand);font-weight:500}
.explain{margin-top:1.5rem;font-size:.875rem;color:var(--ink-2)}
.explain h2{font-size:1rem;font-weight:700;color:var(--ink);margin:1.25rem 0 .4rem}
.explain p{margin:0 0 .6rem;max-width:62ch}
.index-list{list-style:none;margin:1.25rem 0 0;padding:0;display:grid;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:3px;overflow:hidden}
.index-list li{background:var(--card)}
.index-list a{display:block;padding:.9rem 1.1rem;text-decoration:none;color:inherit}
.index-list a:hover{background:var(--brand-bg)}
.index-list b{display:block;font-weight:700}
.index-list span{font-size:.8125rem;color:var(--ink-3)}
footer.note{margin-top:2.25rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.75rem;color:var(--ink-3)}
footer.note p{margin:0 0 .5rem}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function adsense() {
  if (!SITE.adsensePublisherId) return "";
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${SITE.adsensePublisherId}" crossorigin="anonymous"></script>`;
}

/**
 * @param {{title:string,description:string,canonical:string,body:string,script?:string}} p
 */
export function page(p) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${p.description}">
<link rel="canonical" href="${SITE.origin}${p.canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.description}">
<meta property="og:url" content="${SITE.origin}${p.canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;500;700;900&family=Roboto+Mono:wght@400;500;700&display=swap">
<style>${CSS}</style>
${adsense()}
</head>
<body>
<div class="wrap">
${p.body}
<footer class="note">
<p><b>본 계산기는 참고용입니다.</b> 법령은 개정되며, 실제 적용 시에는 국가법령정보센터에서 시행일 기준 현행 조문과 별표를 직접 확인하십시오. 계산 결과에 따른 판단의 책임은 이용자에게 있습니다.</p>
<p>입력값은 브라우저 안에서만 계산되며 어디에도 전송되지 않습니다.</p>
</footer>
</div>
${p.script ? `<script>${p.script}</script>` : ""}
</body>
</html>`;
}

/** 도구 페이지 공통 머리말 */
export function toolHeader(tool) {
  return `<header class="top">
<span class="kicker"><a href="/">${SITE.name}</a></span>
<h1>${tool.h1}</h1>
<p>${tool.lede}</p>
</header>`;
}
