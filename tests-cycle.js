const assert = require('node:assert/strict');
const { cycleFor, normalize, inCycle, sumIn } = require('./cycle.js');
const U = require('./expense-utils.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const pay = day => ({ mode: 'payday', paydayDay: day });

test('default is the calendar month, whatever the payday number says', () => {
  for (const settings of [undefined, {}, { mode: 'month', paydayDay: 25 }, pay(1)]) {
    const c = cycleFor('2026-10-22', settings);
    assert.equal(c.start, '2026-10-01'); assert.equal(c.end, '2026-10-31'); assert.equal(c.days, 31);
  }
});

test('payday on the 25th: before it you are in the cycle that began last month, from it you are in the new one', () => {
  let c = cycleFor('2026-10-22', pay(25));
  assert.deepEqual([c.start, c.end, c.days], ['2026-09-25', '2026-10-24', 30]);
  c = cycleFor('2026-10-25', pay(25));
  assert.deepEqual([c.start, c.end, c.days], ['2026-10-25', '2026-11-24', 31]);
  c = cycleFor('2026-10-24', pay(25));
  assert.equal(c.end, '2026-10-24'); // the last day of the cycle
});

test('year boundaries', () => {
  assert.deepEqual([cycleFor('2026-12-28', pay(25)).start, cycleFor('2026-12-28', pay(25)).end], ['2026-12-25', '2027-01-24']);
  assert.deepEqual([cycleFor('2027-01-10', pay(25)).start, cycleFor('2027-01-10', pay(25)).end], ['2026-12-25', '2027-01-24']);
});

test('a payday on the 29th, 30th or 31st lands on the last day of short months', () => {
  let c = cycleFor('2027-02-10', pay(31));
  assert.deepEqual([c.start, c.end], ['2027-01-31', '2027-02-27']);   // next payday is 28 Feb
  c = cycleFor('2027-02-28', pay(31));
  assert.deepEqual([c.start, c.end], ['2027-02-28', '2027-03-30']);
  c = cycleFor('2026-04-30', pay(31));
  assert.equal(c.start, '2026-04-30');
});

test('cycles are back to back: every day belongs to exactly one', () => {
  let day = '2026-01-01';
  let previous = cycleFor(day, pay(17));
  for (let i = 0; i < 400; i++) {
    day = U.addDays(day, 1);
    const c = cycleFor(day, pay(17));
    assert.ok(day >= c.start && day <= c.end);
    if (c.start !== previous.start) assert.equal(U.addDays(previous.end, 1), c.start);
    previous = c;
  }
});

test('settings are cleaned up and helpers work', () => {
  assert.deepEqual(normalize({ mode: 'payday', paydayDay: '0' }), { mode: 'payday', paydayDay: 1 });
  assert.deepEqual(normalize({ mode: 'payday', paydayDay: 40 }), { mode: 'payday', paydayDay: 1 });
  assert.deepEqual(normalize({ mode: 'weird', paydayDay: 12 }), { mode: 'month', paydayDay: 12 });
  const c = cycleFor('2026-10-22', pay(25));
  assert.equal(inCycle(c, '2026-10-24'), true); assert.equal(inCycle(c, '2026-10-25'), false);
  assert.equal(sumIn([{ date: '2026-10-01', amount: 100 }, { date: '2026-10-25', amount: 50 }, { date: '2026-09-25', amount: 5 }], c), 105);
});

test('date helpers: shifting months and clamping days', () => {
  assert.equal(U.shiftMonth('2026-12', 1), '2027-01'); assert.equal(U.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(U.dateInMonth('2026-02', 31), '2026-02-28'); assert.equal(U.dateInMonth('2026-04', 31), '2026-04-30');
  assert.equal(U.dateInMonth('2026-10', 5), '2026-10-05'); assert.equal(U.dateInMonth('bad', 5), null);
});

test('a salary only suggests a new payday when it would change something', () => {
  const { suggestPayday } = require('./cycle.js');
  // counting by calendar month: a salary at the start or end of a month already fits
  assert.equal(suggestPayday({ mode: 'month' }, '2026-05-01'), null);
  assert.equal(suggestPayday({ mode: 'month' }, '2026-05-03'), null);
  assert.equal(suggestPayday({ mode: 'month' }, '2026-04-30'), null);
  assert.equal(suggestPayday({}, '2026-04-28'), null);
  assert.deepEqual(suggestPayday({ mode: 'month' }, '2026-05-15'), { day: 15 });
  assert.deepEqual(suggestPayday({ mode: 'month' }, '2026-05-04'), { day: 4 });
  // with a payday already set: within 3 days is normal wobble, further is worth asking about
  assert.equal(suggestPayday({ mode: 'payday', paydayDay: 25 }, '2026-05-23'), null);
  assert.equal(suggestPayday({ mode: 'payday', paydayDay: 25 }, '2026-05-28'), null);
  assert.deepEqual(suggestPayday({ mode: 'payday', paydayDay: 25 }, '2026-05-29'), { day: 29 });
  assert.equal(suggestPayday({ mode: 'payday', paydayDay: 1 }, '2026-04-29'), null);   // month-end salary, payday on the 1st: close enough
  assert.deepEqual(suggestPayday({ mode: 'payday', paydayDay: 10 }, '2026-05-20'), { day: 20 });
  assert.equal(suggestPayday({}, 'not a date'), null);
});

console.log(`\n${passed} pay cycle tests passed.`);
