// 로컬 미리보기 서버 — 배포 없이 화면을 그대로 열어 본다.
//   node tools/dev.mjs            → http://localhost:8788
//   node tools/dev.mjs 9000       → 포트 지정
// R2는 메모리로 흉내 낸다(test.mjs의 mkR2와 같은 모양). 서버를 끄면 데이터도 사라진다.
// 관리자 비번은 dev1234. 명단·수량은 아래 SEED로 미리 채워 둔다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost } from '../functions/api/book.js';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.argv[2] || 8788);

function mkR2() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v ? { text: async () => v.body } : null; },
    async put(k, body, o = {}) { m.set(k, { body, customMetadata: o.customMetadata || {} }); return {}; },
    async delete(k) { m.delete(k); return {}; },
    async list({ prefix, cursor }) {
      const objects = [...m.entries()].filter(([k]) => k.startsWith(prefix))
        .map(([key, v]) => ({ key, customMetadata: v.customMetadata }));
      return { objects, truncated: false, cursor };
    },
  };
}

const env = { R2: mkR2(), BOOK_PIN: 'dev1234' };

const SEED_ROSTER = {
  '1234': { g: 'a', n: '김예울' },   // 조재혁 피아노 리사이틀 · 9/12
  '5678': { g: 'b', n: '이마루' },   // 트리플 빌 · 10/14
  '9012': { g: 'c', n: '박여수' },   // 피아노 피아노 · 10/27
  '3456': { g: 'b', n: '' },        // 이름 없는 예매자
  '7777': { g: 'a', n: '최마감' },   // 마감 화면 확인용
  '4650': { g: 'a', n: '황세웅' },   // 운영자 테스트용
};
await env.R2.put('booking/roster.json', JSON.stringify(SEED_ROSTER));
await env.R2.put('booking/stock.json', JSON.stringify({
  cap: { a: { double: 5, twin: 5 }, b: { double: 8, twin: 7 }, c: { double: 8, twin: 7 } },
  labels: { a: '9/12', b: '10/14', c: '10/27' },
  shows: {
    a: { title: '음반발매기념 〈조재혁 피아노 리사이틀〉', date: '2026-09-12', time: '17:00', hall: 'GS칼텍스 예울마루 대극장' },
    b: { title: '국립현대무용단 〈트리플 빌〉', date: '2026-10-14', time: '19:30', hall: 'GS칼텍스 예울마루 대극장' },
    c: { title: '다비드 바뱅 & 아드리앙 몽도 〈피아노 피아노〉', date: '2026-10-27', time: '19:30', hall: 'GS칼텍스 예울마루 대극장' },
  },
}));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/book') {
    if (req.method !== 'POST') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"hello":"booking"}'); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    const r = await onRequestPost({ request: { json: async () => JSON.parse(text) }, env });
    const body = await r.text();
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(body);
  }

  // 개발 편의: 재고를 특정 상태로 몰아 놓고 화면을 본다.
  //   /_seed?full=a-double   해당 구분·종류를 마감시킨다
  if (url.pathname === '/_seed') {
    const spec = String(url.searchParams.get('full') || '');
    const [g, t] = spec.split('-');
    if (g && t) {
      const cap = JSON.parse(await (await env.R2.get('booking/stock.json')).text()).cap[g] || {};
      const base = t === 'double' ? 8000 : 8500;   // 종류별로 번호대를 갈라 서로 덮어쓰지 않게
      for (let i = 0; i < (cap[t] || 0); i++) {
        const p4 = String(base + i);
        await env.R2.put('booking/bk/' + p4 + '.json',
          JSON.stringify({ p4, name: '더미' + i, group: g, type: t, typeName: t, at: Date.now() }),
          { customMetadata: { g, t, at: String(Date.now()) } });
      }
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('seeded ' + spec);
  }

  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(join(ROOT, p.replace(/^\/+/, '')));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(PORT, () => {
  console.log('고객 화면   http://localhost:' + PORT + '/');
  console.log('관리자 화면 http://localhost:' + PORT + '/admin.html   (비번 dev1234)');
  console.log('시드 번호   4650(9/12 황세웅) · 1234(9/12 김예울) · 5678(10/14 이마루) · 9012(10/27 박여수) · 3456 · 7777');
});
