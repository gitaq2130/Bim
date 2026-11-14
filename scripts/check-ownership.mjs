// 브랜치가 자기 트랙 밖의 파일을 고쳤는지 검사한다.
// 사용: node scripts/check-ownership.mjs [base-ref] [branch-name]
import { execSync } from 'node:child_process';
import { TRACKS, ownerOf } from './owners.mjs';

const base = process.argv[2] || 'origin/builder/main';
const branch = process.argv[3] || process.env.GITHUB_HEAD_REF || execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
const track = Object.entries(TRACKS).find(([, t]) => t.branch === branch || branch.startsWith(t.branch + '-') || branch.startsWith(t.branch + '/'))?.[0];

if (!track) { console.log(`브랜치 ${branch}: 트랙 브랜치가 아님 — 검사 생략`); process.exit(0); }
if (track === 'core') { console.log('core 트랙: 모든 파일 수정 가능'); process.exit(0); }

let changed;
try { changed = execSync(`git diff --name-only ${base}...HEAD`).toString().split('\n').filter(Boolean); }
catch { console.log(`기준 ${base}를 찾지 못해 검사 생략`); process.exit(0); }

const bad = changed.filter(f => { const o = ownerOf(f); return o !== track && o !== 'shared'; });
if (bad.length) {
  console.error(`✗ [${TRACKS[track].name}] 트랙이 소유하지 않은 파일을 수정했습니다:`);
  for (const f of bad) console.error(`   ${f}  (소유: ${ownerOf(f)})`);
  console.error('\n→ 코어 변경은 docs/CORE.md의 "코어 변경 요청" 절차로 허브 트랙에 요청하세요.');
  process.exit(1);
}
console.log(`✓ [${TRACKS[track].name}] 변경 ${changed.length}개 파일 모두 트랙 소유 범위 안`);
