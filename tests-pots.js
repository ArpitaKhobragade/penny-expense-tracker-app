const assert = require('node:assert/strict');
const P = require('./pots.js');
const M = require('./budget-math.js');
const S = require('./store.js');
const B = require('./backup.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

let counter = 0;
const opts = { now: new Date(2026, 9, 23, 10), newId: () => `p${++counter}` };
const cycle = { start: '2026-10-01', end: '2026-10-31' };
const empty = () => ({ pots: [], topUps: [] });
const spend = (id, date, amount, description, category = 'Food', extra = {}) => ({ id, date, amount, description, category, createdAt: Number(id.replace(/\D/g, '')) || 1, ...extra });
const shopping = (data = empty(), limit = 3000) => P.createPot(data, { name: 'Shopping', limit, categories: ['Shopping'] }, opts).data;

test('a budget needs a name, an amount, and something to recognise its spending', () => {
  const ok = P.createPot(empty(), { name: ' Orders ', limit: '3000', categories: [], keywords: 'Swiggy, zomato, , swiggy' }, opts);
  assert.equal(ok.ok, true); assert.equal(ok.pot.name, 'Orders'); assert.equal(ok.pot.limit, 3000); assert.deepEqual(ok.pot.keywords, ['swiggy', 'zomato']);
  assert.equal(P.createPot(empty(), { name: '', limit: 5, categories: ['Food'] }, opts).ok, false);
  assert.equal(P.createPot(empty(), { name: 'x', limit: 0, categories: ['Food'] }, opts).ok, false);
  assert.equal(P.createPot(empty(), { name: 'x', limit: 5, categories: ['Nonsense'], keywords: '' }, opts).ok, false);
  assert.equal(P.createPot(shopping(), { name: 'shopping', limit: 5, categories: ['Food'] }, opts).ok, false);       // same name
});

test('spending is matched to a budget by category or shop name, and you can override it', () => {
  const orders = P.createPot(empty(), { name: 'Orders', limit: 3000, keywords: 'swiggy, zomato' }, opts).data;
  const pots = shopping(orders).pots;
  assert.equal(P.potFor(spend('e1', '2026-10-02', 100, 'Swiggy order'), pots).name, 'Orders');
  assert.equal(P.potFor(spend('e2', '2026-10-02', 100, 'Sneakers', 'Shopping'), pots).name, 'Shopping');
  assert.equal(P.potFor(spend('e3', '2026-10-02', 100, 'Bus', 'Travel'), pots), null);                               // Daily needs
  assert.equal(P.potFor(spend('e4', '2026-10-02', 100, 'Sneakers', 'Shopping', { potId: 'none' }), pots), null);      // sent back to Daily needs
  assert.equal(P.potFor(spend('e5', '2026-10-02', 100, 'Bus', 'Travel', { potId: pots[0].id }), pots).name, 'Orders'); // chosen by hand
  assert.equal(P.potFor(spend('e6', '2026-10-02', 100, 'Gone', 'Travel', { potId: 'deleted' }), pots), null);
});

test('spending inside a budget is paid from it and leaves nothing for the daily limit', () => {
  const data = shopping(empty(), 3000);
  const v = P.spendingView([spend('e1', '2026-10-05', 1200, 'Shirt', 'Shopping'), spend('e2', '2026-10-06', 800, 'Shoes', 'Shopping'), spend('e3', '2026-10-06', 50, 'Tea')], data, cycle);
  assert.deepEqual(v.expenses.map(e => e.amount), [0, 0, 50]);
  assert.equal(v.pots[0].spent, 2000); assert.equal(v.pots[0].left, 1000); assert.equal(v.pots[0].over, 0); assert.equal(v.pots[0].budget, 3000);
});

test('only the part above the budget goes to Daily needs, on the day it went over', () => {
  const data = shopping(empty(), 1000);
  const v = P.spendingView([spend('e1', '2026-10-05', 600, 'Shirt', 'Shopping'), spend('e2', '2026-10-09', 700, 'Jacket', 'Shopping'), spend('e3', '2026-10-10', 200, 'Cap', 'Shopping')], data, cycle);
  assert.deepEqual(v.expenses.map(e => e.amount), [0, 300, 200]);       // 600 fits; of 700 only 400 fits, so 300 is over; then all of 200 is over
  assert.equal(v.pots[0].over, 500); assert.equal(v.pots[0].left, -500);
});

test('money added to a budget raises it for that period only', () => {
  let data = shopping(empty(), 1000);
  const potId = data.pots[0].id;
  data = P.addTopUp(data, potId, 500, '2026-10-12', opts).data;
  data = P.addTopUp(data, potId, 900, '2026-09-28', opts).data;           // last period: not counted
  const v = P.spendingView([spend('e1', '2026-10-20', 1400, 'Bag', 'Shopping')], data, cycle);
  assert.equal(v.pots[0].budget, 1500); assert.equal(v.pots[0].added, 500); assert.equal(v.expenses[0].amount, 0); assert.equal(v.pots[0].left, 100);
  assert.equal(P.addTopUp(data, 'nope', 5, '2026-10-12').ok, false);
  assert.equal(P.addTopUp(data, potId, 0, '2026-10-12').ok, false);
  assert.equal(P.addTopUp(data, potId, 5, 'soon').ok, false);
});

test('only your own share counts when others owe you for part of it; other periods are left alone', () => {
  const data = shopping(empty(), 500);
  const v = P.spendingView([spend('e1', '2026-10-05', 900, 'Gift', 'Shopping', { owedTotal: 600 }), spend('e2', '2026-09-30', 4000, 'Old', 'Shopping')], data, cycle);
  assert.equal(v.pots[0].spent, 300); assert.equal(v.expenses[0].amount, 0);
  assert.equal(v.expenses[1].amount, 4000);                                         // September is untouched
});

test('the daily limit does not move while a budget has money, and drops by the overflow once it is used up', () => {
  const base = { cycle, today: '2026-10-10', budget: 31000, expenses: [] };
  const data = shopping(empty(), 2000);
  const inside = [spend('s1', '2026-10-04', 1500, 'Shirt', 'Shopping')];
  const within = M.safeToSpend({ ...base, expenses: P.spendingView(inside, data, cycle).expenses });
  assert.equal(within.allowanceToday, M.safeToSpend({ ...base, expenses: [] }).allowanceToday);      // unchanged
  assert.equal(M.safeToSpend({ ...base, expenses: inside }).allowanceToday < within.allowanceToday, true);  // without budgets it would have dropped
  const over = [...inside, spend('s2', '2026-10-06', 1000, 'Jeans', 'Shopping')];           // 2500 against 2000: 500 over
  const exceeded = M.safeToSpend({ ...base, expenses: P.spendingView(over, data, cycle).expenses });
  assert.equal(exceeded.spent, 500);
  assert.equal(exceeded.allowanceToday < within.allowanceToday, true);
  assert.equal(exceeded.allowanceToday, Math.round((31000 - 500) / 22 * 100) / 100);
});

test('editing and removing a budget', () => {
  let data = shopping(empty(), 1000);
  const id = data.pots[0].id;
  data = P.addTopUp(data, id, 200, '2026-10-02', opts).data;
  const edited = P.updatePot(data, id, { name: 'Shopping and gifts', limit: 1500, categories: ['Shopping'], keywords: 'gift' });
  assert.equal(edited.ok, true); assert.equal(edited.pot.limit, 1500); assert.equal(edited.pot.id, id); assert.equal(edited.data.topUps.length, 1);
  assert.equal(P.updatePot(data, 'nope', { name: 'x', limit: 5, categories: ['Food'] }).ok, false);
  const gone = P.removePot(edited.data, id);
  assert.equal(gone.pots.length, 0); assert.equal(gone.topUps.length, 0);
  const v = P.spendingView([spend('e1', '2026-10-05', 100, 'Shirt', 'Shopping')], gone, cycle);
  assert.equal(v.expenses[0].amount, 100);                                           // back to Daily needs
});

test('budgets are saved on their own, kept in backups, and survive bad data', () => {
  const mem = {};
  const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(S.loadPots(storage), { pots: [], topUps: [] });
  let data = shopping(empty(), 1000);
  data = P.addTopUp(data, data.pots[0].id, 250, '2026-10-03', opts).data;
  assert.equal(S.savePots(storage, data), true);
  const back = S.loadPots(storage);
  assert.equal(back.pots.length, 1); assert.equal(back.topUps[0].amount, 250); assert.deepEqual(back.pots[0].categories, ['Shopping']);
  storage.setItem(S.KEY, JSON.stringify({ budget: 1, expenses: [] }));
  const file = JSON.parse(B.buildBackup(storage, new Date(2026, 9, 23)));
  assert.ok(file.data[S.POTS_KEY]);
  assert.equal(B.parseBackup(JSON.stringify(file)).summary.pots, 1);
  storage.setItem(S.POTS_KEY, '{oops'); assert.deepEqual(S.loadPots(storage), { pots: [], topUps: [] });
});

console.log(`\n${passed} budgets tests passed.`);
