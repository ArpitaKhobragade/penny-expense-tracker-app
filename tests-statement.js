const assert = require('node:assert/strict');
const St = require('./statement.js');
const Ac = require('./accounts.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

let counter = 0;
const opts = { now: new Date(2026, 9, 23, 10), newId: () => `s${++counter}` };

// Invented statement in the usual Indian layout: lines about the account, then the table, oldest first.
const SBI_LIKE = [
  'Account Name :  TEST USER',
  'Account Number : 00000012349742',
  'Statement from 01-10-2026 to 22-10-2026',
  '',
  'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance',
  '01 Oct 2026,01 Oct 2026,"SALARY CREDIT ACME LTD",,,"50,000.00","52,000.00"',
  '05 Oct 2026,05 Oct 2026,UPI/DR/100000000101/SWIGGY/okaxis/Payment,,"450.00",,"51,550.00"',
  '12 Oct 2026,12 Oct 2026,UPI/DR/100000000102/TEST SHOP/ybl/Payment,,"1,200.50",,"50,349.50"',
  '12 Oct 2026,12 Oct 2026,ATM WDL ATM-MG ROAD,,2000,,48349.50',
  '22 Oct 2026,22 Oct 2026,UPI/CR/100000000103/ASHA RAO/ybl/Payment,,,500,"48,849.50"',
].join('\n');

test('reads the payments, the money coming in, the account and the balance on the last day', () => {
  const r = St.parseStatement(SBI_LIKE);
  assert.equal(r.ok, true); assert.equal(r.rows.length, 5); assert.equal(r.account, '9742');
  assert.deepEqual(r.balance, { value: 48849.5, date: '2026-10-22' });
  const swiggy = r.rows[1];
  assert.equal(swiggy.debit, 450); assert.equal(swiggy.date, '2026-10-05'); assert.equal(swiggy.description, 'Swiggy'); assert.equal(swiggy.ref, '100000000101');
  assert.equal(r.rows[2].debit, 1200.5); assert.equal(r.rows[2].description, 'Test Shop');
  assert.equal(r.rows[3].debit, 2000); assert.equal(r.rows[3].description, 'ATM withdrawal');
  assert.equal(r.rows[4].credit, 500); assert.equal(r.rows[4].debit, 0);
});

test('works with other layouts: newest first, tab separated, one amount column with Dr/Cr, other date styles', () => {
  const newestFirst = ['Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance', '22/10/26,Chai Stall,20.00,,900.00', '21/10/26,Cab,150,,920.00'].join('\n');
  const a = St.parseStatement(newestFirst);
  assert.equal(a.ok, true); assert.deepEqual(a.balance, { value: 900, date: '2026-10-22' }); assert.equal(a.rows[0].date, '2026-10-22');
  const tabs = ['Date\tDescription\tDebit\tCredit\tBalance', '2026-10-21\tBus\t30\t\t100'].join('\n');
  assert.equal(St.parseStatement(tabs).rows[0].debit, 30);
  const oneColumn = ['Date;Particulars;Amount;Dr/Cr;Balance', '21-Oct-2026;Medicine;340.00;DR;5,000.00', '22-Oct-2026;Refund;100.00;CR;5,100.00'].join('\n');
  const b = St.parseStatement(oneColumn);
  assert.equal(b.rows[0].debit, 340); assert.equal(b.rows[1].credit, 100); assert.deepEqual(b.balance, { value: 5100, date: '2026-10-22' });
});

test('a file that is not a statement is explained, not guessed at', () => {
  assert.equal(St.parseStatement('').ok, false);
  assert.match(St.parseStatement('hello,world\n1,2').error, /columns/);
  assert.match(St.parseStatement('Date,Description,Debit,Credit,Balance\nnot a date,x,5,,5').error, /no payments/);
});

test('importing adds only payments not already recorded, with a category, and leaves incoming money out', () => {
  const statement = St.parseStatement(SBI_LIKE);
  const existing = [{ id: 'old', amount: 450, date: '2026-10-05', description: 'Swiggy', category: 'Food', ref: '100000000101' }];
  const plan = St.importPlan(statement, existing, opts);
  assert.equal(plan.expenses.length, 2); assert.equal(plan.duplicates, 1); assert.equal(plan.credits, 2);
  assert.deepEqual(plan.expenses.map(e => e.amount), [1200.5, 2000]);
});

test('an imported payment carries its date, source and account, and importing the same file twice adds nothing', () => {
  const statement = St.parseStatement(SBI_LIKE);
  const first = St.importPlan(statement, [], opts);
  assert.equal(first.expenses.length, 3);
  assert.ok(first.expenses.every(e => e.source === 'statement' && e.account === '9742' && e.date >= '2026-10-01'));
  assert.equal(first.expenses.find(e => e.description === 'Swiggy').category, 'Food');
  const again = St.importPlan(statement, first.expenses, opts);
  assert.equal(again.expenses.length, 0); assert.equal(again.duplicates, 3);
});

test('the statement balance is offered as a reading for the account, and a newer message still wins over it', () => {
  const plan = St.importPlan(St.parseStatement(SBI_LIKE), [], opts);
  assert.equal(plan.reading.account, '9742'); assert.equal(plan.reading.balance, 48849.5); assert.equal(plan.reading.date, '2026-10-22');
  let data = Ac.applyBalances({ accounts: [], hidden: [] }, [plan.reading]);
  assert.equal(data.accounts[0].balance, 48849.5);
  data = Ac.applyBalances(data, [{ account: '9742', balance: 48000, date: '2026-10-23', stamp: 1 }]);   // a message from the next day
  assert.equal(data.accounts[0].balance, 48000);
  const noAccount = St.parseStatement(SBI_LIKE.replace('Account Number : 00000012349742', ''));
  assert.equal(St.importPlan(noAccount, [], opts).reading, null);                       // no digits: the screen asks which account
});

console.log(`\n${passed} statement tests passed.`);
