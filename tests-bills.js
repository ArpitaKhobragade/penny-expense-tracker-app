const assert = require('node:assert/strict');
const B = require('./bills.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

let counter = 0;
const opts = { now: new Date(2026, 9, 22, 10, 0, 0), newId: () => `b${++counter}` };
const make = (extra = {}) => { const { id, ...input } = extra; const bill = B.createBill({ title: 'Rent', amount: 12000, dueDate: '2026-10-28', repeat: 'monthly', ...input }, opts).bill; return id ? { ...bill, id } : bill; };
const pay = (id, date, amount, description) => ({ id, date, amount, description });

test('creates a bill and rejects incomplete ones', () => {
  const r = B.createBill({ title: '  Rent ', amount: '12000', dueDate: '2026-10-28', repeat: 'monthly' }, opts);
  assert.equal(r.ok, true); assert.equal(r.bill.title, 'Rent'); assert.equal(r.bill.amount, 12000); assert.equal(r.bill.repeat, 'monthly'); assert.equal(r.bill.source, 'manual');
  assert.equal(B.createBill({ title: '', amount: 5, dueDate: '2026-10-28' }, opts).ok, false);
  assert.equal(B.createBill({ title: 'x', amount: 0, dueDate: '2026-10-28' }, opts).ok, false);
  assert.equal(B.createBill({ title: 'x', amount: 5, dueDate: 'soon' }, opts).ok, false);
  assert.equal(B.createBill({ title: 'x', amount: 5, dueDate: '2026-10-28', repeat: 'weird' }, opts).bill.repeat, 'once');
});

test('a one-off bill falls on one day; a monthly bill falls on the same day each month', () => {
  assert.deepEqual(B.occurrencesInRange(make({ repeat: 'once' }), '2026-10-01', '2026-10-31'), ['2026-10-28']);
  assert.deepEqual(B.occurrencesInRange(make({ repeat: 'once' }), '2026-11-01', '2026-11-30'), []);
  assert.deepEqual(B.occurrencesInRange(make(), '2026-10-01', '2027-01-31'), ['2026-10-28', '2026-11-28', '2026-12-28', '2027-01-28']);
  assert.deepEqual(B.occurrencesInRange(make(), '2026-09-01', '2026-09-30'), []); // not before the first due date
});

test('a monthly bill on the 31st moves to the last day of shorter months, and works across a pay cycle', () => {
  const bill = make({ dueDate: '2026-01-31' });
  assert.deepEqual(B.occurrencesInRange(bill, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(B.occurrencesInRange(make(), '2026-09-25', '2026-10-24'), []);           // 28th is after this cycle ends
  assert.deepEqual(B.occurrencesInRange(make(), '2026-10-25', '2026-11-24'), ['2026-10-28']);
});

test('states: upcoming, due today, overdue', () => {
  const bills = [make({ id: 'r', dueDate: '2026-10-28' }), make({ id: 'n', title: 'Netflix', amount: 199, dueDate: '2026-10-22', repeat: 'once' }), make({ id: 'e', title: 'EMI', amount: 3000, dueDate: '2026-10-15', repeat: 'once' })];
  const rows = B.billOccurrences({ bills, expenses: [], start: '2026-10-01', end: '2026-10-31', today: '2026-10-22' });
  assert.deepEqual(rows.map(r => [r.title, r.state]), [['EMI', 'overdue'], ['Netflix', 'today'], ['Rent', 'upcoming']]);
});

test('a matching payment marks the bill paid: right amount, near the date, same name', () => {
  const bills = [make()];
  const expenses = [pay('x', '2026-10-27', 12000, 'Rent to landlord')];
  const rows = B.billOccurrences({ bills, expenses, start: '2026-10-01', end: '2026-10-31', today: '2026-10-28' });
  assert.equal(rows[0].state, 'paid'); assert.equal(rows[0].paidOn, '2026-10-27');
  assert.deepEqual(B.billCommitments({ bills, expenses, start: '2026-10-01', end: '2026-10-31', today: '2026-10-28' }), []);
});

test('a payment that is the wrong amount, too early, too late or unrelated does not count', () => {
  const run = expenses => B.billOccurrences({ bills: [make()], expenses, start: '2026-10-01', end: '2026-10-31', today: '2026-10-29' })[0].state;
  assert.equal(run([pay('a', '2026-10-27', 11000, 'Rent')]), 'overdue');        // amount off by more than 1% (that is 120 here)
  assert.equal(run([pay('a', '2026-10-27', 12200, 'Rent')]), 'overdue');
  assert.equal(run([pay('a', '2026-10-27', 12000, 'Coffee')]), 'overdue');      // a different thing for the same amount
  assert.equal(run([pay('a', '2026-10-20', 12000, 'Rent')]), 'overdue');        // more than 5 days early
  assert.equal(run([pay('a', '2026-11-09', 12000, 'Rent')]), 'overdue');        // more than 10 days late
  assert.equal(run([pay('a', '2026-10-23', 12000, 'Rent')]), 'paid');           // within 5 days before
  assert.equal(run([pay('a', '2026-11-07', 12000, 'Rent')]), 'paid');           // within 10 days after
  assert.equal(run([pay('a', '2026-10-27', 12100, 'Rent')]), 'paid');           // within 1%
  assert.equal(run([pay('a', '2026-10-27', 11900, 'Rent')]), 'paid');
});

test('one payment pays one occurrence only', () => {
  const rows = B.billOccurrences({ bills: [make()], expenses: [pay('x', '2026-11-27', 12000, 'Rent')], start: '2026-10-01', end: '2026-12-31', today: '2026-11-29' });
  assert.deepEqual(rows.map(r => r.state), ['overdue', 'paid', 'upcoming']);
  const two = B.billOccurrences({ bills: [make({ id: 'a', title: 'Rent A' }), make({ id: 'b', title: 'Rent B' })], expenses: [pay('x', '2026-10-28', 12000, 'Rent A and B')], start: '2026-10-01', end: '2026-10-31', today: '2026-10-29' });
  assert.deepEqual(two.map(r => r.state).sort(), ['overdue', 'paid']);
});

test('marking paid by hand, and undoing it', () => {
  const bills = [make()];
  let paid = B.markPaid({}, B.keyOf(bills[0].id, '2026-10-28'), '2026-10-22');
  assert.equal(B.billOccurrences({ bills, paid, start: '2026-10-01', end: '2026-10-31', today: '2026-10-22' })[0].state, 'paid');
  paid = B.unmarkPaid(paid, B.keyOf(bills[0].id, '2026-10-28'));
  assert.equal(B.billOccurrences({ bills, paid, start: '2026-10-01', end: '2026-10-31', today: '2026-10-22' })[0].state, 'upcoming');
});

test('as of an earlier day, later payments are ignored', () => {
  const bills = [make()];
  const paid = B.markPaid({}, B.keyOf(bills[0].id, '2026-10-28'), '2026-10-25');
  const expenses = [pay('x', '2026-10-27', 12000, 'Rent')];
  const at = asOf => B.billOccurrences({ bills, paid: {}, expenses, start: '2026-10-01', end: '2026-10-31', today: asOf, asOf })[0].state;
  assert.equal(at('2026-10-26'), 'upcoming'); assert.equal(at('2026-10-27'), 'paid');
  assert.equal(B.billOccurrences({ bills, paid, start: '2026-10-01', end: '2026-10-31', today: '2026-10-24', asOf: '2026-10-24' })[0].state, 'upcoming');
});

test('deleting a bill removes its paid notes and nothing else', () => {
  const data = { bills: [make({ id: 'a' }), make({ id: 'b', title: 'Netflix' })], paid: { 'a|2026-10-28': '2026-10-28', 'b|2026-10-28': '2026-10-27' } };
  const r = B.deleteBill(data, 'a');
  assert.deepEqual(r.bills.map(b => b.id), ['b']); assert.deepEqual(Object.keys(r.paid), ['b|2026-10-28']);
});

test('bill payments are identified so the spending maths can keep them out of a single day', () => {
  const bills = [make({ id: 'r' })];
  const period = { start: '2026-10-01', end: '2026-10-31', today: '2026-10-29' };
  const matched = pay('m', '2026-10-27', 12000, 'Rent');
  const rows = B.billOccurrences({ bills, paid: {}, expenses: [matched], ...period });
  assert.deepEqual(B.billPaymentIds(rows, [matched], {}), ['m']);
  // recorded by "Mark paid": it carries a billKey and the paid note exists
  const key = B.keyOf('r', '2026-10-28');
  const marked = { id: 'k', date: '2026-10-22', amount: 12000, description: 'Rent', billKey: key };
  const paid = B.markPaid({}, key, '2026-10-22');
  const rows2 = B.billOccurrences({ bills, paid, expenses: [marked], ...period });
  assert.deepEqual(B.billPaymentIds(rows2, [marked], paid), ['k']);
  assert.deepEqual(B.billPaymentIds([], [marked], {}), []);                          // un-marked: an ordinary expense again
  assert.deepEqual(B.billPaymentIds(rows2, [marked], paid, '2026-10-21'), []);       // as of an earlier day it had not happened
  assert.deepEqual(B.billPaymentIds(null, null, null), []);
});

console.log(`\n${passed} bills tests passed.`);
