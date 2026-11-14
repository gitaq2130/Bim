// 프로젝트 저장소: Claude db(계정 보관) → localStorage → 메모리 순으로 사용
import { createBus } from './util.js';

const CHUNK = 60000; // 문자 단위 (한글 3바이트 기준 256KiB 이하)
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
// 동시 실행 제한 풀
async function pool(limit, items, fn, onDone) { let i = 0, done = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); done++; onDone?.(done, items.length); } }; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run)); }
const FATAL = /permission|unauthenticated|denied|invalid|too.?large|quota/i;

function localBackend() {
  let ls = null; try { ls = window.localStorage; ls.setItem('bld:t', '1'); ls.removeItem('bld:t'); } catch { ls = null; }
  const mem = new Map();
  const get = (k) => { try { const v = ls ? ls.getItem('bld:' + k) : mem.get(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const set = (k, v) => { const s = JSON.stringify(v); if (ls) { try { ls.setItem('bld:' + k, s); return; } catch (e) { throw { code: 'quota_exceeded', message: '브라우저 저장공간이 부족합니다' }; } } mem.set(k, s); };
  const del = (k) => { if (ls) ls.removeItem('bld:' + k); else mem.delete(k); };
  const metas = () => {
    const out = [];
    const keys = ls ? Object.keys(ls).filter(k => k.startsWith('bld:pm_') && !k.includes('.c')).map(k => k.slice(4)) : [...mem.keys()].filter(k => k.startsWith('pm_') && !k.includes('.c'));
    for (const k of keys) { const v = get(k); if (v?.type === 'meta') out.push(v); }
    return out;
  };
  return { kind: ls ? 'local' : 'memory', get: async (k) => get(k), set: async (k, v) => set(k, v), del: async (k) => del(k), metas: async () => metas() };
}

function dbBackend(db, id) {
  const col = db.collection('data/users/' + id);
  const retry = async (fn) => { for (let a = 0; ; a++) { try { return await fn(); } catch (e) { if (a >= 4 || FATAL.test(String(e?.code || '') + ' ' + String(e?.message || ''))) throw e; await new Promise(r => setTimeout(r, 400 * Math.pow(2.2, a) + Math.random() * 400)); } } };
  return {
    kind: 'db',
    get: async (k) => { const s = await retry(() => col.doc(k).get()); return s.exists ? s.data() : null; },
    set: async (k, v) => retry(() => col.doc(k).set(v)),
    del: async (k) => retry(() => col.doc(k).delete()),
    metas: async () => { const q = await retry(() => col.where('type', '==', 'meta').get()); return q.docs.map(d => d.data()); },
  };
}

export function createStore() {
  const bus = createBus();
  let B = null; const counts = new Map(); let queue = Promise.resolve();
  const dirty = new Map(); let timer = null; let current = null; let fails = 0;

  async function writeBlob(key, header, str) {
    const n = Math.max(1, Math.ceil(str.length / CHUNK));
    await pool(4, Array.from({ length: n }, (_, i) => i), (i) => B.set(`${key}.c${i}`, { d: str.slice(i * CHUNK, (i + 1) * CHUNK) }));
    await B.set(key, { ...header, n, size: str.length, updated: Date.now() });
    const old = counts.get(key) || 0; for (let i = n; i < old; i++) await B.del(`${key}.c${i}`).catch(() => { });
    counts.set(key, n);
  }
  async function readBlob(key) {
    const h = await B.get(key); if (!h) return null; counts.set(key, h.n);
    const parts = new Array(h.n); await pool(4, Array.from({ length: h.n }, (_, i) => i), async (i) => { const c = await B.get(`${key}.c${i}`); if (!c) throw new Error('데이터 조각 누락: ' + key); parts[i] = c.d; });
    return JSON.parse(parts.join(''));
  }
  async function delBlob(key) {
    const h = await B.get(key); const n = h?.n || counts.get(key) || 0;
    for (let i = 0; i < n; i++) await B.del(`${key}.c${i}`); await B.del(key); counts.delete(key);
  }
  const mk = (pid) => `pm_${pid}`, sk = (pid, sid) => `ps_${pid}_${sid}`;
  const metaOf = (P) => { const { content, ...m } = P; return m; };
  const enqueue = (fn) => (queue = queue.then(fn, fn));

  async function flush() {
    clearTimeout(timer); timer = null;
    if (!dirty.size) return;
    const jobs = [...dirty.entries()]; dirty.clear();
    bus.emit('status', { state: 'saving' });
    try {
      await enqueue(async () => {
        for (const [P, set] of jobs) {
          P.updated = Date.now();
          const sheets = [...set].filter(w => w !== 'meta'); const big = sheets.length > 12;
          const head = (partial) => ({ type: 'meta', pid: P.id, id: P.id, name: P.name, sheets: P.sheets.length, ...(partial ? { partial: true } : {}) });
          // 큰 저장: 목록에 먼저 보이도록 메타를 먼저 기록(저장 중 표시) → 도면 병렬 저장 → 메타 완료 기록
          if (big) await writeBlob(mk(P.id), head(true), JSON.stringify(metaOf(P)));
          await pool(6, sheets, async (what) => { if (P.content[what]) await writeBlob(sk(P.id, what), { type: 'sheet', pid: P.id }, JSON.stringify(P.content[what])); else await delBlob(sk(P.id, what)); }, (d, n) => { if (n > 12) bus.emit('status', { state: 'saving', done: d, total: n }); });
          await writeBlob(mk(P.id), head(false), JSON.stringify(metaOf(P)));
        }
      });
      fails = 0; bus.emit('status', { state: 'saved', at: Date.now() });
    } catch (e) {
      console.error(e); for (const [P, set] of jobs) { const s = dirty.get(P) || new Set(); set.forEach(x => s.add(x)); dirty.set(P, s); }
      bus.emit('status', { state: 'error', error: e });
      if (++fails <= 5) { clearTimeout(timer); timer = setTimeout(flush, 3000 * fails); } // 자동 재시도
    }
  }

  return {
    bus,
    get kind() { return B?.kind; },
    async init() {
      let db = null, user = null, id = null;
      if (window.claude?.use) {
        [db, user] = await Promise.all([withTimeout(window.claude.use('db'), 8000), withTimeout(window.claude.use('user'), 8000)]);
        if (user) id = await withTimeout(user.id(), 5000);
      }
      if (db && id) {
        B = dbBackend(db, id);
        try { await withTimeout(B.metas(), 10000); } catch (e) { console.warn('db 사용 불가, 로컬 저장으로 전환', e); B = localBackend(); }
      } else B = localBackend();
      return B.kind;
    },
    async list() { const m = await B.metas(); return m.sort((a, b) => (b.updated || 0) - (a.updated || 0)); },
    async load(pid) {
      const P = await readBlob(mk(pid)); if (!P) return null; P.content = {}; let missing = 0;
      await pool(8, P.sheets, async (s) => { let c = null; try { c = await readBlob(sk(pid, s.id)); } catch (e) { console.warn(e); } if (!c) missing++; P.content[s.id] = c || { ents: [], els: [] }; }, (d, n) => { if (n > 12) bus.emit('status', { state: 'loading', done: d, total: n }); });
      P._missing = missing; current = P; return P;
    },
    async saveAll(P) { const s = new Set(['meta', ...P.sheets.map(x => x.id)]); dirty.set(P, s); await flush(); },
    setCurrent(P) { current = P; },
    // 변경 표시: what = 'meta' | sheetId | [ ... ]
    touch(P, what = 'meta') {
      const s = dirty.get(P) || new Set(); (Array.isArray(what) ? what : [what]).forEach(w => s.add(w)); dirty.set(P, s);
      clearTimeout(timer); timer = setTimeout(flush, 1200); bus.emit('status', { state: 'pending' });
    },
    flush,
    async remove(pid) {
      await enqueue(async () => {
        const P = (current?.id === pid) ? current : await readBlob(mk(pid)).catch(() => null);
        for (const s of P?.sheets || []) await delBlob(sk(pid, s.id));
        for (const r of P?.prevs || []) await delBlob(`pr_${pid}_${r.id}`);
        for (const ph of P?.photos || []) { await delBlob(`ph_${pid}_${ph.id}`); await delBlob(`ph_${pid}_${ph.id}t`); }
        for (const u of Object.values(P?.underlays || {})) if (u?.key) await delBlob(u.key).catch(() => { });
        for (const i of P?.issues || []) if (i.snap) await delBlob(i.snap).catch(() => { });
        await delBlob(mk(pid));
      });
    },
    // 메타만 고쳐 이름 바꾸기 (도면 데이터는 그대로)
    async rename(pid, name) { await enqueue(async () => { const P = await readBlob(mk(pid)); if (!P) throw new Error('프로젝트를 찾지 못했습니다'); P.name = name; P.updated = Date.now(); await writeBlob(mk(pid), { type: 'meta', pid, id: pid, name, sheets: P.sheets.length }, JSON.stringify(P)); }); },
    async removeSheet(P, sid) { await enqueue(() => delBlob(sk(P.id, sid))); },
    hasPending: () => dirty.size > 0 || !!timer,
    // 리비전 등 큰 데이터: 별도 블롭
    async putBlob(key, obj, header = {}) { await enqueue(() => writeBlob(key, { type: 'blob', ...header }, JSON.stringify(obj))); },
    async getBlob(key) { return readBlob(key); },
    async dropBlob(key) { await enqueue(() => delBlob(key)); },
  };
}
