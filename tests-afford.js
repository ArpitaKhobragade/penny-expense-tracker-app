const assert = require('node:assert/strict');
const { checkAffordability } = require('./afford.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

// 22 Oct: 10 days left including today. 22000 budget means 2200 a day.
const base = (extra = {}) => ({ price: 1000, today: '2026-10-22', budget: 22000, monthlyFunds: [], expenses: [], plans: [], ...extra });

test('a purchase inside today\'s amount fits today and shows before and after', () => {
  const r = checkAffordability(base());
  assert.equal(r.ok, true); assert.equal(r.verdict, 'fits-today');
  assert.equal(r.today.before, 2200); assert.equal(r.today.after, 1200); assert.equal(r.today.limit, 2200);
  assert.equal(r.month.before, 22000); assert.equal(r.month.after, 21000);
  assert.equal(r.tomorrow.before, 2444.44); assert.equal(r.tomorrow.after, 2333.33);
  assert.equal(r.daysOfSpending, 0.5);
});

test('over today\'s amount but still inside the month: says so and shows the cost to tomorrow', () => {
  const r = checkAffordability(base({ price: 3000 }));
  assert.equal(r.verdict, 'fits-month'); assert.equal(r.today.after, -800);
  assert.equal(r.tomorrow.after, 2111.11); assert.equal(r.month.after, 19000); assert.equal(r.daysOfSpending, 1.4);
});

test('more than the month has left is over budget, with the overshoot', () => {
  const r = checkAffordability(base({ price: 30000 }));
  assert.equal(r.verdict, 'over-month'); assert.equal(r.month.after, -8000); assert.equal(r.month.overBy, 8000);
  assert.equal(r.tomorrow.after, 0);
});

test('what you already spent today counts', () => {
  const r = checkAffordability(base({ price: 1500, expenses: [{ date: '2026-10-22', amount: 1000 }] }));
  assert.equal(r.today.before, 1200); assert.equal(r.verdict, 'fits-month'); assert.equal(r.today.after, -300);
});

test('money already set aside for goals is respected, and added funds raise the limit', () => {
  const plans = [{ id: 'g', title: 'Laptop', target: 60000, saved: 2200, targetDate: '', contributions: [{ id: 'c', amount: 2200, date: '2026-10-05' }] }];
  assert.equal(checkAffordability(base({ plans })).today.limit, 1980);
  assert.equal(checkAffordability(base({ monthlyFunds: [{ amount: 2200, date: '2026-10-03' }] })).today.limit, 2420);
});

test('goal impact: days of saving, only for goals with a deadline still ahead', () => {
  const plans = [
    { id: 'a', title: 'Trip', target: 6000, saved: 0, targetDate: '2026-10-26', contributions: [] },           // needs 1200 a day
    { id: 'b', title: 'Fund', target: 5000, saved: 0, targetDate: '', contributions: [] },                      // no deadline
    { id: 'c', title: 'Done', target: 100, saved: 100, targetDate: '2026-11-01', contributions: [] },           // reached
    { id: 'd', title: 'Late', target: 900, saved: 0, targetDate: '2026-10-01', contributions: [] },             // overdue
    { id: 'e', title: 'Laptop', target: 60000, saved: 0, targetDate: '2027-01-20', contributions: [] },
  ];
  const r = checkAffordability(base({ price: 3000, plans }));
  assert.deepEqual(r.goals.map(g => g.title), ['Trip', 'Laptop']);
  assert.equal(r.goals[0].days, 2.5);
  // 60000 over the 91 days from today to 20 Jan is about 659 a day, so 3000 is a bit over four and a half days
  assert.ok(r.goals[1].days > 4.4 && r.goals[1].days < 4.7);
});

test('no budget set: says so instead of inventing numbers', () => {
  const r = checkAffordability(base({ budget: 0 }));
  assert.equal(r.ok, true); assert.equal(r.verdict, 'no-budget'); assert.equal(r.today, undefined);
});

test('rejects a missing, zero or negative price', () => {
  for (const price of ['', 0, -5, 'abc', null]) assert.equal(checkAffordability(base({ price })).ok, false);
  assert.equal(checkAffordability(base({ price: '499.50' })).price, 499.5);
});

test('it is a preview: the data passed in is not changed', () => {
  const expenses = [{ date: '2026-10-22', amount: 100 }];
  checkAffordability(base({ expenses }));
  assert.equal(expenses.length, 1);
});

test('last day of the month has no tomorrow', () => {
  const r = checkAffordability(base({ today: '2026-10-31', price: 100 }));
  assert.equal(r.tomorrow, null); assert.equal(r.verdict, 'fits-today');
});

test('unpaid bills are held back before the purchase is judged', () => {
  const bills = [{ id: 'r', title: 'Rent', amount: 1100, dueDate: '2026-10-25', repeat: 'once', createdAt: 1 }];
  const r = checkAffordability(base({ price: 1000, bills, paid: {} }));
  assert.equal(r.today.limit, 2090);         // (22000 - 1100) / 10 days left, counting today
  assert.equal(r.month.before, 20900);       // free money after the bill
  assert.equal(checkAffordability(base({ price: 1000, bills, paid: { 'r|2026-10-25': '2026-10-22' } })).today.limit, 2200);
});

test('a pay cycle changes the days left and the money for the cycle', () => {
  const r = checkAffordability(base({ price: 1000, settings: { mode: 'payday', paydayDay: 25 } }));
  // today 22 Oct, cycle 25 Sep to 24 Oct: three days left, 22000 for the cycle
  assert.equal(r.today.limit, 7333.33);
  assert.equal(r.tomorrow.before, 11000);
});

console.log(`\n${passed} affordability tests passed.`);
