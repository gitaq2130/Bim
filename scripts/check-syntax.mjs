// app/js, app/tools 의 모든 ES 모듈 문법 검사
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const dirs = ['app/js', 'app/tools'];
let fail = 0, n = 0;
for (const d of dirs) for (const f of readdirSync(d).filter(f => f.endsWith('.js'))) {
  n++;
  try { execFileSync(process.execPath, ['--check', join(d, f)], { stdio: 'pipe' }); }
  catch (e) { fail++; console.error(`✗ ${join(d, f)}\n${e.stderr}`); }
}
console.log(fail ? `✗ ${fail}/${n}개 파일 문법 오류` : `✓ ${n}개 파일 문법 정상`);
process.exit(fail ? 1 : 0);
