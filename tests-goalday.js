const assert = require('node:assert/strict');
const B = require('./budget-math.js');
const G = require('./goals.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

// October 2026 has 31 days. Today is the 10th, so 22 days are left (including today) and nothing has been spent yet.
const r2 = n => Math.round(n * 100) / 100;
const base = { month: '2026-10', today: '2026-10-10', budget: 3100, expenses: [] };
const today = moves => B.safeToSpend({ ...base, goalMoves: moves });

test('money put into a goal today is used up from today\'s limit', () => {
  const none = today([]);
  assert.equal(none.allowanceToday, r2(3100 / 22)); assert.equal(none.leftToday, r2(3100 / 22));
  const some = today([{ date: '2026-10-10', amount: 40, spread: false }]);
  assert.equal(some.allowanceToday, r2(3100 / 22)); assert.equal(some.goalToday, 40); assert.equal(some.leftToday, r2(3100 / 22 - 40));
});

test('more than today\'s limit puts today over, and tomorrow shares the rest', () => {
  const r = today([{ date: '2026-10-10', amount: 250, spread: false }]);
  assert.equal(r.leftToday, r2(3100 / 22 - 250));
  assert.equal(r.tomorrowAllowance, r2((3100 - 250) / 21));
});

test('money put in on an earlier day lowers the days after it, not today\'s remaining', () => {
  const r = today([{ date: '2026-10-05', amount: 220, spread: false }]);
  assert.equal(r.goalToday, 0); assert.equal(r.leftToday, r.allowanceToday);
  assert.equal(r.allowanceToday, r2((3100 - 220) / 22));
});

test('money taken out of a goal today is added to today\'s limit', () => {
  const r = today([{ date: '2026-10-10', amount: -300, spread: false }]);
  assert.equal(r.goalToday, -300); assert.equal(r.leftToday, r2(3100 / 22 + 300));
  const earlier = today([{ date: '2026-10-05', amount: -220, spread: false }]);
  assert.equal(earlier.allowanceToday, r2((3100 + 220) / 22));
});

test('a moved leftover is shared over the period, not charged to a day', () => {
  const r = today([{ date: '2026-10-10', amount: 220, spread: true }]);
  assert.equal(r.goalToday, 0); assert.equal(r.allowanceToday, r2((3100 - 220) / 22));
  assert.equal(r.leftToday, r.allowanceToday);
});

test('the month total still counts every goal entry', () => {
  const r = today([{ date: '2026-10-10', amount: 40, spread: false }, { date: '2026-10-02', amount: 60, spread: true }]);
  assert.equal(r.goalReserved, 100); assert.equal(r.monthLeft, 3000);
});

test('goalMovesInRange flags only swept entries as shared', () => {
  const plans = [{ id: 'g', contributions: [
    { id: 'a', date: '2026-10-03', amount: 500 }, { id: 'b', date: '2026-10-04', amount: -100 },
    { id: 'c', date: '2026-10-05', amount: 50, swept: true }, { id: 'd', date: '2026-09-30', amount: 70 }] }];
  const moves = G.goalMovesInRange(plans, '2026-10-01', '2026-10-31');
  assert.deepEqual(moves.map(m => [m.amount, m.spread]), [[500, false], [-100, false], [50, true]]);
  assert.equal(G.goalMovesInRange(plans, '2026-10-01', '2026-10-31', '2026-10-03').length, 1);
  const marked = G.markSwept([{ id: 'g', contributions: [{ id: 'a', date: '2026-10-03', amount: 5 }] }], 'g', 'a');
  assert.equal(marked[0].contributions[0].swept, true);
});

test('the month day list and a specific period count goal money too', () => {
  const rows = B.monthSchedule({ ...base, goalMoves: [{ date: '2026-10-10', amount: 40, spread: false }] });
  const last = rows[rows.length - 1];
  assert.equal(last.date, '2026-10-10'); assert.equal(last.spent, 40);
  const out = B.periodAllowance({ start: '2026-10-08', end: '2026-10-12', total: 500, today: '2026-10-10', expenses: [], goalMoves: [{ date: '2026-10-10', amount: -50, spread: false }] });
  assert.equal(out.goalToday, -50); assert.equal(out.leftToday, r2(500 / 3 + 50)); assert.equal(out.remaining, 550);
  const withdrawn = B.monthSchedule({ ...base, goalMoves: [{ date: '2026-10-10', amount: -40, spread: false }] });
  assert.equal(withdrawn[withdrawn.length - 1].spent, -40);
  const p = B.periodAllowance({ start: '2026-10-08', end: '2026-10-12', total: 500, today: '2026-10-10', expenses: [{ date: '2026-10-10', amount: 30 }], goalMoves: [{ date: '2026-10-10', amount: 40, spread: false }] });
  assert.equal(p.spentToday, 30); assert.equal(p.goalToday, 40); assert.equal(p.allowanceToday, r2(500 / 3));
  assert.equal(p.leftToday, r2(500 / 3 - 70)); assert.equal(p.remaining, 430);
});

console.log(`\n${passed} goal-money tests passed.`);
