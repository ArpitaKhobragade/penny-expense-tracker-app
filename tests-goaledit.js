const assert = require('node:assert/strict');
const G = require('./goals.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }
const now = new Date('2026-10-10T10:00:00');
const U_addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const make = input => G.createGoal({ title: 'New phone', target: 30000, ...input }, { now, newId: () => 'g1' }).plan;

test('a goal can be changed after it is created: name, target and date', () => {
  const plans = [make({ targetDate: '2026-12-31' })];
  const r = G.editGoal(plans, 'g1', { title: 'Laptop', target: 60000, targetDate: '2027-01-31' }, { now });
  assert.equal(r.ok, true);
  assert.equal(r.plan.title, 'Laptop'); assert.equal(r.plan.target, 60000); assert.equal(r.plan.targetDate, '2027-01-31'); assert.equal(r.plan.id, 'g1');
});

test('editing keeps the money already saved and its history', () => {
  let plans = [make({ targetDate: '2026-12-31' })];
  plans = G.addToGoal(plans, 'g1', 5000, '2026-10-09', { now, newId: () => 'c1' }).plans;
  const r = G.editGoal(plans, 'g1', { title: 'Phone', target: 40000 }, { now });
  assert.equal(r.plan.saved, 5000); assert.equal(r.plan.contributions.length, 1); assert.equal(r.plan.targetDate, '2026-12-31');
});

test('a goal needs a name and a target above zero', () => {
  const plans = [make({})];
  assert.equal(G.editGoal(plans, 'g1', { title: '  ', target: 100 }, { now }).ok, false);
  assert.equal(G.editGoal(plans, 'g1', { title: 'x', target: 0 }, { now }).ok, false);
  assert.equal(G.editGoal(plans, 'nope', { title: 'x', target: 5 }, { now }).ok, false);
});

test('a new date cannot be in the past, but an old date that is left alone is fine', () => {
  const plans = [make({ targetDate: '2026-10-20' })];
  assert.equal(G.editGoal(plans, 'g1', { title: 'x', target: 100, targetDate: '2026-10-01' }, { now }).ok, false);
  const late = new Date('2026-11-01T10:00:00');
  assert.equal(G.editGoal(plans, 'g1', { title: 'Renamed', target: 30000, targetDate: '2026-10-20' }, { now: late }).ok, true);
});

test('turning on daily saving works out the daily amount from what is still needed', () => {
  let plans = [make({ targetDate: '2026-12-31' })];
  plans = G.addToGoal(plans, 'g1', 9000, '2026-10-09', { now, newId: () => 'c1' }).plans;
  const r = G.editGoal(plans, 'g1', { title: 'New phone', target: 30000, autoDaily: true }, { now });
  assert.equal(r.plan.autoDaily, true);
  assert.equal(r.plan.dailyAmount, Math.ceil(21000 / 83));   // 10 Oct to 31 Dec is 83 days with today included
  assert.equal(r.plan.autoUntil, '2026-10-09');
});

test('daily saving needs a date; turning it off keeps the goal and its money', () => {
  const plans = [make({ targetDate: '2026-12-31', autoDaily: true })];
  assert.equal(G.editGoal(plans, 'g1', { title: 'x', target: 100, targetDate: '', days: '', autoDaily: true }, { now }).ok, false);
  const off = G.editGoal(plans, 'g1', { title: 'New phone', target: 30000, autoDaily: false }, { now });
  assert.equal(off.ok, true); assert.equal(off.plan.autoDaily, undefined); assert.equal(off.plan.dailyAmount, undefined);
});

test('a plan you follow yourself is remembered without taking anything from the daily limit', () => {
  const plans = [make({ targetDate: '2026-12-31' })];
  const r = G.editGoal(plans, 'g1', { title: 'New phone', target: 30000, planned: true }, { now });
  assert.equal(r.plan.planned, true); assert.equal(r.plan.autoDaily, undefined);
  const made = G.createGoal({ title: 'Trip', target: 12000, days: 60, planned: true }, { now });
  assert.equal(made.plan.planned, true); assert.equal(made.plan.autoDaily, undefined);
});

test('changing the target while saving daily keeps the days already counted', () => {
  const plans = [make({ targetDate: '2026-12-31', autoDaily: true })];
  const before = plans[0];
  const r = G.editGoal(plans, 'g1', { title: 'New phone', target: 60000, autoDaily: true }, { now });
  assert.equal(r.plan.autoUntil, before.autoUntil);
  assert.equal(r.plan.dailyAmount, Math.ceil(60000 / 83));
});

test('saving plans show how much a day for 3, 6 and 12 months', () => {
  const plans = G.savingPlans(50000, '2026-10-10');
  assert.deepEqual(plans.map(p => p.months), [3, 6, 12]);
  assert.equal(plans[0].days, 91); assert.equal(plans[0].date, '2027-01-09'); assert.equal(plans[0].perDay, Math.ceil(50000 / 92));
  assert.equal(plans[2].days, 365); assert.equal(plans[2].perDay, Math.ceil(50000 / 366)); assert.equal(plans[2].perMonth, Math.round(plans[2].perDay * 365 / 12));
  assert.equal(G.savingPlans(0, '2026-10-10')[0].perDay, 0);
});
test('saving 10 a day: the goal is reached after remaining / 10 days', () => {
  const r = G.reachIn(50000, 10, '2026-10-10');
  assert.equal(r.days, 5000); assert.equal(r.date, U_addDays('2026-10-10', 4999)); assert.equal(r.years, 13); assert.equal(r.months, 164);
  assert.match(r.text, /13 years 8 months/);
});

test('saving 200 a month counts as a twelfth of 2,400 a year', () => {
  const r = G.reachIn(12000, 200 * 12 / 365, '2026-10-10');
  assert.equal(r.days, 1825); assert.equal(r.months, 60); assert.equal(r.text, '5 years');
});

test('short and impossible plans are described in plain words', () => {
  assert.equal(G.reachIn(100, 100, '2026-10-10').text, '1 day');
  assert.equal(G.reachIn(3000, 100, '2026-10-10').text, '30 days');
  assert.equal(G.reachIn(9000, 100, '2026-10-10').text, '3 months');
  assert.match(G.reachIn(1000000, 1, '2026-10-10').text, /more than 50 years/);
  assert.equal(G.reachIn(0, 10, '2026-10-10'), null); assert.equal(G.reachIn(100, 0, '2026-10-10'), null);
});

test('a daily amount you type is kept exactly and the date follows from it', () => {
  const reach = G.reachIn(30000, 100, '2026-10-10');
  const made = G.createGoal({ title: 'Bike', target: 30000, targetDate: reach.date, autoDaily: true, dailyAmount: 100 }, { now });
  assert.equal(made.ok, true); assert.equal(made.plan.dailyAmount, 100); assert.equal(made.plan.targetDate, reach.date);
  const edited = G.editGoal([made.plan], made.plan.id, { title: 'Bike', target: 30000, targetDate: reach.date, autoDaily: true, dailyAmount: 150 }, { now });
  assert.equal(edited.plan.dailyAmount, 150);
});
test('saving 5,000 a year counts as 5,000 / 365 a day', () => {
  const r = G.reachIn(50000, 5000 / 365, '2026-10-10');
  assert.equal(r.days, 3650); assert.equal(r.years, 10); assert.equal(r.text, '10 years');
});
test('settings remember whether specific budgets are cut from the monthly budget or kept separate', () => {
  const S = require('./store.js');
  const mem = {}, storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  assert.equal(S.loadSettings(storage).specificMode, 'inside');
  assert.equal(S.saveSettings(storage, { ...S.loadSettings(storage), specificMode: 'extra' }), true);
  assert.equal(S.loadSettings(storage).specificMode, 'extra');
  mem[S.SETTINGS_KEY] = JSON.stringify({ specificMode: 'nonsense' });
  assert.equal(S.loadSettings(storage).specificMode, 'inside');
});

test('"set aside 20 for phone" is recognised as money for a goal, with the amount and the goal', () => {
  const plans = [{ id: 'a', title: 'New phone', target: 50000 }, { id: 'b', title: 'Bike', target: 9000 }];
  let r = G.parseSetAside('set aside 20 for phone', plans);
  assert.equal(r.ok, true); assert.equal(r.amount, 20); assert.equal(r.goal.id, 'a');
  r = G.parseSetAside('20 set aside bike', plans); assert.equal(r.ok, true); assert.equal(r.goal.id, 'b');
  r = G.parseSetAside('save ₹1,500 goal new phone', plans); assert.equal(r.ok, true); assert.equal(r.amount, 1500); assert.equal(r.goal.id, 'a');
  r = G.parseSetAside('Rs 50 goal bike', plans); assert.equal(r.amount, 50); assert.equal(r.goal.id, 'b');
});

test('with several goals and no name the line asks which; with one goal it needs no name', () => {
  const two = [{ id: 'a', title: 'Phone' }, { id: 'b', title: 'Bike' }];
  const r = G.parseSetAside('set aside 100', two);
  assert.equal(r.ok, false); assert.equal(r.reason, 'which'); assert.equal(r.choices.length, 2); assert.equal(r.amount, 100);
  const one = G.parseSetAside('set aside 100', [{ id: 'a', title: 'Phone' }]);
  assert.equal(one.ok, true); assert.equal(one.goal.id, 'a');
  assert.equal(G.parseSetAside('set aside 100', []).reason, 'none');
});

test('an ordinary expense, or a line with no amount, is not a goal line', () => {
  const plans = [{ id: 'a', title: 'Phone' }];
  assert.equal(G.parseSetAside('chai 20', plans), null);
  assert.equal(G.parseSetAside('movie 300 yesterday', plans), null);
  assert.equal(G.parseSetAside('set aside for phone', plans), null);
  assert.equal(G.parseSetAside('', plans), null);
});
console.log(`\n${passed} goal editing tests passed.`);
