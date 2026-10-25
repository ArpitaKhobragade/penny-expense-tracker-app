const assert = require('node:assert/strict');
const G = require('./goals.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

let counter = 0;
const opts = { now: new Date(2026, 9, 17, 10, 0, 0), newId: () => `id${++counter}` };
const laptop = () => G.createGoal({ title: '  New laptop ', target: 60000, targetDate: '2026-12-31' }, opts).plan;

test('creates a goal with a trimmed title, and a date from "days" when none is given', () => {
  const plan = laptop();
  assert.equal(plan.title, 'New laptop'); assert.equal(plan.target, 60000); assert.equal(plan.saved, 0); assert.deepEqual(plan.contributions, []);
  assert.equal(G.createGoal({ title: 'Trip', target: 5000, days: 30 }, opts).plan.targetDate, '2026-11-16');
  assert.equal(G.createGoal({ title: 'Fund', target: 5000 }, opts).plan.targetDate, '');
});

test('rejects bad goals', () => {
  assert.equal(G.createGoal({ title: '', target: 100 }, opts).ok, false);
  assert.equal(G.createGoal({ title: 'x', target: 0 }, opts).ok, false);
  assert.equal(G.createGoal({ title: 'x', target: 100, targetDate: '2026-10-01' }, opts).ok, false);
  assert.equal(G.createGoal({ title: 'x', target: 100, targetDate: 'tomorrow' }, opts).ok, false);
});

test('adds money without changing the original list', () => {
  const plans = [laptop()];
  const r = G.addToGoal(plans, plans[0].id, 2500.5, '2026-10-17', opts);
  assert.equal(r.ok, true); assert.equal(r.plan.saved, 2500.5); assert.equal(r.plan.contributions.length, 1);
  assert.equal(plans[0].saved, 0); assert.equal(plans[0].contributions.length, 0);
  assert.equal(G.addToGoal(r.plans, plans[0].id, 500, undefined, opts).plan.saved, 3000.5);
});

test('rejects bad contributions and unknown goals', () => {
  const plans = [laptop()];
  assert.equal(G.addToGoal(plans, plans[0].id, -5, '2026-10-17', opts).ok, false);
  assert.equal(G.addToGoal(plans, plans[0].id, 5, 'not-a-date', opts).ok, false);
  assert.equal(G.addToGoal(plans, 'missing', 5, '2026-10-17', opts).ok, false);
});

test('withdraws money, but never more than is saved', () => {
  let plans = [laptop()];
  plans = G.addToGoal(plans, plans[0].id, 1000, '2026-10-17', opts).plans;
  const r = G.withdrawFromGoal(plans, plans[0].id, 400, '2026-10-18', opts);
  assert.equal(r.ok, true); assert.equal(r.plan.saved, 600); assert.equal(r.contribution.amount, -400); assert.equal(r.contribution.type, 'withdraw');
  assert.equal(G.withdrawFromGoal(r.plans, plans[0].id, 601, '2026-10-18', opts).ok, false);
  assert.equal(G.withdrawFromGoal(r.plans, plans[0].id, 600, '2026-10-18', opts).plan.saved, 0);
});

test('removes a single contribution and adjusts the saved total', () => {
  let plans = [laptop()];
  plans = G.addToGoal(plans, plans[0].id, 1000, '2026-10-17', opts).plans;
  const added = G.addToGoal(plans, plans[0].id, 300, '2026-10-18', opts);
  const r = G.removeContribution(added.plans, plans[0].id, added.contribution.id);
  assert.equal(r.plan.saved, 1000); assert.equal(r.plan.contributions.length, 1);
  assert.equal(G.removeContribution(r.plans, plans[0].id, 'nope').ok, false);
});

test('deleting a goal can return the money to your balance', () => {
  let plans = [laptop()];
  const id = plans[0].id;
  plans = G.addToGoal(plans, id, 4000, '2026-10-17', opts).plans;
  const r = G.deleteGoal(plans, id, { ...opts, outcome: 'return' });
  assert.equal(r.ok, true); assert.deepEqual(r.plans, []); assert.equal(r.released, 4000); assert.equal(r.expense, null);
  assert.equal(G.goalReservedForMonth(r.plans, '2026-10'), 0);
});

test('deleting a goal can record the saved money as spent on it', () => {
  let plans = [laptop()];
  const id = plans[0].id;
  plans = G.addToGoal(plans, id, 4000, '2026-10-17', opts).plans;
  const r = G.deleteGoal(plans, id, { ...opts, outcome: 'spent', date: '2026-10-20' });
  assert.equal(r.expense.amount, 4000); assert.equal(r.expense.date, '2026-10-20'); assert.equal(r.expense.description, 'New laptop'); assert.equal(r.expense.goalId, id);
  assert.equal(G.deleteGoal(plans, 'missing', opts).ok, false);
  // a goal with nothing saved has nothing to record as spent
  const unfunded = [laptop()];
  const none = G.deleteGoal(unfunded, unfunded[0].id, { ...opts, outcome: 'spent' });
  assert.equal(none.ok, true); assert.equal(none.expense, null); assert.equal(none.released, 0);
});

test('money set aside is counted in the month it was added, withdrawals subtract', () => {
  let plans = [laptop()];
  const id = plans[0].id;
  plans = G.addToGoal(plans, id, 3000, '2026-09-28', opts).plans;
  plans = G.addToGoal(plans, id, 2000, '2026-10-03', opts).plans;
  plans = G.withdrawFromGoal(plans, id, 500, '2026-10-09', opts).plans;
  assert.equal(G.goalReservedForMonth(plans, '2026-09'), 3000);
  assert.equal(G.goalReservedForMonth(plans, '2026-10'), 1500);
  assert.equal(G.goalReservedForMonth(plans, '2026-11'), 0);
  assert.equal(G.goalReservedForMonth(plans, '2026-10', '2026-10-05'), 2000); // before the withdrawal
  assert.equal(G.goalReservedForMonth(plans, '2026-10', '2026-10-02'), 0);
  assert.equal(G.totalSaved(plans), 4500);
});

test('progress: how much is needed per day, and the achieved, overdue and no-deadline states', () => {
  const base = { id: 'g', title: 'Trip', target: 6000, saved: 0, targetDate: '2026-10-26' };
  const active = G.goalProgress(base, '2026-10-17');
  assert.equal(active.status, 'active'); assert.equal(active.daysLeft, 9); assert.equal(active.neededPerDay, 600); assert.equal(active.neededPerMonth, 18000);
  assert.equal(G.goalProgress({ ...base, saved: 3000 }, '2026-10-17').pct, 50);
  assert.equal(G.goalProgress({ ...base, saved: 6000 }, '2026-10-17').status, 'achieved');
  assert.equal(G.goalProgress(base, '2026-10-30').status, 'overdue');
  assert.equal(G.goalProgress({ ...base, targetDate: '' }, '2026-10-17').status, 'no-deadline');
  assert.equal(G.goalProgress({ ...base, targetDate: '2026-10-17' }, '2026-10-17').neededPerDay, 6000);
});

console.log(`\n${passed} goals tests passed.`);
