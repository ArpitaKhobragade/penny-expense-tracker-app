const assert = require('node:assert/strict');
const O = require('./owed.js');
const P = require('./sms-parser.js');
const I = require('./inbox.js');
const S = require('./store.js');
const B = require('./budget-math.js');
const Ins = require('./insights.js');
const Cy = require('./cycle.js');
const U = require('./expense-utils.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

let counter = 0;
const opts = { now: new Date(2026, 9, 22, 10, 0, 0), newId: () => `o${++counter}` };
const dinner = { id: 'e1', amount: 2000, description: 'Dinner', category: 'Food', date: '2026-10-20' };
const add = (debts, entries, expense = dinner) => { const r = O.addDebts(debts, expense, entries, opts); assert.equal(r.ok, true, r.error); return r.debts; };

test('splits a bill equally between you and the others, any rounding stays with you', () => {
  assert.deepEqual(O.splitEqually(2000, 3), { share: 500, own: 500 });
  assert.deepEqual(O.splitEqually(100, 2), { share: 33.33, own: 33.34 });
  assert.deepEqual(O.splitEqually(90, 0), { share: 0, own: 90 });
});

test('records who owes you, and rejects bad entries without changing anything', () => {
  const debts = add([], [{ person: ' Asha ', amount: '500' }, { person: 'Ravi', amount: 500 }, { person: '', amount: '' }]);
  assert.equal(debts.length, 2); assert.equal(debts[0].person, 'Asha'); assert.equal(debts[0].amount, 500); assert.equal(debts[0].expenseId, 'e1');
  assert.equal(O.addDebts([], dinner, [{ person: 'Asha', amount: 0 }], opts).ok, false);
  assert.equal(O.addDebts([], dinner, [{ person: '', amount: 50 }], opts).ok, false);
  assert.equal(O.addDebts([], dinner, [], opts).ok, false);
  assert.equal(O.addDebts([], null, [{ person: 'Asha', amount: 5 }], opts).ok, false);
});

test('others cannot owe you more than you paid, counting what is already owed', () => {
  const debts = add([], [{ person: 'Asha', amount: 1500 }]);
  const over = O.addDebts(debts, dinner, [{ person: 'Ravi', amount: 600 }], opts);
  assert.equal(over.ok, false); assert.match(over.error, /2000/);
  assert.equal(O.addDebts(debts, dinner, [{ person: 'Ravi', amount: 500 }], opts).ok, true); // exactly the rest is fine: you paid for everyone
});

test('only your own share counts as spending', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }, { person: 'Ravi', amount: 500 }, { person: 'Meera', amount: 500 }]);
  const expenses = O.annotate([dinner, { id: 'e2', amount: 100, date: '2026-10-21' }], debts);
  assert.equal(expenses[0].owedTotal, 1500); assert.equal(U.spendOf(expenses[0]), 500); assert.equal(U.spendOf(expenses[1]), 100);
  const month = U.calculateSummary(expenses, 5000, '2026-10');
  assert.equal(month.spent, 600);
});

test('the daily allowance and the insights use your share, not the full amount', () => {
  const debts = add([], [{ person: 'Asha', amount: 1500 }]);
  const expenses = O.annotate([dinner], debts);
  const full = B.safeToSpend({ month: '2026-10', today: '2026-10-22', budget: 31000, expenses: [dinner] });
  const share = B.safeToSpend({ month: '2026-10', today: '2026-10-22', budget: 31000, expenses });
  assert.equal(full.spent, 2000); assert.equal(share.spent, 500);
  assert.ok(share.allowanceToday > full.allowanceToday, `${share.allowanceToday} should be more than ${full.allowanceToday}`);
  assert.ok(share.monthLeft > full.monthLeft);
  const cycle = Cy.cycleFor('2026-10-22', { mode: 'month', paydayDay: 1 });
  assert.equal(Ins.summarize(expenses, cycle, { mode: 'month', paydayDay: 1 }, '2026-10-22').total, 500);
});

test('annotate drops a stale share when the debt is gone, and leaves other expenses alone', () => {
  const stale = { ...dinner, owedTotal: 1500 };
  const out = O.annotate([stale], []);
  assert.equal('owedTotal' in out[0], false);
  const plain = { id: 'x', amount: 5, date: '2026-10-01' };
  assert.equal(O.annotate([plain], [])[0], plain);
});

test('a payment back reduces what is owed, never past zero, and the extra is reported', () => {
  let debts = add([], [{ person: 'Asha', amount: 500 }]);
  const id = debts[0].id;
  let r = O.recordPayment(debts, id, { amount: 200, date: '2026-10-22' }, opts);
  assert.equal(r.ok, true); assert.equal(r.applied, 200); assert.equal(r.extra, 0); assert.equal(O.outstanding(r.debts[0]), 300); assert.equal(O.isSettled(r.debts[0]), false);
  r = O.recordPayment(r.debts, id, { amount: 400, date: '2026-10-23' }, opts);
  assert.equal(r.applied, 300); assert.equal(r.extra, 100); assert.equal(O.isSettled(r.debts[0]), true);
  assert.equal(O.recordPayment(r.debts, id, { amount: 5 }, opts).ok, false);       // already paid back
  assert.equal(O.recordPayment(debts, id, { amount: -5 }, opts).ok, false);
  assert.equal(O.recordPayment(debts, 'nope', { amount: 5 }, opts).ok, false);
});

test('the same bank message cannot be counted twice', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }]);
  const first = O.recordPayment(debts, debts[0].id, { amount: 100, smsId: 'm1' }, opts);
  assert.equal(O.recordPayment(first.debts, debts[0].id, { amount: 100, smsId: 'm1' }, opts).ok, false);
});

test('money from one person goes against the oldest amount first and can span several', () => {
  let debts = add([], [{ person: 'Asha', amount: 300 }]);
  const lunch = { id: 'e2', amount: 600, description: 'Lunch', date: '2026-10-21' };
  debts = add(debts, [{ person: 'asha', amount: 200 }], lunch);
  assert.equal(debts[1].personKey, debts[0].personKey);
  const r = O.settleFor(debts, debts[0].personKey, { amount: 400, date: '2026-10-22', smsId: 's1' }, opts);
  assert.equal(r.ok, true); assert.equal(r.applied, 400); assert.equal(r.extra, 0);
  assert.equal(O.outstanding(r.debts[0]), 0); assert.equal(O.outstanding(r.debts[1]), 100);
  const more = O.settleFor(r.debts, debts[0].personKey, { amount: 250 }, opts);
  assert.equal(more.applied, 100); assert.equal(more.extra, 150);
  assert.equal(O.settleFor(more.debts, debts[0].personKey, { amount: 10 }, opts).ok, false); // nothing left to settle
});

test('undoing a payment brings the debt back; forgetting the rest turns it into your spending', () => {
  let debts = add([], [{ person: 'Asha', amount: 500 }]);
  const id = debts[0].id;
  let r = O.recordPayment(debts, id, { amount: 200 }, opts);
  const payId = r.debts[0].payments[0].id;
  assert.equal(O.outstanding(O.undoPayment(r.debts, id, payId)[0]), 500);
  // 200 came back, Asha will not pay the other 300: the debt shrinks to what was paid, so 300 is now your own spending
  const forgiven = O.writeOff(r.debts, id);
  assert.equal(forgiven[0].amount, 200); assert.equal(O.isSettled(forgiven[0]), true);
  assert.equal(U.spendOf(O.annotate([dinner], forgiven)[0]), 1800);
  assert.equal(O.writeOff(debts, id).length, 0);                                     // nothing paid: the debt just goes
  assert.equal(O.removeDebt(debts, id).length, 0);
});

test('the summary groups what each person owes, biggest first, and keeps settled ones apart', () => {
  let debts = add([], [{ person: 'Asha', amount: 300 }, { person: 'Ravi', amount: 700 }]);
  debts = O.recordPayment(debts, debts[0].id, { amount: 300 }, opts).debts;
  const s = O.summary(debts);
  assert.equal(s.outstanding, 700); assert.equal(s.people.length, 1); assert.equal(s.people[0].person, 'Ravi'); assert.equal(s.settled.length, 1);
  assert.deepEqual(O.summary([]), { outstanding: 0, people: [], settled: [] });
});

test('names are matched loosely: shared word, prefix, any case', () => {
  assert.equal(O.namesMatch('Ravi Kumar', 'RAVI'), true);
  assert.equal(O.namesMatch('Ravi K', 'ravi kumar'), true);
  assert.equal(O.namesMatch('Asha Rao', 'Meera'), false);
  assert.equal(O.namesMatch('', 'Meera'), false);
  assert.equal(O.namesMatch('Al', 'Alan'), false);                                   // too short to trust
});

test('an incoming amount is matched to the person it most likely came from', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }, { person: 'Ravi', amount: 400 }, { person: 'Meera', amount: 250 }]);
  const byName = O.matchCredit({ amount: 500, counterparty: 'Asha Rao', date: '2026-10-22' }, debts);
  assert.equal(byName[0].person, 'Asha'); assert.equal(byName[0].byName, true); assert.equal(byName[0].exact, true);
  const partial = O.matchCredit({ amount: 200, counterparty: 'Ravi', date: '2026-10-22' }, debts);
  assert.equal(partial.length, 1); assert.equal(partial[0].person, 'Ravi'); assert.equal(partial[0].exact, false);
  const byAmount = O.matchCredit({ amount: 250, counterparty: 'Someone Else', date: '2026-10-22' }, debts);
  assert.equal(byAmount[0].person, 'Meera'); assert.equal(byAmount[0].byName, false);
  assert.deepEqual(O.matchCredit({ amount: 123, counterparty: 'Stranger', date: '2026-10-22' }, debts), []);
  assert.deepEqual(O.matchCredit({ amount: 500, counterparty: 'Asha', date: '2026-10-22' }, []), []);
});

test('money that arrived before the shared payment cannot be paying it back', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }]);
  assert.deepEqual(O.matchCredit({ amount: 500, counterparty: 'Asha', date: '2026-10-10' }, debts), []);
  assert.equal(O.matchCredit({ amount: 500, counterparty: 'Asha', date: '2026-10-20' }, debts).length, 1);
});

test('the parser reads who a credit came from, drops titles and digits, and ignores phone-number addresses', () => {
  const credit = (text, sender = 'AX-SBIUPI') => P.parseBankSms(text, { sender, receivedAt: new Date(2026, 9, 22, 12).getTime() });
  assert.equal(credit('Dear SBI User, your A/c X4212-credited by Rs.500 on 22Oct26 transfer from Mrs ASHA RAO1 Ref No 527045839615 -SBI').counterparty, 'Asha Rao');
  assert.equal(credit('Rs.500.00 credited to a/c XX1234 on 22-10-26 by VPA ravi.k@oksbi (RAVI KUMAR) UPI Ref 629456767814', 'VM-HDFCBK-S').counterparty, 'Ravi Kumar');
  assert.equal(credit('Received Rs 300 from Meera on 22Oct26').counterparty, 'Meera');
  assert.equal(credit('Rs 250 credited to A/c X9742 on 22-10-26 by VPA 9876543210@ybl UPI Ref 629456767814').counterparty, '');
  assert.equal(credit('Rs 250 credited to A/c X9742 on 22-10-26. Avl Bal Rs 1000').counterparty, '');
  assert.equal(P.parseBankSms('Rs 120 debited from A/c X9742 on 22-10-26 to Test Shop', { sender: 'AX-SBIUPI' }).counterparty, '');
});

const credit = (text, extra = {}) => ({ sender: 'AX-SBIUPI', receivedAt: new Date(2026, 9, 22, 12).getTime(), ...extra });
const emptyInbox = () => ({ inbox: [], upcoming: [], salary: [], settle: [], memory: {}, dismissed: [] });
const asha500 = 'Dear SBI User, your A/c X4212-credited by Rs.500 on 22Oct26 transfer from ASHA RAO Ref No 527045839615 -SBI';

test('a matching credit becomes a settle suggestion, not an expense; one that matches nobody is still skipped', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }]);
  const run = I.ingestMessages(asha500, emptyInbox(), { ...credit(), single: true, debts, now: opts.now, newId: opts.newId });
  assert.equal(run.results[0].status, 'settle'); assert.equal(run.data.settle.length, 1); assert.equal(run.data.inbox.length, 0);
  assert.equal(run.data.settle[0].counterparty, 'Asha Rao'); assert.equal(run.data.settle[0].amount, 500);
  const other = I.ingestMessages('Received Rs 77 from Stranger on 22Oct26', emptyInbox(), { ...credit(), single: true, debts, now: opts.now, newId: opts.newId });
  assert.equal(other.results[0].status, 'credit'); assert.equal(other.data.settle.length, 0);
  const none = I.ingestMessages(asha500, emptyInbox(), { ...credit(), single: true, debts: [], now: opts.now, newId: opts.newId });
  assert.equal(none.results[0].status, 'credit');
});

test('the same credit never makes two suggestions', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }]);
  const o = { ...credit(), single: true, debts, now: opts.now, newId: opts.newId };
  const first = I.ingestMessages(asha500, emptyInbox(), o);
  const again = I.ingestMessages(asha500, first.data, o);
  assert.equal(again.results[0].status, 'duplicate'); assert.equal(again.data.settle.length, 1);
});

test('accepting a suggestion counts the money against that person; ignoring forgets it for good', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }, { person: 'Ravi', amount: 500 }]);
  const o = { ...credit(), single: true, debts, now: opts.now, newId: opts.newId };
  const run = I.ingestMessages(asha500, emptyInbox(), o);
  const id = run.data.settle[0].id;
  const accepted = I.acceptSettle(debts, run.data, id, debts[0].personKey, opts);
  assert.equal(accepted.ok, true); assert.equal(accepted.applied, 500); assert.equal(O.isSettled(accepted.debts[0]), true); assert.equal(O.isSettled(accepted.debts[1]), false);
  assert.equal(accepted.data.settle.length, 0);
  assert.equal(I.ingestMessages(asha500, accepted.data, { ...o, debts: accepted.debts }).results[0].status, 'duplicate'); // the message is remembered
  const ignored = I.ignoreSettle(run.data, id);
  assert.equal(ignored.settle.length, 0); assert.equal(I.ingestMessages(asha500, ignored, o).results[0].status, 'duplicate');
  assert.equal(I.acceptSettle(debts, run.data, 'missing', debts[0].personKey, opts).ok, false);
});

test('salary credits still go to payday suggestions, not to settling', () => {
  const debts = add([], [{ person: 'Asha', amount: 500 }]);
  const run = I.ingestMessages('Rs 500 credited to A/c X4212 on 22Oct26 SALARY from ASHA RAO Ref No 527045839615', emptyInbox(), { ...credit(), single: true, debts, now: opts.now, newId: opts.newId });
  assert.equal(run.results[0].status === 'salary' || run.results[0].status === 'credit', true);
  assert.equal(run.data.settle.length, 0);
});

test('what is owed is saved on its own and survives a reload', () => {
  const mem = {};
  const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(S.loadOwed(storage), { debts: [] });
  const owed = add([], [{ person: 'Asha', amount: 500 }]);
  const paid = O.recordPayment(owed, owed[0].id, { amount: 100 }, opts).debts;
  assert.equal(S.saveOwed(storage, { debts: paid }), true);
  const back = S.loadOwed(storage).debts;
  assert.equal(back.length, 1); assert.equal(back[0].person, 'Asha'); assert.equal(O.outstanding(back[0]), 400);
  storage.setItem(S.OWED_KEY, '{not json');
  assert.deepEqual(S.loadOwed(storage), { debts: [] });
});

console.log(`\n${passed} who-owes-me tests passed.`);
