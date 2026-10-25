const assert = require('node:assert/strict');
const { safeToSpend, periodAllowance, periodSchedule } = require('./budget-math.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const spend = (date, amount) => ({ date, amount });
const october = (today, extra = {}) => safeToSpend({ month: '2026-10', today, budget: 22000, expenses: [], ...extra });

test('daily allowance spreads the month evenly over the days left, today included', () => {
  const r = october('2026-10-10'); // 22 days left: 10th to 31st
  assert.equal(r.status, 'current'); assert.equal(r.daysLeft, 22); assert.equal(r.allowanceToday, 1000); assert.equal(r.leftToday, 1000);
});

test('what was spent before today lowers the allowance; spending today lowers what is left', () => {
  const r = october('2026-10-10', { expenses: [spend('2026-10-01', 1200), spend('2026-10-09', 1000), spend('2026-10-10', 300)] });
  assert.equal(r.allowanceToday, 900); assert.equal(r.spentToday, 300); assert.equal(r.leftToday, 600);
  assert.equal(r.monthLeft, 19500);
});

test("tomorrow's allowance reflects today's under- or overspending", () => {
  const under = october('2026-10-10', { expenses: [spend('2026-10-10', 300)] });
  assert.equal(under.tomorrowAllowance, 1033.33); // 21700 over 21 days
  const over = october('2026-10-10', { expenses: [spend('2026-10-10', 2200)] });
  assert.equal(over.leftToday, -1200); assert.equal(over.tomorrowAllowance, 942.86); // 19800 over 21 days
});

test('goal money set aside this month lowers the allowance', () => {
  assert.equal(october('2026-10-10', { goalReserved: 2200 }).allowanceToday, 900);
});

test('added funds raise the available budget', () => {
  assert.equal(october('2026-10-10', { addedFunds: 2200 }).allowanceToday, 1100);
});

test('expenses dated later this month are commitments and lower today', () => {
  const r = october('2026-10-10', { expenses: [spend('2026-10-28', 1100)] });
  assert.equal(r.committed, 1100); assert.equal(r.allowanceToday, 950);
});

test('overspent month: allowance is zero and the overshoot is reported', () => {
  const r = safeToSpend({ month: '2026-10', today: '2026-10-20', budget: 1000, expenses: [spend('2026-10-05', 1500)] });
  assert.equal(r.allowanceToday, 0); assert.equal(r.overBy, 500); assert.equal(r.monthLeft, -500);
});

test('no budget set: no allowance is invented', () => {
  const r = safeToSpend({ month: '2026-10', today: '2026-10-10', budget: 0, expenses: [spend('2026-10-02', 50)] });
  assert.equal(r.hasBudget, false); assert.equal(r.allowanceToday, null); assert.equal(r.leftToday, null);
});

test('last day of the month has no tomorrow; other months are past or upcoming', () => {
  assert.equal(october('2026-10-31').tomorrowAllowance, null);
  assert.equal(october('2026-10-31').daysLeft, 1);
  assert.equal(safeToSpend({ month: '2026-09', today: '2026-10-05', budget: 3000, expenses: [] }).status, 'past');
  const next = safeToSpend({ month: '2026-11', today: '2026-10-05', budget: 3000, expenses: [] });
  assert.equal(next.status, 'upcoming'); assert.equal(next.allowanceToday, 100);
});

test('only expenses in the viewed month are counted', () => {
  const r = october('2026-10-10', { expenses: [spend('2026-09-30', 9999), spend('2026-10-02', 100)] });
  assert.equal(r.spent, 100);
});

test('unpaid bills are set aside before the daily amount is worked out', () => {
  const bills = [{ date: '2026-10-25', amount: 1100 }, { date: '2026-11-02', amount: 9999 }]; // the second is outside October
  const r = october('2026-10-10', { commitments: bills });
  assert.equal(r.billsDue, 1100); assert.equal(r.allowanceToday, 950);   // (22000 - 1100) / 22
  assert.equal(r.monthLeft, 20900);                                      // free money, after the bill
  assert.equal(r.tomorrowAllowance, 995.24);                             // 20900 / 21
});

test('a bill due today that is still unpaid already counts against today', () => {
  assert.equal(october('2026-10-10', { commitments: [{ date: '2026-10-10', amount: 2200 }] }).allowanceToday, 900);
});

test('bills can push a month into overspending', () => {
  const r = safeToSpend({ month: '2026-10', today: '2026-10-20', budget: 1000, expenses: [spend('2026-10-05', 600)], commitments: [{ date: '2026-10-28', amount: 600 }] });
  assert.equal(r.overBy, 200); assert.equal(r.allowanceToday, 0);
});

test('a pay cycle works like a month: 25th to 24th', () => {
  const cycle = { start: '2026-09-25', end: '2026-10-24' }; // 30 days; on 22 Oct three days remain (22, 23, 24)
  const r = safeToSpend({ cycle, today: '2026-10-22', budget: 30000, expenses: [spend('2026-09-26', 9000), spend('2026-10-21', 1000), spend('2026-09-20', 5555)] });
  assert.equal(r.status, 'current'); assert.equal(r.daysLeft, 3); assert.equal(r.cycle.days, 30);
  assert.equal(r.spent, 10000);                  // the 20 Sep expense belongs to the previous cycle
  assert.equal(r.allowanceToday, 6666.67);       // 20000 over 3 days
  assert.equal(safeToSpend({ cycle, today: '2026-10-25', budget: 100, expenses: [] }).status, 'past');
  assert.equal(safeToSpend({ cycle, today: '2026-09-20', budget: 3000, expenses: [] }).status, 'upcoming');
});

const week = (today, expenses = []) => periodAllowance({ start: '2026-10-10', end: '2026-10-16', total: 7000, today, expenses });

test('period allowance divides what is left by the days left', () => {
  const r = week('2026-10-12', [spend('2026-10-10', 1500), spend('2026-10-11', 500), spend('2026-10-12', 400)]);
  assert.equal(r.status, 'active'); assert.equal(r.days, 7); assert.equal(r.daysLeft, 5);
  assert.equal(r.allowanceToday, 1000); assert.equal(r.leftToday, 600); assert.equal(r.remaining, 4600);
});

test('period before it starts, after it ends, and with a bad range', () => {
  const before = week('2026-10-05');
  assert.equal(before.status, 'upcoming'); assert.equal(before.allowanceToday, 1000);
  const after = week('2026-10-20', [spend('2026-10-11', 7500)]);
  assert.equal(after.status, 'ended'); assert.equal(after.allowanceToday, null); assert.equal(after.overBy, 500);
  assert.equal(periodAllowance({ start: '2026-10-16', end: '2026-10-10', total: 100, today: '2026-10-12', expenses: [] }).valid, false);
});

test('period schedule shows each day with the allowance that applied then', () => {
  const rows = periodSchedule({ start: '2026-10-10', end: '2026-10-16', total: 7000, expenses: [spend('2026-10-10', 1500), spend('2026-10-11', 500)] });
  assert.equal(rows.length, 7);
  assert.equal(rows[0].allowance, 1000); assert.equal(rows[0].over, true);
  assert.equal(rows[1].allowance, 916.67); assert.equal(rows[1].left, 416.67);
  assert.equal(rows[2].allowance, 1000); // 5000 left over the 5 days from the 12th
});

test('paying a bill you planned for does not eat into that day a second time', () => {
  const unpaid = october('2026-10-10', { commitments: [{ date: '2026-10-25', amount: 1100 }] });
  const paidToday = october('2026-10-10', { expenses: [{ id: 'pay', date: '2026-10-10', amount: 1100 }], billPayments: ['pay'] });
  assert.equal(paidToday.allowanceToday, unpaid.allowanceToday);   // 950 either way
  assert.equal(paidToday.leftToday, unpaid.leftToday);
  assert.equal(paidToday.tomorrowAllowance, unpaid.tomorrowAllowance);
  assert.equal(paidToday.monthLeft, unpaid.monthLeft);             // 20900 free either way
  assert.equal(paidToday.spentToday, 0);                           // not "spent today"...
  assert.equal(paidToday.spent, 1100);                             // ...but it is spent this period
  // the same ₹1100 as an ordinary expense does come out of today
  const ordinary = october('2026-10-10', { expenses: [{ id: 'x', date: '2026-10-10', amount: 1100 }] });
  assert.equal(ordinary.allowanceToday, 1000); assert.equal(ordinary.leftToday, -100);
});

console.log(`\n${passed} budget math tests passed.`);
