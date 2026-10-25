const assert = require('node:assert/strict');
const B = require('./budget-math.js');
const G = require('./goals.js');
const Pace = require('./pace.js');
const Recap = require('./recap.js');
const R = require('./recurring.js');
const Cash = require('./cash.js');
const Upi = require('./upi.js');
const Salary = require('./salary.js');
const I = require('./inbox.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }
const r2 = n => Math.round(n * 100) / 100;
const exp = (id, date, amount, extra = {}) => ({ id, date, amount, description: 'Item', category: 'Other', ...extra });

// ------------------------------------------------------------------ money added later in the month
const oct = { month: '2026-10', budget: 3100, expenses: [] };

test('money added on day 15 raises the limit from that day on, and the earlier days stay as they were', () => {
  const before = B.safeToSpend({ ...oct, today: '2026-10-15' });
  const after = B.safeToSpend({ ...oct, today: '2026-10-15', addedFunds: 1500 });
  assert.equal(before.allowanceToday, r2(3100 / 17));
  assert.equal(after.allowanceToday, r2(4600 / 17));
  const rows = B.monthSchedule({ ...oct, today: '2026-10-16', fundList: [{ date: '2026-10-15', amount: 1500 }], addedFunds: 1500 });
  const day = d => rows.find(r => r.date === d);
  assert.equal(day('2026-10-05').allowance, r2(3100 / 27));            // untouched by the money added ten days later
  assert.equal(day('2026-10-15').allowance, r2(4600 / 17));
  const flat = B.monthSchedule({ ...oct, today: '2026-10-16', addedFunds: 1500 });
  assert.equal(flat.find(r => r.date === '2026-10-05').allowance, r2(4600 / 27));   // without dates it would rewrite the past
});

test('salary entered by hand is the budget: bills and goal money come out of it first', () => {
  const view = B.safeToSpend({ ...oct, budget: 31000, today: '2026-10-01', commitments: [{ date: '2026-10-05', amount: 6200 }], goalMoves: [{ date: '2026-10-01', amount: 3100, spread: true }] });
  assert.equal(view.allowanceToday, 700);   // (31000 - 6200 - 3100) / 31
  assert.equal(view.dayPool, 21700);
});

// ------------------------------------------------------------------ pace
test('pace: warns only when the money would run out before the period ends, and needs a few days of data', () => {
  const cycle = { start: '2026-10-01', end: '2026-10-31' };
  assert.equal(Pace.checkPace({ cycle, today: '2026-10-03', dayPool: 3000, daySpent: 900 }).status, 'early');
  assert.equal(Pace.checkPace({ cycle, today: '2026-10-10', dayPool: 3100, daySpent: 500 }).status, 'ok');
  const warn = Pace.checkPace({ cycle, today: '2026-10-10', dayPool: 3100, daySpent: 2000 });   // 200 a day, covers 15 days
  assert.equal(warn.status, 'warn'); assert.equal(warn.average, 200); assert.equal(warn.runOutDate, '2026-10-16'); assert.equal(warn.daysShort, 16);
  assert.equal(Pace.checkPace({ cycle, today: '2026-10-10', dayPool: 1500, daySpent: 2000 }).status, 'over');
});

// ------------------------------------------------------------------ recap
test('weekly recap: totals, top category, quiet days and the streak under the limit', () => {
  const expenses = [exp('a', '2026-10-17', 300, { category: 'Food' }), exp('b', '2026-10-18', 900, { category: 'Shopping', description: 'Shoes' }), exp('c', '2026-10-20', 200, { category: 'Food' }), exp('d', '2026-10-23', 5000)];
  const rows = ['16', '17', '18', '19', '20', '21', '22'].map(d => ({ date: `2026-10-${d}`, over: d === '18' }));
  const r = Recap.weeklyRecap({ expenses, rows, today: '2026-10-23' });
  assert.equal(r.from, '2026-10-16'); assert.equal(r.to, '2026-10-22');
  assert.equal(r.total, 1400); assert.equal(r.count, 3);                       // today's 5000 is not part of the week
  assert.deepEqual(r.topCategory, { category: 'Shopping', amount: 900 }); assert.equal(r.biggest.description, 'Shoes');
  assert.equal(r.noSpendDays, 4); assert.equal(r.streak, 4);                   // 19, 20, 21, 22 are under the limit; 18 was over
});

// ------------------------------------------------------------------ recurring payments
test('recurring: finds a monthly payment, skips one-offs and existing bills, and spots a price change', () => {
  const nf = d => exp(`n${d}`, d, 199, { description: 'Netflix', merchantKey: 'netflix' });
  const expenses = [nf('2026-08-12'), nf('2026-09-12'), exp('x1', '2026-09-03', 450, { description: 'Swiggy', merchantKey: 'swiggy' }), exp('x2', '2026-10-05', 300, { description: 'Swiggy', merchantKey: 'swiggy' }),
    exp('r1', '2026-09-01', 1200, { description: 'Gym', merchantKey: 'gym' }), exp('r2', '2026-10-01', 1200, { description: 'Gym', merchantKey: 'gym' }), nf('2026-10-12')];
  const found = R.findRecurring(expenses, [], { today: '2026-10-23' });
  assert.deepEqual(found.map(f => f.title), ['Gym', 'Netflix']);               // Swiggy: the amounts differ and only 32 days apart: not steady
  const netflix = found.find(f => f.title === 'Netflix');
  assert.equal(netflix.amount, 199); assert.equal(netflix.day, 12); assert.equal(netflix.nextDate, '2026-11-12'); assert.equal(netflix.count, 3);
  assert.deepEqual(R.findRecurring(expenses, [{ title: 'NETFLIX', repeat: 'monthly', amount: 199 }], { today: '2026-10-23' }).map(f => f.title), ['Gym']);
  assert.deepEqual(R.findRecurring(expenses, [], { today: '2026-10-23', dismissed: ['gym'] }).map(f => f.title), ['Netflix']);
  const up = [nf('2026-08-12'), nf('2026-09-12'), exp('n3', '2026-10-12', 249, { description: 'Netflix', merchantKey: 'netflix' })];
  assert.deepEqual(R.findRecurring(up, [], { today: '2026-10-23' })[0].changed, { from: 199, to: 249 });
  const changes = R.priceChanges([{ id: 'b', title: 'Netflix', amount: 199, repeat: 'monthly' }], up, '2026-10-23');
  assert.equal(changes.length, 1); assert.equal(changes[0].to, 249);
  assert.equal(R.priceChanges([{ id: 'b', title: 'Netflix', amount: 249, repeat: 'monthly' }], up, '2026-10-23').length, 0);
});

// ------------------------------------------------------------------ cash wallet
test('cash wallet: an ATM withdrawal can be added, cash spends reduce it, and it is offered only once', () => {
  const atm = exp('atm', '2026-10-20', 2000, { description: 'ATM withdrawal' });
  let expenses = [atm, exp('tea', '2026-10-21', 20, { cash: true }), exp('bus', '2026-10-21', 30, { cash: true })];
  assert.deepEqual(Cash.offers(expenses, Cash.empty()).map(e => e.id), ['atm']);
  assert.equal(Cash.balance(expenses, Cash.empty()).left, -50);                // nothing put in yet
  expenses = Cash.addToWallet(expenses, 'atm');
  assert.deepEqual(Cash.balance(expenses, Cash.empty()), { in: 2000, spent: 50, left: 1950 });
  assert.equal(Cash.offers(expenses, Cash.empty()).length, 0);
  assert.equal(Cash.offers([atm], Cash.skipOffer(Cash.empty(), 'atm')).length, 0);
  const added = Cash.addCash(Cash.empty(), 500, '2026-10-22');
  assert.equal(Cash.balance(expenses, added.data).left, 2450);
  assert.equal(Cash.addCash(Cash.empty(), 0, '2026-10-22').ok, false);
  assert.equal(Cash.removeFromWallet(expenses, 'atm').find(e => e.id === 'atm').cashIn, undefined);
});

// ------------------------------------------------------------------ UPI notifications
test('UPI notifications: payments and money received are read, failed and promotional ones are not', () => {
  const p = (title, text, app = 'Google Pay') => Upi.parseNotification({ app, title, text, postedAt: 1 });
  let r = p('Paid ₹150.00 to Swiggy', '');
  assert.deepEqual([r.ok, r.kind, r.amount, r.counterparty], [true, 'debit', 150, 'Swiggy']);
  r = p('Google Pay', 'You paid ₹1,250 to Ravi Kumar');
  assert.deepEqual([r.kind, r.amount, r.counterparty], ['debit', 1250, 'Ravi Kumar']);
  r = p('PhonePe', 'Sent ₹100 to chai@ybl. Payment successful');
  assert.deepEqual([r.kind, r.amount, r.counterparty], ['debit', 100, 'chai']);
  r = p('₹75.50 paid successfully to Metro Card', '', 'Paytm');
  assert.deepEqual([r.kind, r.amount, r.counterparty], ['debit', 75.5, 'Metro Card']);
  r = p('Received ₹500 from Asha Rao', '');
  assert.deepEqual([r.kind, r.amount, r.counterparty], ['credit', 500, 'Asha Rao']);
  r = p('Asha sent you ₹300', '');
  assert.deepEqual([r.kind, r.amount, r.counterparty], ['credit', 300, 'Asha']);
  for (const bad of ['Payment of ₹200 to Swiggy failed', 'Get ₹50 cashback on your next payment', 'Reminder: pay ₹999 to Airtel', 'Ravi requested ₹100 from you', 'Welcome to Google Pay']) assert.equal(p(bad, '').ok, false, bad);
});

test('UPI notifications go through the same checks as bank messages, and the bank message later joins the same expense', () => {
  const inbox = { inbox: [], upcoming: [], salary: [], settle: [], memory: {}, dismissed: [] };
  const now = new Date(2026, 9, 23, 12);
  const messages = Upi.toMessages([{ app: 'Google Pay', title: 'Paid ₹150.00 to Swiggy', text: '', postedAt: now.getTime() }, { app: 'Google Pay', title: 'Welcome', text: '' }]);
  assert.equal(messages.length, 1);
  const run = I.ingestNative(messages, inbox, { expenses: [], now });
  assert.equal(run.added, 1); assert.equal(run.data.inbox[0].amount, 150); assert.equal(run.data.inbox[0].description, 'Swiggy');
  const again = I.ingestNative(messages, run.data, { expenses: [], now });
  assert.equal(again.added, 0); assert.equal(again.duplicates, 1);           // the same notification twice adds nothing
  const bank = I.ingestNative([{ sender: 'VM-HDFCBK', body: 'Rs.150.00 debited from A/c XX1234 on 23-10-26 to VPA swiggy@ybl. UPI Ref 100000000101', receivedAt: now.getTime() + 60000 }], run.data, { expenses: [], now });
  const accepted = I.acceptEverything([], { bills: [], paid: [] }, bank.data, {});
  assert.equal(accepted.expenses.length, 1);                                   // one expense, not two
});

// ------------------------------------------------------------------ salary planner
test('salary planner: goals are fed in proportion to what they need, never past what is missing', () => {
  const plans = [
    { id: 'a', title: 'Trip', target: 3100, saved: 0, targetDate: '2026-10-31', contributions: [] },
    { id: 'b', title: 'Laptop', target: 60000, saved: 59990, targetDate: '', contributions: [] },
    { id: 'c', title: 'Done', target: 100, saved: 100, targetDate: '', contributions: [] }];
  const s = Salary.suggestGoals(plans, '2026-10-01', 31);
  assert.deepEqual(s.map(x => [x.id, x.amount]), [['a', 3100], ['b', 10]]);   // Done is skipped; Laptop only misses 10
  assert.deepEqual(Salary.splitGoals(s, 1000).map(x => [x.id, x.amount]), [['a', 996.78], ['b', 3.22]]);   // shared in proportion to what each needs
  assert.deepEqual(Salary.splitGoals(s, 3110).map(x => [x.id, x.amount]), [['a', 3100], ['b', 10]]);
  assert.deepEqual(Salary.splitGoals(s, 0), []);
});

// ------------------------------------------------------------------ saving a little every day
test('daily saving: each day since the last time takes the daily amount out of that day, once, until the date or the target', () => {
  const made = G.createGoal({ title: 'Diwali', target: 1000, targetDate: '2026-10-29', autoDaily: true }, { now: new Date(2026, 9, 23, 9), newId: () => 'g' });
  assert.equal(made.ok, true); assert.equal(made.plan.dailyAmount, 143);      // 1000 over 7 days, rounded up
  assert.equal(G.createGoal({ title: 'x', target: 10, autoDaily: true }).ok, false);
  let plans = [made.plan];
  let run = G.applyAutoSave(plans, '2026-10-23', { now: new Date(2026, 9, 23, 9) });
  assert.equal(run.changed, true); assert.deepEqual(run.plans[0].contributions.map(c => [c.date, c.amount]), [['2026-10-23', 143]]);
  assert.equal(G.applyAutoSave(run.plans, '2026-10-23').changed, false);       // the same day twice adds nothing
  run = G.applyAutoSave(run.plans, '2026-10-26');                              // three days passed without opening the app
  assert.equal(run.plans[0].contributions.length, 4); assert.equal(run.plans[0].saved, 572);
  run = G.applyAutoSave(run.plans, '2026-11-20');                              // long after the date: stops at the date, and at the target
  assert.equal(run.plans[0].contributions.length, 7); assert.equal(run.plans[0].saved, 1000);
  const moves = G.goalMovesInRange(run.plans, '2026-10-01', '2026-10-31');
  assert.ok(moves.every(m => m.spread === false));                             // each one comes out of its own day
  assert.equal(G.stopAutoSave(run.plans, 'g')[0].autoDaily, false);
});

// ------------------------------------------------------------------ overspend and underspend
test('overspending today lowers every remaining day, and underspending raises them', () => {
  // October: a budget of 3100 on the 1st is 100 a day.
  const base = { month: '2026-10', budget: 3100, today: '2026-10-10' };
  const plain = B.safeToSpend({ ...base, expenses: [] });
  const over = B.safeToSpend({ ...base, expenses: [exp('o', '2026-10-10', plain.allowanceToday + 500)] });
  const under = B.safeToSpend({ ...base, expenses: [exp('u', '2026-10-10', 20)] });
  assert.ok(over.tomorrowAllowance < over.allowanceToday);                       // overspent today: every later day gets less
  assert.equal(over.tomorrowAllowance, r2((3100 - plain.allowanceToday - 500) / 21));
  assert.ok(under.tomorrowAllowance > under.allowanceToday);                     // spent less than the limit: every later day gets more
  assert.equal(under.tomorrowAllowance, r2((3100 - 20) / 21));
  const next = B.safeToSpend({ ...base, today: '2026-10-11', expenses: [exp('u', '2026-10-10', 20)] });
  assert.equal(next.allowanceToday, under.tomorrowAllowance);
});

console.log(`\n${passed} new-feature tests passed.`);
