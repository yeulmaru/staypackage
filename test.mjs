import { onRequestPost } from './functions/api/book.js';

// R2 흉내 — 실제 R2와 같은 모양(get/put/delete/list + customMetadata).
// await 지점마다 일부러 늦춰서 두 사람이 동시에 누르는 상황을 재현한다.
const tick = () => new Promise(r => setTimeout(r, Math.floor(Math.random() * 6)));
function mkR2() {
  const m = new Map();
  return {
    async get(k) { await tick(); const v = m.get(k); return v ? { text: async () => v.body } : null; },
    async put(k, body, o = {}) { await tick(); m.set(k, { body, customMetadata: o.customMetadata || {} }); return {}; },
    async delete(k) { await tick(); m.delete(k); return {}; },
    async list({ prefix, cursor }) {
      await tick();
      const objects = [...m.entries()].filter(([k]) => k.startsWith(prefix))
        .map(([key, v]) => ({ key, customMetadata: v.customMetadata }));
      return { objects, truncated: false, cursor };
    },
    _dump: () => [...m.keys()],
  };
}
const env = { R2: mkR2(), BOOK_PIN: 'test1234' };
const call = (body) => onRequestPost({ request: { json: async () => body }, env }).then(r => r.json());

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

console.log('\n[1] 관리자 — 명단 등록');
let r = await call({ op: 'admin_roster', pin: 'test1234', text:
  '1111, a, 김에이\n2222,a,이에이\n3333\ta\t박에이\n4444, a\n5555, a\n6666, a\n7777, a\n8888, a\n9999, a\n1010, a\n' +
  '2001, b, 최비\n2002, b\n# 주석 줄은 건너뜀\n3001, c, 정씨\n1111, a, 중복이라 버려짐\n엉망진창줄' });
ok('명단 저장 13명', r.ok && r.count === 13, r);
ok('중첩 4자리 잡아냄', r.dups.includes('1111'), r.dups);
ok('형식 틀린 줄 걸러냄', r.bad.length === 1, r.bad);

r = await call({ op: 'admin_stock', pin: 'test1234', cap: { a: { double: 5, twin: 5 }, b: { double: 8, twin: 7 }, c: { double: 8, twin: 7 } }, labels: { a: 'A', b: 'B', c: 'C' } });
ok('수량 저장(a 5/5 · b 8/7 · c 8/7)', r.ok && r.cap.a.double === 5 && r.cap.b.twin === 7, r.cap);

console.log('\n[2] 인증');
r = await call({ op: 'auth', p4: '9876' });
ok('명단에 없는 번호 = 차단', !r.ok && r.code === 'notfound');
r = await call({ op: 'auth', p4: '12' });
ok('4자리 아님 = 차단', !r.ok && r.code === 'badp4');
r = await call({ op: 'auth', p4: '1111' });
ok('명단에 있는 번호 = 통과', r.ok && r.done === false);
ok('이름 따라옴', r.name === '김에이', r.name);
ok('자기 구분(A) 재고만 보임 = 더블5·트윈5', r.left.double === 5 && r.left.twin === 5, r.left);
r = await call({ op: 'auth', p4: '2001' });
ok('B 사람은 B 재고(더블8·트윈7)', r.left.double === 8 && r.left.twin === 7, r.left);

console.log('\n[3] 선택하면 자리가 빠진다');
r = await call({ op: 'book', p4: '1111', type: 'double' });
ok('A 김에이 더블 선택 성공', r.ok && r.booking.type === 'double');
r = await call({ op: 'auth', p4: '2222' });
ok('A 재고 더블 5→4', r.left.double === 4 && r.left.twin === 5, r.left);
r = await call({ op: 'auth', p4: '2001' });
ok('B 재고는 안 줄어듦(구분 격리)', r.left.double === 8 && r.left.twin === 7, r.left);

console.log('\n[4] 중복 입력 막기');
r = await call({ op: 'book', p4: '1111', type: 'twin' });
ok('같은 번호 두 번째 선택 = 차단', !r.ok && r.code === 'already');
r = await call({ op: 'auth', p4: '1111' });
ok('다시 들어오면 자기 예약 내역이 뜸', r.ok && r.done === true && r.booking.type === 'double', r);
r = await call({ op: 'auth', p4: '2222' });
ok('재고는 그대로 4 (중복이 안 깎음)', r.left.double === 4, r.left);

console.log('\n[5] 동시에 눌러도 정원을 안 넘는다 (A 더블 남은 4자리 · 6명 동시 클릭)');
const rush = await Promise.all(['3333','4444','5555','6666','7777','8888'].map(p => call({ op: 'book', p4: p, type: 'double' })));
const win = rush.filter(x => x.ok).length, lose = rush.filter(x => !x.ok && x.code === 'soldout').length;
ok('성공 정확히 4명', win === 4, { win, lose });
ok('나머지 2명은 마감 안내', lose === 2, { win, lose });
r = await call({ op: 'auth', p4: '9999' });
ok('A 더블 남은 수량 0 = 정확히 마감', r.left.double === 0 && r.left.twin === 5, r.left);
r = await call({ op: 'book', p4: '9999', type: 'double' });
ok('마감된 종류 = 더 못 잡음', !r.ok && r.code === 'soldout');
r = await call({ op: 'book', p4: '9999', type: 'twin' });
ok('남은 종류(트윈)는 정상 선택', r.ok && r.booking.type === 'twin');

console.log('\n[6] 관리자 화면 데이터 · 취소');
r = await call({ op: 'admin_get', pin: 'test1234' });
ok('선택 6건 집계', r.rows.length === 6, r.rows.length);
ok('A 남은 수량 더블0·트윈4', r.left.a.double === 0 && r.left.a.twin === 4, r.left.a);
r = await call({ op: 'admin_cancel', pin: 'test1234', p4: '1111' });
ok('취소 성공', r.ok);
r = await call({ op: 'auth', p4: '2222' });
ok('취소한 자리가 다시 열림 (더블 0→1)', r.left.double === 1, r.left);
r = await call({ op: 'auth', p4: '1111' });
ok('취소된 사람은 다시 고를 수 있음', r.ok && r.done === false);

console.log('\n[7] 관리자 잠금');
r = await call({ op: 'admin_get', pin: '틀린비번' });
ok('비번 틀리면 차단', !r.ok && r.code === 'badpin');
const env2 = { R2: mkR2() };
const r2 = await onRequestPost({ request: { json: async () => ({ op: 'admin_get', pin: '' }) }, env: env2 }).then(x => x.json());
ok('비번 미설정이면 관리자 기능 통째 잠금', !r2.ok && r2.code === 'nopin');

console.log('\n[8] 공연 = 숙박일 (고객이 날짜를 고르지 않는다)');
r = await call({ op: 'admin_stock', pin: 'test1234',
  cap: { a: { double: 5, twin: 5 }, b: { double: 8, twin: 7 }, c: { double: 8, twin: 7 } },
  labels: { a: 'A', b: 'B', c: 'C' },
  shows: {
    a: { title: '조재혁 피아노 리사이틀', date: '2026-09-12', time: '17:00', hall: '대극장' },
    b: { title: '트리플 빌', date: '2026-09-30', time: '19:30', hall: '대극장' },   // 월 넘김 확인용
    c: { title: '피아노 피아노', date: '2026-12-31', time: '19:30', hall: '대극장' }, // 해 넘김 확인용
  } });
ok('공연·날짜 저장', r.ok && r.shows.a.date === '2026-09-12', r.shows);

r = await call({ op: 'auth', p4: '2222' });   // 구분 a
ok('인증하면 자기 공연이 따라온다', r.stay && r.stay.title === '조재혁 피아노 리사이틀', r.stay);
ok('체크인 = 공연 당일', r.stay.checkIn === '2026-09-12', r.stay);
ok('체크아웃 = 다음 날', r.stay.checkOut === '2026-09-13', r.stay);
ok('공연 시각도 따라온다', r.stay.time === '17:00', r.stay);

r = await call({ op: 'auth', p4: '2002' });   // 구분 b
ok('구분이 다르면 날짜도 다르다', r.stay.checkIn === '2026-09-30', r.stay);
ok('월 넘김 체크아웃 (9/30 → 10/1)', r.stay.checkOut === '2026-10-01', r.stay);

r = await call({ op: 'auth', p4: '3001' });   // 구분 c
ok('해 넘김 체크아웃 (12/31 → 1/1)', r.stay.checkOut === '2027-01-01', r.stay);

r = await call({ op: 'book', p4: '2002', type: 'twin' });
ok('예약 건에 공연·숙박일이 박힌다', r.ok && r.booking.show === '트리플 빌' && r.booking.stayDate === '2026-09-30', r.booking);
r = await call({ op: 'auth', p4: '2002' });
ok('재진입하면 박아 둔 내역 그대로', r.done === true && r.booking.stayDate === '2026-09-30', r.booking);

console.log('\n[9] 수량만 고쳐도 날짜는 안 날아간다');
r = await call({ op: 'admin_stock', pin: 'test1234',
  cap: { a: { double: 3, twin: 5 }, b: { double: 8, twin: 7 }, c: { double: 8, twin: 7 } },
  labels: { a: 'A', b: 'B', c: 'C' } });                       // shows 를 안 보냄
ok('수량만 보내면 공연·날짜는 유지', r.shows.a.date === '2026-09-12' && r.shows.a.title === '조재혁 피아노 리사이틀', r.shows.a);
ok('수량은 바뀜', r.cap.a.double === 3, r.cap);
r = await call({ op: 'admin_stock', pin: 'test1234',
  cap: { a: { double: 5, twin: 5 }, b: { double: 8, twin: 7 }, c: { double: 8, twin: 7 } },
  labels: { a: 'A', b: 'B', c: 'C' },
  shows: { a: { date: '이상한날짜' } } });
ok('날짜 형식이 틀리면 무시하고 이전 값 유지', r.shows.a.date === '2026-09-12', r.shows.a);

console.log('\n[10] 관리자 — 아직 안 고른 사람');
r = await call({ op: 'admin_get', pin: 'test1234' });
const pend = r.pending.map(x => x.p4);
ok('미선택 목록이 나온다', Array.isArray(r.pending) && r.pending.length > 0, r.pending.length);
ok('이미 고른 사람은 목록에 없다', !pend.includes('2002'), pend);
ok('명단에 있고 안 고른 사람은 목록에 있다', pend.includes('1010'), pend);
ok('미선택 항목에 구분이 붙는다', r.pending.every(x => typeof x.g === 'string' && x.g), r.pending[0]);
ok('관리자 응답에 공연·숙박일이 실린다', r.stay.a.checkIn === '2026-09-12', r.stay && r.stay.a);

console.log('\n──────────  통과 ' + pass + ' · 실패 ' + fail + '  ──────────');
process.exit(fail ? 1 : 0);
