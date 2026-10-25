const assert = require('node:assert/strict');
const { parseNaturalExpense } = require('./expense-utils.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const NOW = new Date('2026-10-23T10:00:00');   // a Friday
const parse = text => parseNaturalExpense(text, NOW);
const got = text => { const r = parse(text); assert.equal(r.ok, true, text); return [r.expense.amount, r.expense.date, r.expense.description]; };

test('the examples shown in the app all work', () => {
  assert.deepEqual(got('chai 20 today'), [20, '2026-10-23', 'Chai']);
  assert.deepEqual(got('auto 80 yesterday'), [80, '2026-10-22', 'Auto']);
  assert.deepEqual(got('movie 300 on 12 oct'), [300, '2026-10-12', 'Movie']);
});

test('a written date in any common form, and the number in the date is never taken as the amount', () => {
  assert.deepEqual(got('lunch 200 on 15 oct'), [200, '2026-10-15', 'Lunch']);
  assert.deepEqual(got('on 15 oct lunch 200'), [200, '2026-10-15', 'Lunch']);
  assert.deepEqual(got('lunch 200 15th october'), [200, '2026-10-15', 'Lunch']);
  assert.deepEqual(got('lunch 200 oct 15'), [200, '2026-10-15', 'Lunch']);
  assert.deepEqual(got('rent 8000 on 5/10'), [8000, '2026-10-05', 'Rent']);
  assert.deepEqual(got('cab 150 on 15-10-2026'), [150, '2026-10-15', 'Cab']);
  assert.deepEqual(got('cab 150 2026-10-15'), [150, '2026-10-15', 'Cab']);
  assert.deepEqual(got('gift 500 on 3 sep 2025'), [500, '2025-09-03', 'Gift']);
  assert.deepEqual(got('₹250 dinner 2 oct'), [250, '2026-10-02', 'Dinner']);
});

test('days ago and weekdays go back to the most recent one', () => {
  assert.deepEqual(got('chai 20 3 days ago'), [20, '2026-10-20', 'Chai']);
  assert.deepEqual(got('petrol 500 last friday'), [500, '2026-10-16', 'Petrol']);      // today is a Friday: the one before
  assert.deepEqual(got('petrol 500 on monday'), [500, '2026-10-19', 'Petrol']);
});

test('a date with no year is this year, but more than a month ahead means last year; nonsense dates are left alone', () => {
  assert.deepEqual(got('gift 500 on 28 oct'), [500, '2026-10-28', 'Gift']);              // a few days ahead: a bill still to come
  assert.deepEqual(got('gift 500 on 25 dec'), [500, '2025-12-25', 'Gift']);              // far ahead: it must have been last year
  const odd = parse('lunch 200 on 31 feb');
  assert.equal(odd.ok, true); assert.equal(odd.expense.date, '2026-10-23');
});

test('the words from before still work and a missing amount is explained with the example', () => {
  assert.deepEqual(got('sabzi 150 kal'), [150, '2026-10-22', 'Sabzi']);
  assert.deepEqual(got('spent 450 on cab'), [450, '2026-10-23', 'Cab']);
  const none = parse('lunch with friends');
  assert.equal(none.ok, false); assert.match(none.error, /chai 20 today/);
});

console.log(`\n${passed} type-it tests passed.`);
