const assert = require('node:assert/strict');
const I = require('./inbox.js');
const Bi = require('./bills.js');
const B = require('./backup.js');
const S = require('./store.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

let counter = 0;
const opts = { now: new Date(2026, 9, 23, 10), newId: () => `a${++counter}` };
const empty = () => ({ inbox: [], upcoming: [], salary: [], settle: [], memory: {}, dismissed: [] });
const sms = (text, at, sender = 'AX-SBIUPI') => ({ sender, body: text, receivedAt: new Date(2026, 9, 22, at).getTime() });

test('every payment found is added on its own, with the category Pocket worked out or Other', () => {
  const run = I.ingestNative([
    sms('Rs.250.00 debited from A/c X9742 on 22-10-26 to VPA swiggy@ybl UPI Ref 100000000031', 9),
    sms('Rs.80.00 debited from A/c X9742 on 22-10-26 to VPA qwxz@ybl UPI Ref 100000000032', 10),
  ], empty(), { expenses: [], now: opts.now, newId: opts.newId });
  assert.equal(run.data.inbox.length, 2);
  const all = I.acceptEverything([], { bills: [], paid: {} }, run.data, opts);
  assert.equal(all.added, 2); assert.equal(all.expenses.length, 2); assert.equal(all.data.inbox.length, 0);
  assert.deepEqual(all.expenses.map(e => e.category).sort(), ['Food', 'Other']);
  assert.ok(all.expenses.every(e => e.source === 'sms'));
});

test('an upcoming payment becomes a bill on its own', () => {
  const run = I.ingestMessages('Ur upcoming mandate is set 29-10-2026 and ur A/c will be DR with Rs. 123.00 towards Test Store Ref- ABC123def456ghi789', empty(), { single: true, sender: 'AX-SBIUPI', receivedAt: opts.now.getTime(), bills: [], expenses: [], now: opts.now, newId: opts.newId });
  assert.equal(run.data.upcoming.length, 1);
  const all = I.acceptEverything([], { bills: [], paid: {} }, run.data, opts);
  assert.equal(all.billsAdded, 1); assert.equal(all.billData.bills.length, 1); assert.equal(all.billData.bills[0].amount, 123); assert.equal(all.data.upcoming.length, 0);
});

test('a payment that looks like one you typed yourself is attached to it, so nothing counts twice', () => {
  const typed = { id: 't1', amount: 250, description: 'Swiggy', category: 'Food', date: '2026-10-22', createdAt: 1 };
  const run = I.ingestNative([sms('Rs.250.00 debited from A/c X9742 on 22-10-26 to VPA swiggy@ybl UPI Ref 100000000043', 9)], empty(), { expenses: [typed], now: opts.now, newId: opts.newId });
  assert.equal(run.data.inbox.length, 1); assert.ok(run.data.inbox[0].possibleDuplicateOf);
  const all = I.acceptEverything([typed], { bills: [], paid: {} }, run.data, opts);
  assert.equal(all.added, 0); assert.equal(all.merged, 1); assert.equal(all.data.inbox.length, 0);
  assert.equal(all.expenses.length, 1); assert.equal(all.expenses[0].ref, '100000000043');            // now matched to the bank message
  assert.equal(I.ingestNative([sms('Rs.250.00 debited from A/c X9742 on 22-10-26 to VPA swiggy@ybl UPI Ref 100000000043', 9)], all.data, { expenses: all.expenses, now: opts.now, newId: opts.newId }).data.inbox.length, 0); // a second copy is recognised too
});

test('if the entry you typed was deleted, the payment is simply added', () => {
  const typed = { id: 't1', amount: 250, description: 'Swiggy', category: 'Food', date: '2026-10-22', createdAt: 1 };
  const run = I.ingestNative([sms('Rs.250.00 debited from A/c X9742 on 22-10-26 to VPA swiggy@ybl', 9)], empty(), { expenses: [typed], now: opts.now, newId: opts.newId });
  const all = I.acceptEverything([], { bills: [], paid: {} }, run.data, opts);
  assert.equal(all.added, 1); assert.equal(all.expenses.length, 1); assert.equal(all.data.inbox.length, 0);
});

test('with nothing waiting, nothing changes', () => {
  const all = I.acceptEverything([], { bills: [], paid: {} }, empty(), opts);
  assert.equal(all.added, 0); assert.equal(all.billsAdded, 0); assert.equal(all.expenses.length, 0);
});

const fake = initial => { const mem = { ...initial }; return { mem, getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } }; };
const spend = (id, date) => ({ id, amount: 10, description: id, category: 'Food', date });

test('a backup from a chosen date keeps only expenses from that day on, and everything else', () => {
  const storage = fake({
    [S.KEY]: JSON.stringify({ budget: 5000, expenses: [spend('a', '2026-09-30'), spend('b', '2026-10-01'), spend('c', '2026-10-20')], plans: [{ id: 'g', title: 'Laptop', contributions: [] }] }),
    [S.BILLS_KEY]: JSON.stringify({ bills: [{ id: 'r', title: 'Rent' }], paid: {} }),
  });
  const file = JSON.parse(B.buildBackup(storage, new Date(2026, 9, 23), { since: '2026-10-01' }));
  const main = file.data[S.KEY];
  assert.deepEqual(main.expenses.map(e => e.id), ['b', 'c']); assert.equal(main.budget, 5000); assert.equal(main.plans.length, 1);
  assert.equal(file.data[S.BILLS_KEY].bills.length, 1);
  assert.equal(JSON.parse(storage.mem[S.KEY]).expenses.length, 3);                 // what is on the phone is not touched
});

test('without a date, or with a bad one, the backup holds everything, and it still restores', () => {
  const storage = fake({ [S.KEY]: JSON.stringify({ budget: 1, expenses: [spend('a', '2026-09-30'), spend('b', '2026-10-20')] }) });
  assert.equal(JSON.parse(B.buildBackup(storage, new Date(2026, 9, 23))).data[S.KEY].expenses.length, 2);
  assert.equal(JSON.parse(B.buildBackup(storage, new Date(2026, 9, 23), { since: 'soon' })).data[S.KEY].expenses.length, 2);
  assert.equal(JSON.parse(B.buildBackup(storage, new Date(2026, 9, 23), { since: '' })).data[S.KEY].expenses.length, 2);
  const text = B.buildBackup(storage, new Date(2026, 9, 23), { since: '2026-10-01' });
  const target = fake({});
  assert.equal(B.restoreBackup(target, text).ok, true);
  assert.equal(JSON.parse(target.mem[S.KEY]).expenses.length, 1);
});

const M = require('./budget-math.js');
const mx = (id, date, amount) => ({ id, date, amount, description: id, category: 'Food' });

test('a month shows each day so far with its limit and what was left or overspent', () => {
  const rows = M.monthSchedule({ month: '2026-10', today: '2026-10-03', budget: 3100, expenses: [mx('a', '2026-10-01', 40), mx('b', '2026-10-02', 160), mx('c', '2026-10-03', 25)] });
  assert.deepEqual(rows.map(r => r.date), ['2026-10-01', '2026-10-02', '2026-10-03']);   // up to today only
  assert.equal(rows[0].allowance, 100); assert.equal(rows[0].spent, 40); assert.equal(rows[0].left, 60); assert.equal(rows[0].over, false);
  assert.equal(rows[1].allowance, 102); assert.equal(rows[1].over, true); assert.equal(rows[1].left, -58);   // overspent: 160 against 102
  assert.ok(rows[2].allowance < rows[1].allowance);                                      // the overspend is spread over the days left
});

test('a month sets bills and goals aside first, and bill payments are not counted as a day of spending', () => {
  const input = { month: '2026-10', today: '2026-10-02', budget: 4100, goalReserved: 500, expenses: [mx('rent', '2026-10-01', 1000), mx('lunch', '2026-10-01', 50)],
    billPayments: ['rent'], commitments: [{ date: '2026-10-20', amount: 500 }] };
  const rows = M.monthSchedule(input);
  assert.equal(rows[0].spent, 50);                          // the rent is not a day's spending
  assert.equal(rows[0].allowance, 67.74);                   // (4100 - 500 goals - 1000 rent - 500 bill) / 31 days
  assert.deepEqual(M.monthSchedule({ ...input, budget: 0 }), []);   // no budget, no rows
  assert.equal(M.monthSchedule({ ...input, today: '2026-11-05' }).length, 31);          // a finished month shows every day
});

test('Today remembers which view is open and which plan, and ignores nonsense', () => {
  const storage = fake({ [S.SETTINGS_KEY]: JSON.stringify({ todayMode: 'period', planId: 'p1' }) });
  assert.equal(S.loadSettings(storage).todayMode, 'period'); assert.equal(S.loadSettings(storage).planId, 'p1');
  storage.mem[S.SETTINGS_KEY] = JSON.stringify({ todayMode: 'weird', planId: 5 });
  assert.equal(S.loadSettings(storage).todayMode, 'month'); assert.equal(S.loadSettings(storage).planId, '');
  S.saveSettings(storage, { ...S.loadSettings(storage), todayMode: 'period', planId: 'x' });
  assert.equal(S.loadSettings(storage).todayMode, 'period');
});

console.log(`\n${passed} simple-app tests passed.`);
