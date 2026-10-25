const assert = require('node:assert/strict');
const I = require('./inbox.js');
const S = require('./store.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

let counter = 0;
const opts = { now: new Date(2026, 4, 12, 10, 0, 0), newId: () => `id${++counter}` };
const empty = () => ({ inbox: [], memory: {}, dismissed: [] });
const SWIGGY = 'Rs.120.00 debited from a/c **1234 on 12-05-26 to VPA swiggy@ybl(UPI Ref No 412345678901)';
const RAHUL = 'Sent Rs.500.00 From HDFC Bank A/C *1234 To RAHUL SHARMA On 12/05/26 Ref 123456789012';

test('pasted debit lands in the inbox, not in expenses', () => {
  const { data, results } = I.ingestMessages(SWIGGY, empty(), opts);
  assert.equal(results[0].status, 'added'); assert.equal(data.inbox.length, 1);
  assert.equal(data.inbox[0].amount, 120); assert.equal(data.inbox[0].category, 'Food');
});

test('several pasted messages are split on blank lines and each gets its own result', () => {
  const { data, results } = I.ingestMessages(`${SWIGGY}\n\n${RAHUL}\n\n123456 is your OTP`, empty(), opts);
  assert.deepEqual(results.map(r => r.status), ['added', 'added', 'ignored']);
  assert.equal(data.inbox.length, 2);
  assert.match(results[2].message, /one-time password/);
});

test('credits and unreadable text are explained in plain words and not added', () => {
  const { data, results } = I.ingestMessages('Rs 5000.00 credited to your A/c XX1234 on 12-05-26', empty(), opts);
  assert.equal(results[0].status, 'credit'); assert.equal(data.inbox.length, 0);
  assert.equal(I.ingestMessages('hello there', empty(), opts).results[0].status, 'ignored');
  assert.equal(I.ingestMessages('   ', empty(), opts).results[0].reason, 'empty');
});

test('pasting the same message twice does not add it twice', () => {
  const once = I.ingestMessages(SWIGGY, empty(), opts).data;
  const again = I.ingestMessages(SWIGGY, once, { ...opts, now: new Date(2026, 4, 12, 18, 0, 0) });
  assert.equal(again.results[0].status, 'duplicate'); assert.equal(again.data.inbox.length, 1);
});

test('a message already recorded as an expense is recognised by its reference number', () => {
  const recorded = [{ id: 'e1', amount: 120, date: '2026-05-12', ref: '412345678901', description: 'Swiggy' }];
  assert.equal(I.ingestMessages(SWIGGY, empty(), { ...opts, expenses: recorded }).results[0].status, 'duplicate');
});

test('same amount and day as something typed by hand is flagged, not dropped', () => {
  const manual = [{ id: 'm1', amount: 120, date: '2026-05-12', description: 'Lunch' }];
  const { data } = I.ingestMessages(SWIGGY, empty(), { ...opts, expenses: manual });
  assert.equal(data.inbox.length, 1); assert.deepEqual(data.inbox[0].possibleDuplicateOf, { id: 'm1', description: 'Lunch' });
});

test('confirming moves it to expenses, applies edits, and remembers the shop category', () => {
  const { data } = I.ingestMessages(RAHUL, empty(), opts);
  const id = data.inbox[0].id;
  const r = I.confirmItem([], data, id, { category: 'Education', description: 'Tuition fee' }, opts);
  assert.equal(r.ok, true); assert.equal(r.data.inbox.length, 0);
  assert.equal(r.expenses[0].description, 'Tuition fee'); assert.equal(r.expenses[0].category, 'Education'); assert.equal(r.expenses[0].amount, 500);
  assert.equal(r.expenses[0].source, 'sms'); assert.ok(r.expenses[0].createdAt);
  assert.equal(r.data.memory['rahul sharma'], 'Education');
  // the next message from the same payee arrives already sorted
  const next = I.ingestMessages('Sent Rs.80 From HDFC Bank A/C *1234 To RAHUL SHARMA On 13/05/26 Ref 999999999999', r.data, { ...opts, expenses: r.expenses });
  assert.equal(next.data.inbox[0].category, 'Education'); assert.equal(next.data.inbox[0].categoryConfidence, 'learned');
});

test('confirm rejects a bad amount or date and keeps the item in the inbox', () => {
  const { data } = I.ingestMessages(SWIGGY, empty(), opts);
  const id = data.inbox[0].id;
  assert.equal(I.confirmItem([], data, id, { amount: 0 }, opts).ok, false);
  assert.equal(I.confirmItem([], data, id, { date: 'soon' }, opts).ok, false);
  assert.equal(I.confirmItem([], data, 'missing', {}, opts).ok, false);
});

test('dismissing removes it and stops the same message coming back', () => {
  const { data } = I.ingestMessages(SWIGGY, empty(), opts);
  const dismissed = I.dismissItem(data, data.inbox[0].id);
  assert.equal(dismissed.inbox.length, 0); assert.equal(dismissed.dismissed.length, 1);
  const again = I.ingestMessages(SWIGGY, dismissed, opts);
  assert.equal(again.results[0].status, 'duplicate'); assert.equal(again.data.inbox.length, 0);
});

test('merging attaches the message to the expense you typed', () => {
  const manual = [{ id: 'm1', amount: 120, date: '2026-05-12', description: 'Lunch', category: 'Food' }];
  const { data } = I.ingestMessages(SWIGGY, empty(), { ...opts, expenses: manual });
  const r = I.mergeIntoExisting(manual, data, data.inbox[0].id);
  assert.equal(r.ok, true); assert.equal(r.expenses.length, 1); assert.equal(r.expenses[0].description, 'Lunch'); assert.equal(r.expenses[0].ref, '412345678901');
  assert.equal(r.data.inbox.length, 0);
  assert.equal(I.ingestMessages(SWIGGY, r.data, { ...opts, expenses: r.expenses }).results[0].status, 'duplicate');
  assert.equal(I.mergeIntoExisting(manual, I.ingestMessages(RAHUL, empty(), opts).data, 'x').ok, false);
});

test('"different payment" clears the warning so the item can be confirmed on its own', () => {
  const manual = [{ id: 'm1', amount: 120, date: '2026-05-12', description: 'Lunch' }];
  const { data } = I.ingestMessages(SWIGGY, empty(), { ...opts, expenses: manual });
  const cleared = I.keepBoth(data, data.inbox[0].id);
  assert.equal(cleared.inbox[0].possibleDuplicateOf, undefined); assert.equal(cleared.inbox.length, 1);
  assert.equal(data.inbox[0].possibleDuplicateOf.id, 'm1'); // original untouched
});

test('confirm-all takes only the ones with a known category and no possible twin', () => {
  const manual = [{ id: 'm1', amount: 120, date: '2026-05-12', description: 'Lunch' }];
  const text = [SWIGGY, RAHUL, 'Rs 60 debited from A/c XX1234 to VPA zomato@ybl on 12-05-26'].join('\n\n');
  const { data } = I.ingestMessages(text, empty(), { ...opts, expenses: manual });
  assert.equal(data.inbox.length, 3);
  const r = I.confirmAllKnown(manual, data, opts);
  assert.equal(r.count, 1); // Zomato; Swiggy has a twin, Rahul has no known category
  assert.equal(r.data.inbox.length, 2);
});

test('messages from the phone: payments are added, the rest are counted and dropped', () => {
  const at = new Date(2026, 4, 12, 10, 0, 0).getTime();
  const batch = [
    { sender: 'VM-HDFCBK-S', body: SWIGGY, receivedAt: at },
    { sender: 'VM-HDFCBK-S', body: SWIGGY, receivedAt: at },                                         // delivered twice
    { sender: 'VM-HDFCBK-S', body: '482913 is your OTP for txn of Rs 500 at AMAZON', receivedAt: at },
    { sender: 'AX-SBIUPI', body: 'Rs 5000.00 credited to your A/c XX1234 on 12-05-26', receivedAt: at },
    { sender: '+919876543210', body: 'Rs 500 debited from A/c XX1234 to VPA a@ybl', receivedAt: at },
    { sender: 'VM-HDFCBK-S', body: 'Rs 60 debited from A/c XX1234 to VPA chai@ybl on 12-05-26', receivedAt: at },
  ];
  const r = I.ingestNative(batch, empty(), opts);
  assert.deepEqual([r.added, r.duplicates, r.skipped], [2, 1, 3]);
  assert.equal(r.data.inbox.length, 2);
  assert.ok(r.data.inbox.every(item => !('body' in item) && !('text' in item))); // the message text is not kept
  assert.equal(I.ingestNative([], empty(), opts).added, 0);
  assert.equal(I.ingestNative(null, empty(), opts).added, 0);
});

test('a message with a blank line inside is one message when it comes from the phone', () => {
  const body = 'Rs.120.00 debited from a/c **1234 on 12-05-26\n\nto VPA swiggy@ybl(UPI Ref No 412345678901)';
  assert.equal(I.ingestMessages(body, empty(), opts).results.length, 2);                       // pasted: split in two
  assert.equal(I.ingestMessages(body, empty(), { ...opts, single: true }).results.length, 1);  // from the phone: one
});

test('a payment pasted earlier and read from the phone later is matched, not doubled', () => {
  const pasted = I.ingestMessages(SWIGGY, empty(), opts).data;
  const confirmed = I.confirmItem([], pasted, pasted.inbox[0].id, {}, opts);
  const later = I.ingestNative([{ sender: 'VM-HDFCBK-S', body: SWIGGY, receivedAt: new Date(2026, 4, 12, 20, 0, 0).getTime() }], confirmed.data, { ...opts, expenses: confirmed.expenses });
  assert.equal(later.added, 0); assert.equal(later.duplicates, 1); // the reference number matches
  const noRef = 'Rs 60 debited from A/c XX1234 to VPA chai@ybl on 12-05-26';
  const first = I.ingestMessages(noRef, empty(), opts).data;
  const second = I.ingestNative([{ sender: 'VM-HDFCBK-S', body: noRef, receivedAt: new Date(2026, 4, 12, 20, 0, 0).getTime() }], first, opts);
  assert.equal(second.added, 1); assert.ok(second.data.inbox[1].possibleDuplicateOf); // no reference: flagged for you to decide
});

test('store: round-trips data and keeps fields it does not know about', () => {
  const mem = {}; const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  mem[S.KEY] = JSON.stringify({ budget: 5000, expenses: [{ id: 'a', amount: 1, date: '2026-05-01' }], futureField: { keep: true } });
  const state = S.loadState(storage);
  assert.equal(state.budget, 5000); assert.deepEqual(state.plans, []);
  state.expenses.push({ id: 'b', amount: 2, date: '2026-05-02' });
  assert.equal(S.saveState(storage, state), true);
  const saved = JSON.parse(mem[S.KEY]);
  assert.equal(saved.expenses.length, 2); assert.deepEqual(saved.futureField, { keep: true });
  assert.deepEqual(S.loadInbox(storage), { inbox: [], upcoming: [], salary: [], settle: [], memory: {}, dismissed: [] });
  assert.equal(S.saveInbox(storage, { inbox: [{ id: 'i' }], memory: { swiggy: 'Food' }, dismissed: ['x'] }), true);
  assert.equal(S.loadInbox(storage).memory.swiggy, 'Food');
});

test('store: survives corrupt data and a storage that refuses to save', () => {
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  assert.equal(S.loadState(broken).budget, 0); assert.deepEqual(S.loadInbox(broken).inbox, []);
  assert.equal(S.saveState(broken, S.loadState(broken)), false); assert.equal(S.saveInbox(broken, S.loadInbox(broken)), false);
});

test('store: bills and the payday setting round-trip and survive bad data', () => {
  const mem = {}; const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(S.loadBills(storage), { bills: [], paid: {} });
  assert.deepEqual(S.loadSettings(storage), { mode: 'month', paydayDay: 1, theme: 'auto', lock: false, widgetAmounts: true, lowBalance: 0, todayMode: 'month', planId: '', profile: { name: '', phone: '', email: '' }, hideAmounts: false, budgetFrom: '', recapSeen: '', recurringDismissed: [], specificMode: 'inside' });
  assert.equal(S.saveBills(storage, { bills: [{ id: 'a', title: 'Rent' }], paid: { 'a|2026-10-28': '2026-10-27' } }), true);
  assert.deepEqual(S.loadBills(storage), { bills: [{ id: 'a', title: 'Rent' }], paid: { 'a|2026-10-28': '2026-10-27' } });
  assert.equal(S.saveSettings(storage, { mode: 'payday', paydayDay: 25, theme: 'dark', lock: true, widgetAmounts: false }), true);
  assert.deepEqual(S.loadSettings(storage), { mode: 'payday', paydayDay: 25, theme: 'dark', lock: true, widgetAmounts: false, lowBalance: 0, todayMode: 'month', planId: '', profile: { name: '', phone: '', email: '' }, hideAmounts: false, budgetFrom: '', recapSeen: '', recurringDismissed: [], specificMode: 'inside' });
  mem[S.SETTINGS_KEY] = JSON.stringify({ mode: 'payday', paydayDay: 99 });
  assert.deepEqual(S.loadSettings(storage), { mode: 'payday', paydayDay: 1, theme: 'auto', lock: false, widgetAmounts: true, lowBalance: 0, todayMode: 'month', planId: '', profile: { name: '', phone: '', email: '' }, hideAmounts: false, budgetFrom: '', recapSeen: '', recurringDismissed: [], specificMode: 'inside' });
  mem[S.SETTINGS_KEY] = JSON.stringify({ theme: 'neon' });
  assert.equal(S.loadSettings(storage).theme, 'auto');
  const broken = { getItem: () => '{oops', setItem() { throw new Error('full'); } };
  assert.deepEqual(S.loadBills(broken), { bills: [], paid: {} });
  assert.equal(S.saveBills(broken, { bills: [], paid: {} }), false); assert.equal(S.saveSettings(broken, {}), false);
});

const MANDATE = 'Ur upcoming mandate is set 19-10-2026 and ur A/c will be DR with Rs. 123.00 towards Flipkart for ASPRESENTED Ref- YJP9b955757a31a46dcbe94e7b7d4912050. If mandate is paused execution will not happen - Central Bank of India';
const mandateAt = new Date(2026, 9, 12, 10, 0, 0).getTime();

test('an upcoming mandate notice becomes a suggested bill, not an expense and not a payment to review', () => {
  const r = I.ingestNative([{ sender: 'VM-CBINDA-S', body: MANDATE, receivedAt: mandateAt }], empty(), opts);
  assert.deepEqual([r.added, r.upcoming, r.duplicates, r.skipped], [0, 1, 0, 0]);
  assert.equal(r.data.inbox.length, 0); assert.equal(r.data.upcoming.length, 1);
  const item = r.data.upcoming[0];
  assert.deepEqual([item.title, item.amount, item.dueDate, item.repeat, item.source], ['Flipkart', 123, '2026-10-19', 'monthly', 'sms']);
  assert.ok(!('body' in item));                                  // the message text is not kept
  assert.equal(I.ingestMessages(MANDATE, empty(), opts).results[0].status, 'upcoming');
});

test('the same notice arriving again, or after you dealt with it, is not offered twice', () => {
  const msg = [{ sender: 'VM-CBINDA-S', body: MANDATE, receivedAt: mandateAt }];
  const first = I.ingestNative(msg, empty(), opts).data;
  assert.equal(I.ingestNative(msg, first, opts).duplicates, 1);
  const ignored = I.ignoreUpcoming(first, first.upcoming[0].id);
  assert.equal(ignored.upcoming.length, 0);
  assert.equal(I.ingestNative(msg, ignored, opts).upcoming, 0);      // remembered as dealt with
  // a later notice for the same mandate has the same reference even though the message text differs
  const again = I.ingestNative([{ sender: 'VM-CBINDA-S', body: MANDATE.replace('Ur upcoming', 'Your upcoming'), receivedAt: mandateAt + 86400000 }], first, opts);
  assert.equal(again.duplicates, 1);
});

test('adding a suggestion creates the bill, with the name and repeat you choose', () => {
  const data = I.ingestNative([{ sender: 'VM-CBINDA-S', body: MANDATE, receivedAt: mandateAt }], empty(), opts).data;
  const r = I.acceptUpcoming({ bills: [], paid: {} }, data, data.upcoming[0].id, { title: 'Flipkart subscription', repeat: 'once' }, opts);
  assert.equal(r.ok, true);
  assert.deepEqual([r.bill.title, r.bill.amount, r.bill.dueDate, r.bill.repeat, r.bill.source], ['Flipkart subscription', 123, '2026-10-19', 'once', 'sms']);
  assert.equal(r.billData.bills.length, 1); assert.equal(r.data.upcoming.length, 0); assert.equal(r.data.dismissed.length, 1);
  assert.equal(I.acceptUpcoming({ bills: [], paid: {} }, data, 'missing', {}, opts).ok, false);
  assert.equal(I.acceptUpcoming({ bills: [], paid: {} }, data, data.upcoming[0].id, { amount: 0 }, opts).ok, false);
});

test('a bill you already have is not suggested again', () => {
  const have = [{ id: 'b', title: 'Flipkart', amount: 123, dueDate: '2026-09-19', repeat: 'monthly' }];
  const r = I.ingestNative([{ sender: 'VM-CBINDA-S', body: MANDATE, receivedAt: mandateAt }], empty(), { ...opts, bills: have });
  assert.deepEqual([r.upcoming, r.duplicates], [0, 1]);
  const other = I.ingestNative([{ sender: 'VM-CBINDA-S', body: MANDATE, receivedAt: mandateAt }], empty(), { ...opts, bills: [{ ...have[0], amount: 500 }] });
  assert.equal(other.upcoming, 1);                                // different amount: a different bill
});

test('a credit from a person is skipped, never added as spending', () => {
  const credit = 'Dear SBI User, your A/c X1234-credited by Rs.200 on 27Sep25 transfer from Mrs TEST PERSON1 Ref No 111111111111 -SBI';
  const r = I.ingestNative([{ sender: 'AX-SBIINB', body: credit, receivedAt: mandateAt }], empty(), opts);
  assert.deepEqual([r.added, r.upcoming, r.skipped], [0, 0, 1]);
});

// Salary messages below are invented (no real salary message was available).
const SALARY_15 = 'Dear Customer, your A/c X1234 is credited by Rs.45000.00 on 15May26 by transfer from ACME TECHNOLOGIES PVT LTD SALARY. Ref No 111111111111 -SBI';
const salaryAt = new Date(2026, 4, 16, 10, 0, 0).getTime();
const salaryOpts = { ...opts, now: new Date(2026, 4, 16, 10, 0, 0) };
const salaryMsg = (body = SALARY_15, at = salaryAt) => [{ sender: 'AX-SBIINB', body, receivedAt: at }];

test('a salary credit becomes a payday suggestion, not spending and not a payment to review', () => {
  const r = I.ingestNative(salaryMsg(), empty(), salaryOpts);
  assert.deepEqual([r.added, r.salary, r.skipped], [0, 1, 0]);
  assert.equal(r.data.inbox.length, 0); assert.equal(r.data.salary.length, 1);
  assert.deepEqual([r.data.salary[0].amount, r.data.salary[0].date], [45000, '2026-05-15']);
  assert.ok(!('body' in r.data.salary[0]));                                  // the message text is not kept
  assert.equal(I.ingestMessages(SALARY_15, empty(), salaryOpts).results[0].status, 'salary');
});

test('accepting a salary suggestion sets that day as payday; "not now" is remembered', () => {
  const data = I.ingestNative(salaryMsg(), empty(), salaryOpts).data;
  const yes = I.acceptSalary(data, data.salary[0].id);
  assert.equal(yes.ok, true); assert.equal(yes.day, 15); assert.deepEqual(yes.settings, { mode: 'payday', paydayDay: 15 });
  assert.equal(yes.data.salary.length, 0); assert.equal(yes.data.dismissed.length, 1);
  assert.equal(I.acceptSalary(data, 'missing').ok, false);
  const no = I.ignoreSalary(data, data.salary[0].id);
  assert.equal(no.salary.length, 0);
  assert.equal(I.ingestNative(salaryMsg(), no, salaryOpts).duplicates, 1);   // does not ask again
  assert.equal(I.ingestNative(salaryMsg(), data, salaryOpts).duplicates, 1); // nor twice while waiting
  assert.equal(I.ignoreSalary(data, 'missing'), data);
});

test('no suggestion when your payday setting already matches, or when the message is too old', () => {
  const close = I.ingestNative(salaryMsg(), empty(), { ...salaryOpts, settings: { mode: 'payday', paydayDay: 14 } });
  assert.deepEqual([close.salary, close.skipped], [0, 1]);
  const far = I.ingestNative(salaryMsg(), empty(), { ...salaryOpts, settings: { mode: 'payday', paydayDay: 25 } });
  assert.equal(far.salary, 1);
  const monthStart = 'Dear Customer, your A/c X1234 is credited by Rs.45000.00 on 01May26 by transfer from ACME SALARY. Ref No 222222222222 -SBI';
  assert.equal(I.ingestNative(salaryMsg(monthStart), empty(), { ...salaryOpts, settings: { mode: 'month', paydayDay: 1 } }).salary, 0);
  const old = 'Dear Customer, your A/c X1234 is credited by Rs.45000.00 on 02Apr26 by transfer from ACME SALARY. Ref No 333333333333 -SBI';
  assert.equal(I.ingestNative(salaryMsg(old), empty(), salaryOpts).salary, 0); // 44 days old
});

test('a credit that is not a salary is still just skipped', () => {
  const friend = 'Dear SBI User, your A/c X1234-credited by Rs.200 on 15May26 transfer from Mrs TEST PERSON1 Ref No 111111111111 -SBI';
  const r = I.ingestNative(salaryMsg(friend), empty(), salaryOpts);
  assert.deepEqual([r.added, r.upcoming, r.salary, r.skipped], [0, 0, 0, 1]);
});

test('answering one salary suggestion answers all that are waiting', () => {
  const other = 'Your A/c XXXXXX1234 has been credited with INR 45,000.00 on 10-05-26 towards SALARY APR 2026. Ref 444444444444';
  const both = I.ingestNative([...salaryMsg(), ...salaryMsg(other)], empty(), salaryOpts).data;
  assert.equal(both.salary.length, 2);
  const yes = I.acceptSalary(both, both.salary[0].id);
  assert.equal(yes.data.salary.length, 0); assert.equal(yes.data.dismissed.length, 2);
  const no = I.ignoreSalary(both, both.salary[1].id);
  assert.equal(no.salary.length, 0); assert.equal(no.dismissed.length, 2);
});

console.log(`\n${passed} inbox and store tests passed.`);
