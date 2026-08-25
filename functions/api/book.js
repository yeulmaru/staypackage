// 예울마루 STAY 패키지 — 객실 선택 서버 한 자리.
// 저장소 = Cloudflare R2(바인딩 이름 `R2`). 키 접두 `booking/`.
//   booking/roster.json        명단   { "1234": {g:"a", n:"홍길동"}, ... }
//   booking/stock.json         재고   { labels:{a:"9/12"}, shows:{a:{title,date,time,hall}}, cap:{ a:{double:5,twin:5}, ... } }
//   booking/bk/<뒷4자리>.json   예약 1건 = 객체 1개
//
// 구분(g) = 예매한 공연 1종 = 숙박일. 「예매일 당일 숙박」이 상품 조건이라 공연 날짜가 곧 체크인 날짜다.
// 고객이 날짜를 고르는 화면은 없다 — 명단(roster)에 어느 공연을 예매했는지가 이미 박혀 있고, 그 하루만 열린다.
//
// ⚠ 자리 차감의 안전장치 = 「예약 1건 = 파일 1개」 + 사후 양보.
//   재고 총량을 한 파일에 적고 빼면 두 사람이 동시에 눌렀을 때 서로 덮어써서 한 건이 사라진다.
//   그래서 각자 자기 이름의 파일을 만들고(키가 유일해서 충돌 자체가 불가능),
//   쓴 뒤 전체를 다시 세어 「내가 정원 안에 드는가」를 확인한다. 밀렸으면 내 파일을 지우고 마감으로 답한다.
//   정렬 기준이 (시각, 뒷4자리)라 두 요청이 같은 판정을 내리므로 한쪽만 살아남는다.
// 집계는 목록 조회 1번으로 끝낸다(파일마다 g/t/at 을 메타로 붙여 둔다 = 내용을 열어볼 필요 없음).

const PFX = 'booking/';
const BK = PFX + 'bk/';
const TYPES = ['double', 'twin'];
const TYPE_NM = { double: '스탠다드 더블', twin: '스탠다드 트윈' };
const TYPE_DESC = { double: '큰 침대 1개', twin: '싱글 침대 2개' };

// 기본값 = 홍보물 실제 값 (총 40세트 · 조재혁 10 / 트리플 빌 15 / 피아노 피아노 15)
const DEFAULT_CAP = { a: { double: 5, twin: 5 }, b: { double: 8, twin: 7 }, c: { double: 8, twin: 7 } };
const DEFAULT_LABELS = { a: '9/12', b: '10/14', c: '10/27' };
const DEFAULT_SHOWS = {
  a: { title: '음반발매기념 〈조재혁 피아노 리사이틀〉', date: '2026-09-12', time: '17:00', hall: 'GS칼텍스 예울마루 대극장' },
  b: { title: '국립현대무용단 〈트리플 빌〉', date: '2026-10-14', time: '19:30', hall: 'GS칼텍스 예울마루 대극장' },
  c: { title: '다비드 바뱅 & 아드리앙 몽도 〈피아노 피아노〉', date: '2026-10-27', time: '19:30', hall: 'GS칼텍스 예울마루 대극장' },
};

const J = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const p4ok = (v) => typeof v === 'string' && /^[0-9]{4}$/.test(v);
const dateok = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function readJson(env, key, dflt) {
  try {
    const o = await env.R2.get(PFX + key);
    if (!o) return dflt;
    const v = JSON.parse(await o.text());
    return (v && typeof v === 'object') ? v : dflt;
  } catch { return dflt; }
}

async function getStock(env) {
  const s = await readJson(env, 'stock.json', null);
  const cap = (s && s.cap) || DEFAULT_CAP;
  const labels = (s && s.labels) || DEFAULT_LABELS;
  const shows = (s && s.shows) || DEFAULT_SHOWS;
  return { cap, labels, shows };
}

// 공연 1종 = 숙박일 1일. 체크아웃은 그 다음 날.
function stayOf(shows, g) {
  const s = (shows && shows[g]) || null;
  if (!s || !dateok(s.date)) return null;
  const [y, m, d] = s.date.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d + 1));
  const p = (n) => (n < 10 ? '0' : '') + n;
  return {
    title: s.title || '',
    date: s.date,
    time: s.time || '',
    hall: s.hall || '',
    checkIn: s.date,
    checkOut: out.getUTCFullYear() + '-' + p(out.getUTCMonth() + 1) + '-' + p(out.getUTCDate()),
  };
}

// 예약 전건 = 목록 1회(메타 동봉). 40건 규모라 페이지 넘김은 안전망으로만 둔다.
async function listBookings(env) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const l = await env.R2.list({ prefix: BK, include: ['customMetadata'], cursor });
    for (const o of l.objects) {
      const m = o.customMetadata || {};
      const p4 = o.key.slice(BK.length).replace(/\.json$/, '');
      out.push({ p4, g: m.g || '', t: m.t || '', at: Number(m.at || 0) || 0 });
    }
    if (!l.truncated) break;
    cursor = l.cursor;
  }
  return out;
}

const countUsed = (all, g, t) => all.filter(b => b.g === g && b.t === t).length;

function leftOf(cap, all, g) {
  const c = cap[g] || {};
  const r = {};
  for (const t of TYPES) r[t] = Math.max(0, (Number(c[t]) || 0) - countUsed(all, g, t));
  return r;
}

async function readBooking(env, p4) {
  try {
    const o = await env.R2.get(BK + p4 + '.json');
    if (!o) return null;
    return JSON.parse(await o.text());
  } catch { return null; }
}

async function reserve(env, p4, name, g, t, cap, stay) {
  const dup = await readBooking(env, p4);
  if (dup) return { ok: false, code: 'already', booking: dup };

  const limit = Number((cap[g] || {})[t]) || 0;
  if (limit <= 0) return { ok: false, code: 'soldout' };

  let all = await listBookings(env);
  if (countUsed(all, g, t) >= limit) return { ok: false, code: 'soldout' };

  const at = Date.now();
  const rec = {
    p4, name: name || '', group: g, type: t, typeName: TYPE_NM[t], at,
    // 선택 당시의 공연·숙박일을 예약 건에 박아 둔다(나중에 명단을 바꿔도 접수 내용은 안 흔들린다)
    show: stay ? stay.title : '', stayDate: stay ? stay.checkIn : '', stayOut: stay ? stay.checkOut : '',
  };
  await env.R2.put(BK + p4 + '.json', JSON.stringify(rec), {
    customMetadata: { g, t, at: String(at) },
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  // 사후 양보 — 같은 순간에 들어온 사람이 있으면 앞선 순서만 남는다.
  all = await listBookings(env);
  const same = all.filter(b => b.g === g && b.t === t)
    .sort((x, y) => (x.at - y.at) || (x.p4 < y.p4 ? -1 : 1));
  const idx = same.findIndex(b => b.p4 === p4);
  if (idx < 0 || idx >= limit) {
    try { await env.R2.delete(BK + p4 + '.json'); } catch { /* 지우기 실패해도 아래 응답이 우선 */ }
    return { ok: false, code: 'soldout' };
  }
  return { ok: true, booking: rec };
}

// ── 관리자 ────────────────────────────────────────────────────────────
function adminOk(env, pin) {
  const want = env.BOOK_PIN;
  if (!want) return { ok: false, code: 'nopin' };          // 변수 미설정 = 관리자 기능 통째 잠금(빈 비번으로 열리는 일 없음)
  if (typeof pin !== 'string' || pin !== want) return { ok: false, code: 'badpin' };
  return { ok: true };
}

// 명단 붙여넣기 한 덩이 → { "1234": {g,n} }
// 한 줄에 「뒷4자리, 공연(a·b·c), 이름」. 구분자는 쉼표·탭·세미콜론 아무거나. 이름은 없어도 된다.
function parseRoster(text) {
  const map = {};
  const dups = [];
  const bad = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#/.test(line)) continue;
    const cell = line.split(/[,\t;]/).map(s => s.trim());
    const p4 = (cell[0] || '').replace(/[^0-9]/g, '').slice(-4);
    const g = (cell[1] || '').trim().toLowerCase();
    const n = (cell[2] || '').trim();
    if (!p4ok(p4) || !g) { bad.push(line); continue; }
    if (map[p4]) { dups.push(p4); continue; }            // 중첩은 뒤엣것을 버리고 알린다(운영자가 따로 정한다고 한 자리)
    map[p4] = { g, n };
  }
  return { map, dups, bad };
}

// ── 입구 ─────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  if (!env || !env.R2) return J({ ok: false, code: 'nostore', msg: '저장소(R2)가 연결되지 않았어. 배포 설정에서 R2 바인딩 이름을 R2 로 연결해줘.' }, 500);

  let b;
  try { b = await request.json(); } catch { return J({ ok: false, code: 'badreq' }, 400); }
  const op = String((b && b.op) || '');

  try {
    // 고객 축 —————————————————————————————
    if (op === 'auth') {
      const p4 = String((b.p4 || '')).replace(/[^0-9]/g, '');
      if (!p4ok(p4)) return J({ ok: false, code: 'badp4', msg: '숫자 4자리를 입력해 주세요.' });

      const roster = await readJson(env, 'roster.json', {});
      const who = roster[p4];
      if (!who) return J({ ok: false, code: 'notfound', msg: '예매자 명단에서 찾지 못했어요. 번호를 다시 확인해 주세요.' });

      const { cap, labels, shows } = await getStock(env);
      const stay = stayOf(shows, who.g);
      const mine = await readBooking(env, p4);
      if (mine) return J({ ok: true, done: true, name: who.n || '', label: labels[who.g] || '', stay, booking: mine });

      const all = await listBookings(env);
      return J({
        ok: true, done: false, name: who.n || '', label: labels[who.g] || '', stay,
        left: leftOf(cap, all, who.g), typeName: TYPE_NM, typeDesc: TYPE_DESC,
      });
    }

    if (op === 'book') {
      const p4 = String((b.p4 || '')).replace(/[^0-9]/g, '');
      const t = String(b.type || '');
      if (!p4ok(p4)) return J({ ok: false, code: 'badp4' });
      if (!TYPES.includes(t)) return J({ ok: false, code: 'badtype' });

      const roster = await readJson(env, 'roster.json', {});
      const who = roster[p4];
      if (!who) return J({ ok: false, code: 'notfound', msg: '예매자 명단에서 찾지 못했어요.' });

      const { cap, labels, shows } = await getStock(env);
      const stay = stayOf(shows, who.g);
      const r = await reserve(env, p4, who.n, who.g, t, cap, stay);
      if (!r.ok && r.code === 'soldout') {
        const all = await listBookings(env);
        return J({ ok: false, code: 'soldout', msg: '방금 마감됐어요. 남은 객실로 다시 골라 주세요.', left: leftOf(cap, all, who.g) });
      }
      if (!r.ok) return J({ ok: false, code: r.code, msg: '이미 선택을 마치셨어요.', booking: r.booking, label: labels[who.g] || '', stay });
      return J({ ok: true, booking: r.booking, label: labels[who.g] || '', stay });
    }

    // 관리자 축 ——————————————————————————
    const a = adminOk(env, b.pin);
    if (!a.ok) {
      if (a.code === 'nopin') return J({ ok: false, code: 'nopin', msg: '관리자 비번(BOOK_PIN)이 아직 설정되지 않았어. 배포 설정의 환경 변수에 넣어줘.' }, 403);
      return J({ ok: false, code: 'badpin', msg: '비번이 달라.' }, 403);
    }

    if (op === 'admin_get') {
      const [roster, { cap, labels, shows }, all] = await Promise.all([
        readJson(env, 'roster.json', {}), getStock(env), listBookings(env),
      ]);
      const rows = [];
      for (const x of all) {
        const rec = await readBooking(env, x.p4);
        if (rec) rows.push(rec);
      }
      rows.sort((x, y) => y.at - x.at);
      const left = {};
      const stay = {};
      for (const g of Object.keys(cap)) { left[g] = leftOf(cap, all, g); stay[g] = stayOf(shows, g); }
      // 명단은 있는데 아직 안 고른 사람 = 재안내 대상
      const chosen = new Set(all.map(x => x.p4));
      const pending = Object.keys(roster).filter(p => !chosen.has(p))
        .map(p => ({ p4: p, g: roster[p].g, name: roster[p].n || '' }))
        .sort((x, y) => (x.g < y.g ? -1 : x.g > y.g ? 1 : (x.p4 < y.p4 ? -1 : 1)));
      return J({
        ok: true, cap, labels, shows, stay, left, rows, pending,
        rosterCount: Object.keys(roster).length, typeName: TYPE_NM,
      });
    }

    if (op === 'admin_roster') {
      const { map, dups, bad } = parseRoster(b.text);
      await env.R2.put(PFX + 'roster.json', JSON.stringify(map), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      });
      return J({ ok: true, count: Object.keys(map).length, dups, bad });
    }

    // 명단 한 명씩 고치기 — 통째 교체(admin_roster)와 달리 나머지는 손대지 않는다.
    // set 은 추가와 수정을 겸한다(같은 뒷4자리면 덮어쓴다). del 은 명단에서만 뺀다.
    if (op === 'admin_roster_edit') {
      const roster = await readJson(env, 'roster.json', {});
      const set = (b.set && typeof b.set === 'object') ? b.set : {};
      const del = Array.isArray(b.del) ? b.del : [];
      const saved = [], removed = [], bad = [], missing = [];
      for (const k of Object.keys(set)) {
        const p4 = String(k).replace(/[^0-9]/g, '').slice(-4);
        const src = set[k] || {};
        const g = String(src.g || '').trim().toLowerCase();
        const n = String(src.n == null ? '' : src.n).trim();
        if (!p4ok(p4) || !g) { bad.push(String(k)); continue; }
        roster[p4] = { g, n };
        saved.push(p4);
      }
      for (const k of del) {
        const p4 = String(k).replace(/[^0-9]/g, '').slice(-4);
        if (roster[p4]) { delete roster[p4]; removed.push(p4); }
        else missing.push(p4);
      }
      await env.R2.put(PFX + 'roster.json', JSON.stringify(roster), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      });
      // 명단에서 빼도 이미 고른 객실은 안 지운다 — 자리를 비우려면 admin_cancel 을 따로 불러야 한다.
      const all = await listBookings(env);
      const booked = new Set(all.map(x => x.p4));
      const stillBooked = removed.filter(p => booked.has(p));
      return J({ ok: true, count: Object.keys(roster).length, saved, removed, bad, missing, stillBooked });
    }

    if (op === 'admin_stock') {
      const prev = await getStock(env);
      const cap = {};
      const src = (b.cap && typeof b.cap === 'object') ? b.cap : {};
      for (const g of Object.keys(src)) {
        const key = String(g).trim().toLowerCase();
        if (!key) continue;
        cap[key] = {};
        for (const t of TYPES) cap[key][t] = Math.max(0, Math.floor(Number((src[g] || {})[t]) || 0));
      }
      const labels = {};
      const ls = (b.labels && typeof b.labels === 'object') ? b.labels : {};
      for (const g of Object.keys(cap)) labels[g] = String(ls[g] || DEFAULT_LABELS[g] || g.toUpperCase()).slice(0, 20);

      // 공연·날짜는 보내온 것만 갈아끼우고 나머지는 지금 값을 지킨다(수량만 고치다 날짜가 날아가지 않게).
      const shows = {};
      const ss = (b.shows && typeof b.shows === 'object') ? b.shows : {};
      for (const g of Object.keys(cap)) {
        const inc = (ss[g] && typeof ss[g] === 'object') ? ss[g] : null;
        const old = prev.shows[g] || DEFAULT_SHOWS[g] || {};
        const date = inc && dateok(String(inc.date || '')) ? String(inc.date) : (old.date || '');
        shows[g] = {
          title: String((inc && inc.title) != null ? inc.title : (old.title || '')).slice(0, 120),
          date,
          time: String((inc && inc.time) != null ? inc.time : (old.time || '')).slice(0, 10),
          hall: String((inc && inc.hall) != null ? inc.hall : (old.hall || '')).slice(0, 60),
        };
      }
      await env.R2.put(PFX + 'stock.json', JSON.stringify({ cap, labels, shows }), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      });
      return J({ ok: true, cap, labels, shows });
    }

    if (op === 'admin_cancel') {
      const p4 = String((b.p4 || '')).replace(/[^0-9]/g, '');
      if (!p4ok(p4)) return J({ ok: false, code: 'badp4' });
      await env.R2.delete(BK + p4 + '.json');
      return J({ ok: true });
    }

    return J({ ok: false, code: 'badop' }, 400);
  } catch (e) {
    return J({ ok: false, code: 'err', msg: String((e && e.message) || e) }, 500);
  }
}

export const onRequestGet = () => J({ ok: true, hello: 'booking' });
