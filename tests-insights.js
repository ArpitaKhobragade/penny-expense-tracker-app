const assert = require('node:assert/strict');
const { summarize, shiftCycle } = require('./insights.js');
const C = require('./cycle.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const e = (id, date, amount, category = 'Food', description = id) => ({ id, date, amount, category, description });
const MONTH = { mode: 'month' };
const october = C.cycleFor('2026-10-15', MONTH);

const data = [
  e('a', '2026-09-03', 1000), e('b', '2026-09-10', 3000, 'Travel'), e('c', '2026-09-28', 500, 'Food'),     // September: 4500
  e('d', '2026-10-02', 600), e('e', '2026-10-05', 1800, 'Shopping'), e('f', '2026-10-09', 300, 'Food'),    // October so far: 2700
  e('g', '2026-11-01', 99),                                                                               // not October
];

test('totals, count, biggest and a daily average for a finished period', () => {
  const s = summarize(data, C.cycleFor('2026-09-15', MONTH), MONTH, '2026-10-22');
  assert.equal(s.total, 4500); assert.equal(s.count, 3); assert.equal(s.biggest.id, 'b');
  assert.equal(s.dailyAverage, 150);               // 4500 over all 30 days of September
  assert.equal(s.inProgress, false);
});

test('a period still in progress averages over the days so far', () => {
  const s = summarize(data, october, MONTH, '2026-10-09');
  assert.equal(s.total, 2700); assert.equal(s.inProgress, true); assert.equal(s.dailyAverage, 300); // 2700 over 9 days
});

test('categories are sorted by amount with their share of the total', () => {
  const s = summarize(data, october, MONTH, '2026-10-09');
  assert.deepEqual(s.byCategory.map(c => [c.category, c.amount, c.pct]), [['Shopping', 1800, 66.7], ['Food', 900, 33.3]]);
});

test('comparison: a period in progress is set against the previous one up to the same day', () => {
  const s = summarize(data, october, MONTH, '2026-10-09');
  // September 1st to 9th held only the 3rd (1000); the 10th and 28th come later
  assert.equal(s.comparison.basis, 'same-point'); assert.equal(s.comparison.previousTotal, 1000); assert.equal(s.comparison.change, 170);
});

test('comparison: a finished period is set against the whole previous one', () => {
  const s = summarize(data, october, MONTH, '2026-11-20');
  assert.equal(s.comparison.basis, 'full'); assert.equal(s.comparison.previousTotal, 4500); assert.equal(s.comparison.change, -40);
});

test('no spending, and no earlier period to compare with, are handled', () => {
  const s = summarize([], october, MONTH, '2026-10-09');
  assert.deepEqual([s.total, s.count, s.dailyAverage, s.byCategory.length, s.biggest, s.comparison.change], [0, 0, 0, 0, null, null]);
});

test('stepping between periods follows the calendar month or a payday', () => {
  const back = shiftCycle(october, MONTH, -1), forward = shiftCycle(october, MONTH, 1);
  assert.deepEqual([back.start, back.end, forward.start, forward.end], ['2026-09-01', '2026-09-30', '2026-11-01', '2026-11-30']);
  const pay = { mode: 'payday', paydayDay: 25 };
  const cycle = C.cycleFor('2026-10-22', pay);                       // 25 Sep to 24 Oct
  const earlier = shiftCycle(cycle, pay, -1), later = shiftCycle(cycle, pay, 1);
  assert.deepEqual([earlier.start, earlier.end, later.start, later.end], ['2026-08-25', '2026-09-24', '2026-10-25', '2026-11-24']);
});

test('a payday period only counts its own days', () => {
  const pay = { mode: 'payday', paydayDay: 25 };
  const items = [e('x', '2026-09-24', 100), e('y', '2026-09-25', 200), e('z', '2026-10-24', 400), e('w', '2026-10-25', 800)];
  assert.equal(summarize(items, C.cycleFor('2026-10-01', pay), pay, '2026-12-01').total, 600);
});

console.log(`\n${passed} insights tests passed.`);
