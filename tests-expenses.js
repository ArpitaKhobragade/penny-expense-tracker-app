const assert = require('node:assert/strict');
const { editExpense, searchExpenses } = require('./expenses.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const list = () => [
  { id: 'a', amount: 120, description: 'Swiggy', category: 'Food', date: '2026-10-20', source: 'sms', smsId: 'abc', ref: '111111111111' },
  { id: 'b', amount: 1500, description: 'Shoes', category: 'Shopping', date: '2026-10-21' },
  { id: 'c', amount: 150, description: 'Auto to office', category: 'Travel', date: '2026-10-22', billKey: 'x|2026-10-22' },
];

test('editing changes only what you edit and keeps where the expense came from', () => {
  const original = list();
  const r = editExpense(original, 'a', { amount: '125.5', category: 'Entertainment' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.expense.amount, r.expense.category, r.expense.description, r.expense.date], [125.5, 'Entertainment', 'Swiggy', '2026-10-20']);
  assert.deepEqual([r.expense.source, r.expense.smsId, r.expense.ref, r.expense.edited], ['sms', 'abc', '111111111111', true]);
  assert.equal(r.expenses.length, 3); assert.equal(r.expenses[1], original[1]);   // others untouched
  assert.equal(original[0].amount, 120);                                           // the old list is unchanged
});

test('the description is trimmed, capped, and never left empty', () => {
  assert.equal(editExpense(list(), 'a', { description: '  Lunch  ' }).expense.description, 'Lunch');
  assert.equal(editExpense(list(), 'a', { description: '   ' }).expense.description, 'Expense');
  assert.equal(editExpense(list(), 'a', { description: 'x'.repeat(300) }).expense.description.length, 100);
});

test('bad edits are refused and nothing changes', () => {
  assert.equal(editExpense(list(), 'a', { amount: 0 }).ok, false);
  assert.equal(editExpense(list(), 'a', { amount: 'abc' }).ok, false);
  assert.equal(editExpense(list(), 'a', { amount: -5 }).ok, false);
  assert.equal(editExpense(list(), 'a', { date: '2026-02-31' }).ok, false);
  assert.equal(editExpense(list(), 'a', { date: 'tomorrow' }).ok, false);
  assert.equal(editExpense(list(), 'a', { category: 'Crypto' }).ok, false);
  assert.equal(editExpense(list(), 'missing', { amount: 5 }).ok, false);
});

test('an expense that paid a bill keeps its link to that bill when edited', () => {
  assert.equal(editExpense(list(), 'c', { amount: 175 }).expense.billKey, 'x|2026-10-22');
});

test('search finds text in the description or category, and amounts', () => {
  assert.deepEqual(searchExpenses(list(), 'swiggy').map(e => e.id), ['a']);
  assert.deepEqual(searchExpenses(list(), 'TRAVEL').map(e => e.id), ['c']);
  assert.deepEqual(searchExpenses(list(), 'office').map(e => e.id), ['c']);
  assert.deepEqual(searchExpenses(list(), '150').map(e => e.id), ['b', 'c']);        // 1500 and 150
  assert.deepEqual(searchExpenses(list(), '₹1,500').map(e => e.id), ['b']);
  assert.equal(searchExpenses(list(), '  ').length, 3);
  assert.equal(searchExpenses(list(), 'nothing like this').length, 0);
});

console.log(`\n${passed} expense edit tests passed.`);
