// GitHub Pages 용 미리보기 페이지를 만든다.
//   node tools/preview.mjs            → preview/index.html
//
// public/index.html 을 그대로 가져다 **서버 호출만** 메모리 흉내로 바꾼다.
// 화면 코드는 한 줄도 안 고친다 — 미리보기가 실물과 어긋나면 미리보기가 아니다.
//
// ⚠ 이건 보여주기용이다. 정적 호스팅이라 서버가 없고, 따라서
//   · 저장은 그 사람 브라우저 안에서만 일어난다(새로고침하면 사라진다)
//   · 남은 수량이 사람들 사이에 공유되지 않는다
//   실제 운영 링크는 서버가 있는 곳(README §4 · Cloudflare Pages + R2)에 올려야 한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const src = readFileSync(ROOT + 'public/index.html', 'utf8');

const cut = (label, needle) => {
  if (!src.includes(needle)) {
    console.error(`✗ public/index.html 에서 ${label} 를 못 찾았다. 화면을 고쳤으면 이 스크립트도 같이 맞춰라.`);
    process.exit(1);
  }
};

// ── 1. 서버 호출 → 메모리 흉내 ───────────────────────────────
const OLD_API = `  function api(body) {
    return fetch('/api/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).catch(function () {
      return { ok: false, msg: '연결이 불안정해요. 잠시 뒤 다시 눌러 주세요.' };
    });
  }`;
cut('api() 블록', OLD_API);

const NEW_API = `  /* ── 미리보기 전용: 서버 대신 이 브라우저 안에서 답한다 ──────────────
     실제 배포본은 이 자리에서 /api/book 을 부르고, 재고는 R2 에서 모두가 공유한다. */
  var D = {
    roster: { '4650': { g: 'a', n: '황세웅' }, '1234': { g: 'a', n: '김예울' },
              '1111': { g: 'a', n: '테스트1' }, '2222': { g: 'a', n: '테스트2' },
              '3333': { g: 'a', n: '테스트3' }, '5555': { g: 'a', n: '테스트4' },
              '5678': { g: 'b', n: '이마루' }, '9012': { g: 'c', n: '박여수' }, '3456': { g: 'b', n: '' } },
    cap:  { a: { double: 5, twin: 5 }, b: { double: 8, twin: 7 }, c: { double: 8, twin: 7 } },
    shows: {
      a: { title: '음반발매기념 〈조재혁 피아노 리사이틀〉', date: '2026-09-12', time: '17:00' },
      b: { title: '국립현대무용단 〈트리플 빌〉', date: '2026-10-14', time: '19:30' },
      c: { title: '다비드 바뱅 & 아드리앙 몽도 〈피아노 피아노〉', date: '2026-10-27', time: '19:30' }
    },
    bk: {}
  };
  var TN = { double: '스탠다드 더블', twin: '스탠다드 트윈' };
  function dStayOf(g) {
    var s = D.shows[g], a = s.date.split('-').map(Number);
    var o = new Date(Date.UTC(a[0], a[1] - 1, a[2] + 1)), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return { title: s.title, date: s.date, time: s.time, checkIn: s.date,
             checkOut: o.getUTCFullYear() + '-' + p(o.getUTCMonth() + 1) + '-' + p(o.getUTCDate()) };
  }
  function dLeft(g) {
    var r = {};
    ['double', 'twin'].forEach(function (t) {
      var used = 0;
      for (var k in D.bk) if (D.bk[k].group === g && D.bk[k].type === t) used++;
      r[t] = Math.max(0, D.cap[g][t] - used);
    });
    return r;
  }
  function api(body) {
    return new Promise(function (res) { setTimeout(function () { res(mock(body)); }, 460); });
  }
  function mock(b) {
    var p4 = String(b.p4 || '').replace(/[^0-9]/g, '');
    if (b.op === 'auth') {
      if (!/^[0-9]{4}$/.test(p4)) return { ok: false, code: 'badp4', msg: '숫자 4자리를 입력해 주세요.' };
      var who = D.roster[p4];
      if (!who) return { ok: false, code: 'notfound', msg: '예매자 명단에서 찾지 못했어요. 번호를 다시 확인해 주세요.' };
      var stay = dStayOf(who.g);
      if (D.bk[p4]) return { ok: true, done: true, name: who.n, stay: stay, booking: D.bk[p4] };
      return { ok: true, done: false, name: who.n, stay: stay, left: dLeft(who.g) };
    }
    if (b.op === 'book') {
      var w = D.roster[p4];
      if (!w) return { ok: false, code: 'notfound', msg: '예매자 명단에서 찾지 못했어요.' };
      if (D.bk[p4]) return { ok: false, code: 'already', msg: '이미 선택을 마치셨어요.', booking: D.bk[p4], stay: dStayOf(w.g) };
      var t = b.type, st = dStayOf(w.g);
      if (dLeft(w.g)[t] <= 0) return { ok: false, code: 'soldout', msg: '방금 마감됐어요. 남은 객실로 다시 골라 주세요.', left: dLeft(w.g) };
      D.bk[p4] = { p4: p4, name: w.n, group: w.g, type: t, typeName: TN[t], at: Date.now(),
                   show: st.title, stayDate: st.checkIn, stayOut: st.checkOut };
      return { ok: true, booking: D.bk[p4], stay: st };
    }
    return { ok: false, code: 'badop' };
  }`;

// ── 2. 미리보기 조작 줄 ─────────────────────────────────────
const DEMO_CSS = `
  /* ── 미리보기 전용 (배포본에는 없다) ── */
  .demo { background: #0a2a38; border-bottom: 1px dashed rgba(127,227,214,.34); padding: 12px 14px; }
  .demo .lb { font-size: 10.5px; font-weight: 800; letter-spacing: 1.4px; color: #7fe3d6; margin-bottom: 8px; }
  .demo .ch { display: flex; gap: 6px; flex-wrap: wrap; }
  .demo button {
    min-height: 0; width: auto; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(127,227,214,.3);
    background: rgba(127,227,214,.09); color: #d8f2ee; font: 700 12px/1.3 inherit; cursor: pointer;
  }
  .demo button:hover { background: rgba(127,227,214,.19); }
  .demo button.rs { border-color: rgba(255,255,255,.22); background: transparent; color: #9fb8c0; }
  .demo em { display: block; margin-top: 9px; font-style: normal; font-size: 11.5px; color: #7f9aa4; line-height: 1.6; }
  .demo em b { color: #b7d6d2; font-weight: 700; }
`;
const DEMO_HTML = `
  <div class="demo">
    <div class="lb">미리보기 · 저장은 이 브라우저 안에서만 됩니다</div>
    <div class="ch">
      <button type="button" data-demo="4650">4650 황세웅 · 9/12</button>
      <button type="button" data-demo="5678">5678 이마루 · 10/14</button>
      <button type="button" data-demo="9012">9012 박여수 · 10/27</button>
      <button type="button" data-demo="0000">0000 명단 밖</button>
      <button type="button" class="rs" data-back="1">다른 번호로</button>
      <button type="button" class="rs" data-reset="1">재고 초기화</button>
    </div>
    <em>조재혁 5/5 · 트리플 빌 8/7 · 피아노 피아노 8/7 로 시작합니다.
      「다른 번호로」는 <b>재고를 그대로 두고</b> 1단계로 돌아갑니다 — 수량이 줄어드는 걸 확인하실 수 있어요.<br>
      <b>1234 · 1111 · 2222 · 3333 · 5555</b> 도 조재혁(9/12)입니다. 다섯이 더블을 다 채우면 <b>마감</b>을 보실 수 있어요.<br>
      <b>실제 고객 링크가 아닙니다</b> — 새로고침하면 사라지고, 사람들 사이에 수량이 공유되지 않습니다.</em>
  </div>
`;
const DEMO_JS = `
  /* 미리보기 조작 */
  document.querySelector('.demo').addEventListener('click', function (e) {
    var t = e.target.closest('[data-demo],[data-back],[data-reset]');
    if (!t) return;
    if (t.hasAttribute('data-back') || t.hasAttribute('data-reset')) {
      if (t.hasAttribute('data-reset')) D.bk = {};
      state.p4 = ''; state.pick = ''; p4El.value = '';
      paintDots(); say($('m1'), ''); say($('m2'), ''); hideConfirm(); show(1); p4El.focus();
      return;
    }
    p4El.value = t.getAttribute('data-demo'); paintDots(); say($('m1'), '');
    if (!goEl.disabled) goEl.click();
  });
`;

const ANCHOR_CSS = '  .hide { display: none !important; }';
const ANCHOR_HTML = '<div class="wrap">\n\n  <header class="hero">';
const ANCHOR_JS = '  paintDots();\n  p4El.focus();';
cut('CSS 붙일 자리', ANCHOR_CSS);
cut('본문 붙일 자리', ANCHOR_HTML);
cut('스크립트 붙일 자리', ANCHOR_JS);

let out = src
  .replace(OLD_API, NEW_API)
  .replace(ANCHOR_CSS, DEMO_CSS + '\n' + ANCHOR_CSS)
  .replace(ANCHOR_HTML, '<div class="wrap">\n' + DEMO_HTML + '\n  <header class="hero">')
  .replace(ANCHOR_JS, DEMO_JS + '\n' + ANCHOR_JS)
  .replace('<title>객실 선택 · 예울마루 STAY 패키지</title>',
           '<title>[미리보기] 객실 선택 · 예울마루 STAY 패키지</title>');

// 검색엔진에 노출되면 고객이 잘못 들어온다
if (!out.includes('name="robots"')) {
  console.error('✗ robots 메타가 없다. 미리보기가 검색에 잡히면 안 된다.');
  process.exit(1);
}

mkdirSync(ROOT + 'preview', { recursive: true });
writeFileSync(ROOT + 'preview/index.html', out);
writeFileSync(ROOT + 'preview/.nojekyll', '');   // GitHub Pages 가 _ 로 시작하는 파일을 안 버리게
console.log('preview/index.html 만들었다 ·', out.length, 'bytes');
