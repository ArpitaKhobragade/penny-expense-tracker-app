const assert = require('node:assert/strict');
const { suggestSweep, openGoals } = require('./sweep.js');
const G = require('./goals.js');
const S = require('./store.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const laptop = { id: 'laptop', title: 'Laptop', target: 60000, saved: 0, targetDate: '2026-12-31', contributions: [], createdAt: 2 };
const trip = { id: 'trip', title: 'Trip', target: 8000, saved: 0, targetDate: '2026-11-30', contributions: [], createdAt: 1 };
const base = (extra = {}) => ({ today: '2026-10-22', budget: 22000, monthlyFunds: [], expenses: [], plans: [laptop], decided: {}, trackedSince: '2026-10-01', pendingDates: [], ...extra });
const spend = (date, amount) => ({ date, amount });

test("offers what was left at the end of yesterday, rounded down", () => {
  // 21 Oct: 11 days left (21st to 31st), so 22000 / 11 = 2000 allowed; 500.75 spent
  const r = suggestSweep(base({ expenses: [spend('2026-10-21', 500.75)] }));
  assert.equal(r.offer, true); assert.equal(r.date, '2026-10-21'); assert.equal(r.leftover, 1499); assert.equal(r.amount, 1499); assert.equal(r.goalId, 'laptop'); assert.equal(r.monthEnd, false);
});

test("a quiet day with nothing spent offers the whole daily amount", () => {
  // 10 spent on the 3rd leaves 21990 for the 11 days from the 21st: 1999.09 a day, nothing spent on the 21st
  assert.equal(suggestSweep(base({ expenses: [spend('2026-10-03', 10)] })).leftover, 1999);
});

test("earlier spending lowers yesterday's allowance, spending today is ignored", () => {
  const r = suggestSweep(base({ expenses: [spend('2026-10-10', 2200), spend('2026-10-21', 100), spend('2026-10-22', 9999)] }));
  assert.equal(r.leftover, Math.floor((22000 - 2200) / 11) - 100);
});

test("goal money added today does not change yesterday's figure; money added before does", () => {
  const added = (date, amount) => ({ ...laptop, contributions: [{ id: 'c', amount, date, createdAt: 1 }], saved: amount });
  const today = suggestSweep(base({ plans: [added('2026-10-22', 5000)] }));
  assert.equal(today.leftover, 2000);
  const earlier = suggestSweep(base({ plans: [added('2026-10-05', 5500)] }));
  assert.equal(earlier.leftover, Math.floor((22000 - 5500) / 11));
});

test("nothing is offered for small amounts, decided days, or missing budget", () => {
  assert.equal(suggestSweep(base({ expenses: [spend('2026-10-21', 1960)] })).reason, 'too-small'); // 40 left
  assert.equal(suggestSweep(base({ decided: { '2026-10-21': 'kept' } })).reason, 'decided');
  assert.equal(suggestSweep(base({ budget: 0 })).reason, 'no-budget');
  assert.equal(suggestSweep(base({ minAmount: 10, expenses: [spend('2026-10-21', 1960)] })).offer, true);
});

test("an overspent day offers nothing", () => {
  assert.equal(suggestSweep(base({ expenses: [spend('2026-10-21', 2500)] })).reason, 'too-small');
});

test("days before you started using the app are not 'unspent'", () => {
  assert.equal(suggestSweep(base({ trackedSince: '2026-10-22' })).reason, 'before-tracking');
  assert.equal(suggestSweep(base({ trackedSince: '2026-10-21' })).reason, 'before-tracking'); // first day, nothing recorded
  assert.equal(suggestSweep(base({ trackedSince: '2026-10-21', expenses: [spend('2026-10-21', 100)] })).offer, true);
  assert.equal(suggestSweep(base({ trackedSince: '' })).offer, true);
});

test("waits while bank messages from that day are still unreviewed", () => {
  assert.equal(suggestSweep(base({ pendingDates: ['2026-10-21'] })).reason, 'review-pending');
  assert.equal(suggestSweep(base({ pendingDates: ['2026-10-22'] })).offer, true); // today's can wait
});

test("goal choice: soonest deadline first, achieved goals skipped, amount capped at what is still needed", () => {
  const done = { ...trip, id: 'done', saved: 8000 };
  assert.deepEqual(openGoals([laptop, trip, done]).map(g => g.id), ['trip', 'laptop']);
  const r = suggestSweep(base({ plans: [laptop, { ...trip, saved: 7900 }] }));
  assert.equal(r.goalId, 'trip'); assert.equal(r.amount, 100); assert.equal(r.leftover, 2000);
  assert.deepEqual(r.goals.map(g => [g.id, g.amount]), [['trip', 100], ['laptop', 2000]]);
  assert.equal(suggestSweep(base({ plans: [] })).reason, 'no-goal');
  assert.equal(suggestSweep(base({ plans: [{ ...trip, saved: 8000 }] })).reason, 'no-goal');
});

test("on the first of the month it offers the whole unspent budget of the month that just ended", () => {
  const r = suggestSweep(base({ today: '2026-11-01', trackedSince: '2026-10-01', expenses: [spend('2026-10-15', 19700)] }));
  assert.equal(r.offer, true); assert.equal(r.monthEnd, true); assert.equal(r.date, '2026-10-31'); assert.equal(r.leftover, 2300); assert.equal(r.month, '2026-10');
});

test("moving the money lowers the month's budget but not the figure that was just offered", () => {
  const plans = [laptop];
  const first = suggestSweep(base({ plans }));
  const moved = G.addToGoal(plans, 'laptop', first.amount, '2026-10-22', { now: new Date(2026, 9, 22) });
  // the same yesterday, recomputed after the move, is unchanged because the entry is dated today
  assert.equal(suggestSweep(base({ plans: moved.plans })).leftover, first.leftover);
});

test("store: remembers decisions and the tracking start, keeps only recent days", () => {
  const mem = {}; const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(S.loadSweeps(storage), { decided: {}, trackedSince: '' });
  const decided = {}; for (let i = 1; i <= 70; i++) decided[`2026-08-${String(i).padStart(2, '0')}`] = 'kept';
  assert.equal(S.saveSweeps(storage, { decided, trackedSince: '2026-10-01' }), true);
  const loaded = S.loadSweeps(storage);
  assert.equal(loaded.trackedSince, '2026-10-01'); assert.equal(Object.keys(loaded.decided).length, 60);
  assert.equal(S.loadSweeps({ getItem: () => '{oops', setItem() {} }).trackedSince, '');
  assert.equal(S.saveSweeps({ getItem: () => null, setItem() { throw new Error('full'); } }, { decided: {}, trackedSince: '' }), false);
});

test("pay cycle: yesterday's leftover is measured inside the cycle it belonged to", () => {
  const settings = { mode: 'payday', paydayDay: 25 };
  // 25 Oct is the first day of a 31-day cycle (to 24 Nov): 31000 / 31 = 1000 a day
  const first = suggestSweep(base({ today: '2026-10-26', budget: 31000, settings, trackedSince: '2026-09-01' }));
  assert.equal(first.leftover, 1000); assert.equal(first.monthEnd, false);
  // 24 Oct is the last day of the cycle that began 25 Sep: everything unspent is on offer, flagged as the cycle's end
  const end = suggestSweep(base({ today: '2026-10-25', budget: 30000, settings, trackedSince: '2026-09-01', expenses: [spend('2026-10-05', 28000)] }));
  assert.equal(end.offer, true); assert.equal(end.leftover, 2000); assert.equal(end.monthEnd, true); assert.equal(end.cycle.start, '2026-09-25');
});

test("an unpaid bill lowers yesterday's leftover; a payment made after yesterday does not change it", () => {
  const bill = { id: 'rent', title: 'Rent', amount: 1100, dueDate: '2026-10-28', repeat: 'once', createdAt: 1 };
  assert.equal(suggestSweep(base({ bills: [bill], paid: {} })).leftover, 1900); // (22000 - 1100) / 11 days from the 21st
  const paidLater = suggestSweep(base({ bills: [bill], paid: {}, expenses: [{ id: 'p', date: '2026-10-27', amount: 1100, description: 'Rent' }] }));
  assert.equal(paidLater.leftover, 1900); // that payment had not happened yet on the 21st
  const paidBefore = suggestSweep(base({ bills: [{ ...bill, dueDate: '2026-10-25' }], paid: {}, expenses: [{ id: 'p', date: '2026-10-20', amount: 1100, description: 'Rent' }] }));
  assert.equal(paidBefore.leftover, 1900); // already paid: nothing held back, and the payment itself counts as spending
});

test("paying a planned bill yesterday does not shrink yesterday's leftover", () => {
  const bill = { id: 'rent', title: 'Rent', amount: 1100, dueDate: '2026-10-21', repeat: 'once', createdAt: 1 };
  const paid = suggestSweep(base({ bills: [bill], paid: {}, expenses: [{ id: 'p', date: '2026-10-21', amount: 1100, description: 'Rent' }] }));
  assert.equal(paid.leftover, 1900);   // (22000 - 1100) / 11 days, and the payment itself is not "spent that day"
  const ordinary = suggestSweep(base({ expenses: [{ id: 'p', date: '2026-10-21', amount: 1100, description: 'Shoes' }] }));
  assert.equal(ordinary.leftover, 900); // the same amount spent on something else does come out of the day
});

console.log(`\n${passed} sweep tests passed.`);
