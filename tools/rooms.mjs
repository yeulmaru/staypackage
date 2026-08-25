#!/usr/bin/env node
// 객실 현황 조회 CLI — 관리자 GUI 없이 터미널에서 바로 본다.
//
//   node tools/rooms.mjs                남은 객실 현황 (기본)
//   node tools/rooms.mjs list           선택 완료한 사람 목록
//   node tools/rooms.mjs pending        아직 안 고른 사람 목록(재안내 대상)
//   node tools/rooms.mjs who 1234       한 사람 조회
//   node tools/rooms.mjs cancel 1234    선택 취소(자리 즉시 재개방)
//   node tools/rooms.mjs add 1234 b 홍길동   한 명 추가(같은 번호면 수정)
//   node tools/rooms.mjs move 1234 c         공연(=숙박일)만 바꾸기
//   node tools/rooms.mjs rm 1234             명단에서 빼기
//   node tools/rooms.mjs roster 명단.txt      명단 통째 교체
//   node tools/rooms.mjs csv            전체를 탭 구분으로(엑셀 붙여넣기용)
//   node tools/rooms.mjs all            현황 + 완료 + 미선택 한 번에
//
// 접속 정보는 아래 셋 중 하나로 준다(위가 우선):
//   1) 환경 변수      BOOK_URL, BOOK_PIN
//   2) 저장소 루트의  .booking.json   → { "url": "https://...", "pin": "..." }
//   3) --local        로컬 미리보기 서버(tools/dev.mjs · http://localhost:8788 · 비번 dev1234)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCAL = process.argv.includes('--local');
const argv = process.argv.slice(2).filter(a => a !== '--local');

function conf() {
  if (LOCAL) return { url: 'http://localhost:8788', pin: 'dev1234' };
  let f = {};
  try { f = JSON.parse(readFileSync(ROOT + '.booking.json', 'utf8')); } catch { /* 없으면 환경 변수로 */ }
  const url = (process.env.BOOK_URL || f.url || '').replace(/\/+$/, '');
  const pin = process.env.BOOK_PIN || f.pin || '';
  if (!url || !pin) {
    console.error(`
접속 정보가 없어. 둘 중 하나로 넣어줘.

  1) 저장소 루트에 .booking.json  (git에 안 올라간다)
     { "url": "https://내주소.pages.dev", "pin": "관리자비번" }

  2) 환경 변수
     BOOK_URL=https://내주소.pages.dev BOOK_PIN=관리자비번 node tools/rooms.mjs

  배포 전이면 로컬로 볼 수 있어:  node tools/dev.mjs   (다른 창)  →  node tools/rooms.mjs --local
`.trim());
    process.exit(2);
  }
  return { url, pin };
}

async function api(body) {
  const { url, pin } = conf();
  let r;
  try {
    r = await fetch(url + '/api/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, pin }),
    });
  } catch (e) {
    console.error('연결 실패:', url, '·', String(e.message || e));
    process.exit(1);
  }
  const j = await r.json().catch(() => ({ ok: false, msg: '응답을 읽지 못했어(HTTP ' + r.status + ')' }));
  if (!j.ok) {
    const hint = j.code === 'badpin' ? ' — 비번이 다르다.'
      : j.code === 'nopin' ? ' — 배포 설정에 BOOK_PIN 환경 변수가 없다.'
      : j.code === 'nostore' ? ' — R2 바인딩(이름 R2)이 안 붙어 있다.' : '';
    console.error('실패:', j.msg || j.code || '알 수 없는 오류', hint);
    process.exit(1);
  }
  return j;
}

/* ── 표 그리기 (한글은 두 칸으로 센다) ───────────────────── */
const w = (s) => [...String(s)].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const pad = (s, n, right) => { const g = Math.max(0, n - w(s)); return right ? ' '.repeat(g) + s : s + ' '.repeat(g); };
function table(head, rows, align = []) {
  if (!rows.length) return '  (없음)';
  const cols = head.map((h, i) => Math.max(w(h), ...rows.map(r => w(r[i] ?? ''))));
  const line = (cells) => '  ' + cells.map((c, i) => pad(c ?? '', cols[i], align[i] === 'r')).join('  ').replace(/\s+$/, '');
  return [line(head), '  ' + cols.map(n => '─'.repeat(n)).join('  '), ...rows.map(line)].join('\n');
}
const bar = (left, cap) => {
  const n = Math.max(0, Math.min(20, cap)), used = cap - left;
  return '█'.repeat(Math.max(0, Math.round(left / Math.max(1, cap) * n))) + '░'.repeat(Math.max(0, n - Math.round(left / Math.max(1, cap) * n))) + (used ? '' : '');
};
const DAY = ['일', '월', '화', '수', '목', '금', '토'];
function dstr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${m}/${d}(${DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
const when = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const gname = (r, g) => {
  const s = (r.shows || {})[g] || {};
  return (s.title || (r.labels || {})[g] || g.toUpperCase()).replace(/^[^〈<]*[〈<]/, '').replace(/[〉>].*$/, '') || g.toUpperCase();
};

/* ── 화면 ────────────────────────────────────────────── */
function showLeft(r) {
  const rows = [];
  let tl = 0, tc = 0;
  for (const g of Object.keys(r.cap)) {
    const c = r.cap[g] || {}, l = (r.left || {})[g] || {}, st = (r.stay || {})[g] || {};
    const sum = (l.double || 0) + (l.twin || 0), all = (c.double || 0) + (c.twin || 0);
    tl += sum; tc += all;
    rows.push([
      dstr(st.date) || (r.labels || {})[g] || g.toUpperCase(),
      gname(r, g),
      `${l.double ?? 0} / ${c.double ?? 0}`,
      `${l.twin ?? 0} / ${c.twin ?? 0}`,
      `${sum} / ${all}`,
      bar(sum, all),
    ]);
  }
  console.log('\n■ 남은 객실  (남은 / 전체)\n');
  console.log(table(['숙박일', '공연', '더블', '트윈', '합계', ''], rows, ['', '', 'r', 'r', 'r', '']));
  console.log(`\n  전체 ${tl} / ${tc}실 남음 · 선택 완료 ${(r.rows || []).length}건 · 명단 ${r.rosterCount || 0}명 · 미선택 ${(r.pending || []).length}명\n`);
}
function showList(r) {
  const rows = (r.rows || []).map(b => [
    when(b.at), b.p4, b.name || '-',
    dstr(b.stayDate) || (r.labels || {})[b.group] || b.group,
    gname(r, b.group),
    b.type === 'double' ? '더블' : '트윈',
  ]);
  console.log(`\n■ 선택 완료 ${rows.length}건  (최근 순)\n`);
  console.log(table(['접수', '뒷4자리', '이름', '숙박일', '공연', '객실'], rows));
  console.log('');
}
function showPending(r) {
  const rows = (r.pending || []).map(p => [
    p.p4, p.name || '-', dstr(((r.stay || {})[p.g] || {}).date) || p.g, gname(r, p.g),
  ]);
  console.log(`\n■ 아직 안 고른 사람 ${rows.length}명  (재안내 대상)\n`);
  console.log(table(['뒷4자리', '이름', '숙박일', '공연'], rows));
  console.log('');
}

/* ── 실행 ────────────────────────────────────────────── */
const cmd = (argv[0] || 'left').toLowerCase();
const arg = argv[1];

if (['left', '남은', '현황', 'status'].includes(cmd)) {
  showLeft(await api({ op: 'admin_get' }));

} else if (['list', 'ls', '목록'].includes(cmd)) {
  showList(await api({ op: 'admin_get' }));

} else if (['pending', '미선택'].includes(cmd)) {
  showPending(await api({ op: 'admin_get' }));

} else if (cmd === 'all') {
  const r = await api({ op: 'admin_get' });
  showLeft(r); showList(r); showPending(r);

} else if (cmd === 'who') {
  if (!/^\d{4}$/.test(String(arg || ''))) { console.error('뒷 4자리를 줘.  예) node tools/rooms.mjs who 1234'); process.exit(2); }
  const r = await api({ op: 'admin_get' });
  const hit = (r.rows || []).find(b => b.p4 === arg);
  const pend = (r.pending || []).find(p => p.p4 === arg);
  console.log('');
  if (hit) {
    console.log(`  ${arg} · ${hit.name || '이름없음'}`);
    console.log(`  공연    ${hit.show || gname(r, hit.group)}`);
    console.log(`  숙박    ${dstr(hit.stayDate)} → ${dstr(hit.stayOut)} · 1박`);
    console.log(`  객실    ${hit.typeName || hit.type}`);
    console.log(`  접수    ${when(hit.at)}\n`);
  } else if (pend) {
    console.log(`  ${arg} · ${pend.name || '이름없음'} — 아직 안 골랐다.`);
    console.log(`  숙박    ${dstr(((r.stay || {})[pend.g] || {}).date)} · ${gname(r, pend.g)}\n`);
  } else {
    console.log(`  ${arg} — 명단에 없다.\n`);
  }

} else if (cmd === 'cancel') {
  if (!/^\d{4}$/.test(String(arg || ''))) { console.error('뒷 4자리를 줘.  예) node tools/rooms.mjs cancel 1234'); process.exit(2); }
  await api({ op: 'admin_cancel', p4: arg });
  console.log(`\n  ${arg} 선택을 취소했다. 그 자리는 다시 열렸다.`);
  showLeft(await api({ op: 'admin_get' }));

} else if (['add', '추가'].includes(cmd)) {
  const [p4, g, ...nm] = argv.slice(1);
  if (!/^\d{4}$/.test(String(p4 || '')) || !String(g || '').trim()) {
    console.error('예) node tools/rooms.mjs add 1234 b 홍길동     (뒷4자리 · 공연구분 · 이름)');
    process.exit(2);
  }
  const name = nm.join(' ').trim();
  const before = await api({ op: 'admin_get' });
  const dup = (before.rows || []).find(x => x.p4 === p4) || (before.pending || []).find(x => x.p4 === p4);
  const r = await api({ op: 'admin_roster_edit', set: { [p4]: { g: String(g).trim().toLowerCase(), n: name } } });
  if (r.bad?.length) { console.error(`\n  형식이 안 맞다: ${r.bad.join(', ')}\n`); process.exit(1); }
  const after = await api({ op: 'admin_get' });
  const stay = dstr(((after.stay || {})[String(g).trim().toLowerCase()] || {}).date);
  console.log(`\n  ${dup ? '수정했다' : '추가했다'} — ${p4} · ${name || '이름없음'} · ${stay || g} ${gname(after, String(g).trim().toLowerCase())}`);
  if (dup && dup.type) console.log(`  ⚠ 이 사람은 이미 ${dup.type === 'double' ? '더블' : '트윈'}을 골랐다. 공연을 바꿨다면 cancel ${p4} 로 다시 고르게 해라.`);
  console.log(`  명단 ${r.count}명\n`);

} else if (['move', '이동'].includes(cmd)) {
  const [p4, g] = argv.slice(1);
  if (!/^\d{4}$/.test(String(p4 || '')) || !String(g || '').trim()) {
    console.error('예) node tools/rooms.mjs move 1234 c     (뒷4자리 · 바꿀 공연구분)');
    process.exit(2);
  }
  const r0 = await api({ op: 'admin_get' });
  const hit = (r0.rows || []).find(x => x.p4 === p4) || (r0.pending || []).find(x => x.p4 === p4);
  if (!hit) { console.error(`\n  ${p4} — 명단에 없다. add 로 넣어라.\n`); process.exit(1); }
  const gg = String(g).trim().toLowerCase();
  const r = await api({ op: 'admin_roster_edit', set: { [p4]: { g: gg, n: hit.name || '' } } });
  const after = await api({ op: 'admin_get' });
  console.log(`\n  ${p4} · ${hit.name || '이름없음'} → ${dstr(((after.stay || {})[gg] || {}).date) || gg} ${gname(after, gg)}`);
  if (hit.type) console.log(`  ⚠ 이 사람은 이미 객실을 골랐다. 숙박일이 바뀌었으니 cancel ${p4} 로 다시 고르게 해라.`);
  console.log(`  명단 ${r.count}명\n`);

} else if (['rm', 'remove', '삭제'].includes(cmd)) {
  if (!/^\d{4}$/.test(String(arg || ''))) { console.error('뒷 4자리를 줘.  예) node tools/rooms.mjs rm 1234'); process.exit(2); }
  const r = await api({ op: 'admin_roster_edit', del: [arg] });
  console.log('');
  if (r.removed?.length) {
    console.log(`  ${arg} 를 명단에서 뺐다. 명단 ${r.count}명`);
    if (r.stillBooked?.length) console.log(`  ⚠ 이 사람은 이미 객실을 골라 자리를 잡고 있다. 비우려면 cancel ${arg} 도 해라.`);
  } else {
    console.log(`  ${arg} — 명단에 없다.`);
  }
  console.log('');

} else if (cmd === 'roster') {
  if (!arg) { console.error('명단 파일을 줘.  예) node tools/rooms.mjs roster 명단.txt   (- 를 주면 표준입력)'); process.exit(2); }
  const text = arg === '-' ? readFileSync(0, 'utf8') : readFileSync(arg, 'utf8');
  const r = await api({ op: 'admin_roster', text });
  console.log(`\n  명단 ${r.count}명 저장했다. (기존 명단은 통째로 교체됐다)`);
  if (r.dups?.length) console.log(`  ⚠ 뒷4자리가 겹쳐 뒤엣것을 버렸다: ${r.dups.join(', ')}`);
  if (r.bad?.length) console.log(`  ⚠ 형식이 안 맞아 건너뛴 줄 ${r.bad.length}개: ${r.bad.slice(0, 3).join(' / ')}`);
  showLeft(await api({ op: 'admin_get' }));

} else if (cmd === 'csv') {
  const r = await api({ op: 'admin_get' });
  console.log(['접수시각', '뒷4자리', '이름', '숙박일', '공연', '객실'].join('\t'));
  for (const b of r.rows || []) {
    console.log([new Date(b.at).toLocaleString('ko-KR'), b.p4, b.name || '',
      b.stayDate || '', b.show || gname(r, b.group), b.typeName || b.type].join('\t'));
  }

} else {
  console.error(`모르는 명령: ${cmd}
  left | list | pending | all | who <4자리> | cancel <4자리>
  add <4자리> <구분> [이름] | move <4자리> <구분> | rm <4자리> | roster <파일> | csv`);
  process.exit(2);
}
