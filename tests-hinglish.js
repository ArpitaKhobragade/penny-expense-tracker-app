const assert = require('node:assert/strict');
const { parseNaturalExpense, detectCategory } = require('./expense-utils.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const NOW = new Date('2026-10-17T10:00:00');
const parse = text => parseNaturalExpense(text, NOW);
const expect = (text, amount, category, date, description) => {
  const r = parse(text);
  assert.equal(r.ok, true, text);
  assert.deepEqual([r.expense.amount, r.expense.category, r.expense.date, r.expense.description], [amount, category, date, description], text);
};

test('Hindi in English letters: item and amount in either order', () => {
  expect('chai 20', 20, 'Food', '2026-10-17', 'Chai');
  expect('sabzi 150', 150, 'Food', '2026-10-17', 'Sabzi');
  expect('150 ki sabzi', 150, 'Food', '2026-10-17', 'Sabzi');
  expect('kirana 560', 560, 'Food', '2026-10-17', 'Kirana');
  expect('dawai 340', 340, 'Health', '2026-10-17', 'Dawai');
});

test('"rupaye" and "rs" after the number, and the usual filler words', () => {
  expect('150 rupaye ka petrol aaj', 150, 'Travel', '2026-10-17', 'Petrol');
  expect('maine auto me 80 kharch kiye', 80, 'Travel', '2026-10-17', 'Auto');
  expect('bijli bill 1,250 rupaye', 1250, 'Bills', '2026-10-17', 'Bijli bill');
  expect('200 rs doodh', 200, 'Food', '2026-10-17', 'Doodh');
  expect('kapde 899 ke liye', 899, 'Shopping', '2026-10-17', 'Kapde');
});

test('"kal" is yesterday and "parso" is the day before; "aaj" is today', () => {
  expect('kal 200 ka petrol', 200, 'Travel', '2026-10-16', 'Petrol');
  expect('sabzi 150 kal', 150, 'Food', '2026-10-16', 'Sabzi');
  expect('parso bijli bill 1,250 rupaye', 1250, 'Bills', '2026-10-15', 'Bijli bill');
  expect('parson auto 60', 60, 'Travel', '2026-10-15', 'Auto');
  expect('aaj chai 15', 15, 'Food', '2026-10-17', 'Chai');
});

test('a word that only contains "kal" does not move the date', () => {
  assert.equal(parse('Kalyan trip 500').expense.date, '2026-10-17');
});

test('English entries still work exactly as before', () => {
  expect('Spent ₹120 on lunch', 120, 'Food', '2026-10-17', 'Lunch');
  expect('Spent 450 on cab yesterday', 450, 'Travel', '2026-10-16', 'Cab');
  expect('Paid Rs. 1,250 for groceries', 1250, 'Food', '2026-10-17', 'Groceries');
  assert.equal(parse('Spent 80 on tea day before yesterday').expense.date, '2026-10-15');
});

test('no amount is still refused', () => {
  assert.equal(parse('sabzi').ok, false);
  assert.equal(parse('kal chai').ok, false);
  assert.equal(parse('   ').ok, false);
});

test('everyday Hindi words find a category', () => {
  assert.equal(detectCategory('Roti'), 'Food'); assert.equal(detectCategory('Rikshaw'), 'Travel'); assert.equal(detectCategory('Kiraya'), 'Bills');
  assert.equal(detectCategory('School fees'), 'Education'); assert.equal(detectCategory('Movie'), 'Entertainment'); assert.equal(detectCategory('Random thing'), 'Other');
});

console.log(`\n${passed} Hinglish entry tests passed.`);
