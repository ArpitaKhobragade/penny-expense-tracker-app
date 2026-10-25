// Bank SMS fixtures below are invented examples in the common Indian formats; account numbers and names are fake.
const assert = require('node:assert/strict');
const { parseBankSms, toExpense, toBillSuggestion, toSalarySuggestion, findDuplicate, learnCategory, isBankSender, merchantKey } = require('./sms-parser.js');
const { detectCategory } = require('./expense-utils.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const receivedAt = new Date('2026-05-12T10:00:00').getTime();
const parse = (text, extra = {}) => parseBankSms(text, { receivedAt, ...extra });
const ignored = (text, reason, extra) => { const r = parse(text, extra); assert.equal(r.ok, false, `expected "${text}" to be ignored`); assert.equal(r.reason, reason); };

test('HDFC-style UPI debit: amount, merchant, category, date, ref, account', () => {
  const r = parse('Rs.120.00 debited from a/c **1234 on 12-05-26 to VPA swiggy@ybl(UPI Ref No 412345678901)');
  assert.equal(r.ok, true); assert.equal(r.kind, 'debit');
  assert.equal(r.amount, 120); assert.equal(r.merchant, 'Swiggy'); assert.equal(r.category, 'Food');
  assert.equal(r.date, '2026-05-12'); assert.equal(r.ref, '412345678901'); assert.equal(r.account, '1234');
});

test('SBI-style "debited by" with no currency symbol', () => {
  const r = parse('Dear UPI user A/C X1234 debited by 500.0 on date 12May26 trf to RAHUL SHARMA Refno 123456789012. If not u? call 1800111109');
  assert.equal(r.ok, true); assert.equal(r.kind, 'debit');
  assert.equal(r.amount, 500); assert.equal(r.merchant, 'Rahul Sharma'); assert.equal(r.date, '2026-05-12');
  assert.equal(r.ref, '123456789012'); assert.equal(r.account, '1234');
});

test('real SBI UPI message (account digits and reference replaced): payee is cut short by the bank', () => {
  const r = parse('Dear UPI user A/C X1234 debited by 24.00 on date 21Oct26 trf to Roop Sagar Foodw Refno 111111111111 If not u? call-1800111109 for other services-18001234-SBI', { sender: 'AX-SBIUPI', receivedAt: new Date('2026-10-22T10:00:00').getTime() });
  assert.equal(r.ok, true); assert.equal(r.kind, 'debit'); assert.equal(r.amount, 24);
  assert.equal(r.date, '2026-10-21'); assert.equal(r.account, '1234'); assert.equal(r.ref, '111111111111');
  assert.equal(r.merchant, 'Roop Sagar Foodw'); assert.equal(r.category, 'Food');
});

test('truncated payee names still find a category from the start of a word', () => {
  assert.equal(detectCategory('Sri Krishna Restaur'), 'Food');
  assert.equal(detectCategory('Apollo Pharma'), 'Health');
  assert.equal(detectCategory('Roop Sagar Foodw'), 'Food');
  assert.equal(detectCategory('Rahul Sharma'), 'Other');
  assert.equal(detectCategory('Foodie Mart'), 'Food');
});

test('card spend: merchant after "at", ignores the available limit', () => {
  const r = parse('Rs 499.00 spent on HDFC Bank Card x1234 at AMAZON on 2026-05-12. Avl Limit Rs 50000');
  assert.equal(r.amount, 499); assert.equal(r.merchant, 'Amazon'); assert.equal(r.category, 'Shopping'); assert.equal(r.account, '1234');
});

test('ICICI-style: payee sits before the word "credited"', () => {
  const r = parse('ICICI Bank Acct XX123 debited for Rs 500.00 on 12-May-26; RAHUL SHARMA credited. UPI:123456789012');
  assert.equal(r.kind, 'debit'); assert.equal(r.amount, 500); assert.equal(r.merchant, 'Rahul Sharma');
  assert.equal(r.date, '2026-05-12'); assert.equal(r.ref, '123456789012'); assert.equal(r.account, '123');
});

test('"Sent Rs ... To NAME" is a debit even without the word debited', () => {
  const r = parse('Sent Rs.500.00 From HDFC Bank A/C *1234 To RAHUL SHARMA On 12/05/26 Ref 123456789012 Not You? Call 18002586161');
  assert.equal(r.kind, 'debit'); assert.equal(r.amount, 500); assert.equal(r.merchant, 'Rahul Sharma'); assert.equal(r.date, '2026-05-12');
});

test('uses the debit amount, never the balance that follows it', () => {
  const r = parse('Rs 200 debited from A/c XX1234 to ZOMATO. Avl Bal Rs 15000.55');
  assert.equal(r.amount, 200); assert.equal(r.merchant, 'Zomato');
});

test('reads Indian digit grouping', () => {
  assert.equal(parse('Rs.1,25,000.50 debited from A/c XX1234 to Landlord').amount, 125000.5);
});

test('personal UPI id keeps the id as the merchant and stays uncategorised', () => {
  const r = parse('Rs 300 debited from A/c XX1234 to VPA 9876543210@ybl on 12-05-26');
  assert.equal(r.merchant, '9876543210@ybl'); assert.equal(r.category, 'Other'); assert.equal(r.categoryConfidence, 'unknown');
});

test('ATM withdrawal is a debit', () => {
  const r = parse('Rs 2000 withdrawn at ATM-MG ROAD from A/c XX1234 on 12-05-26');
  assert.equal(r.kind, 'debit'); assert.equal(r.amount, 2000);
});

test('credits are recognised but never become expenses', () => {
  const r = parse('Rs 5000.00 credited to your A/c XX1234 on 12-05-26 by UPI');
  assert.equal(r.ok, true); assert.equal(r.kind, 'credit'); assert.equal(toExpense(r), null);
});

test('ignores OTP, upcoming debits, collect requests, failures and promotions', () => {
  ignored('123456 is your OTP for txn of Rs 500 at AMAZON. Do not share.', 'otp');
  ignored('Your autopay will be debited soon, please keep funds ready', 'upcoming'); // no amount or date: nothing to suggest
  ignored('RAHUL has requested Rs 500 from you. Approve the request on your UPI app', 'request');
  ignored('Your UPI txn of Rs 500 to swiggy@ybl has failed. Amount not debited.', 'failed');
  ignored('You are pre-approved: a loan of Rs 5,00,000 can be sent to you. Apply now', 'promotional');
  ignored('Your A/c XX1234 balance is Rs 15000. Thank you for banking with us. Apply for a loan today', 'not-transaction');
  ignored('Congratulations! Your A/c XX1234 has a pre-approved offer. Avl bal Rs 15000', 'not-transaction');
  ignored('', 'empty');
});

test('ignores texts from phone numbers and saved contacts, accepts bank sender IDs', () => {
  const text = 'Rs 500 debited from A/c XX1234 to VPA shop@ybl';
  ignored(text, 'not-bank-sender', { sender: '+919876543210' });
  ignored(text, 'not-bank-sender', { sender: 'Mom' });
  assert.equal(parse(text, { sender: 'VM-HDFCBK-S' }).ok, true);
  assert.equal(parse(text, { sender: 'AX-SBIUPI' }).ok, true);
  assert.equal(isBankSender('HDFCBK'), true);
  assert.equal(isBankSender(''), true);
});

test('date falls back to the received time when the text has none, and ignores far-future dates', () => {
  assert.equal(parse('Rs 50 debited from A/c XX1234 to VPA tea@ybl').date, '2026-05-12');
  assert.equal(parse('Rs 50 debited from A/c XX1234 to VPA tea@ybl on 12-05-35').date, '2026-05-12');
});

test('toExpense produces a review-inbox record', () => {
  const e = toExpense(parse('Rs.120.00 debited from a/c **1234 on 12-05-26 to VPA swiggy@ybl(UPI Ref No 412345678901)'));
  assert.equal(e.source, 'sms'); assert.equal(e.needsReview, true); assert.equal(e.description, 'Swiggy');
  assert.equal(e.amount, 120); assert.equal(e.category, 'Food'); assert.equal(e.date, '2026-05-12'); assert.ok(e.smsId);
});

test('a category you pick is remembered for that merchant', () => {
  const text = 'Rs 150 debited from A/c XX1234 to VPA swiggy@ybl on 12-05-26';
  let memory = learnCategory({}, 'swiggy@ybl', 'Entertainment');
  const r = parse(text, { memory });
  assert.equal(r.category, 'Entertainment'); assert.equal(r.categoryConfidence, 'learned');
  assert.equal(parse(text, { memory: learnCategory(memory, 'swiggy@ybl', 'Other') }).category, 'Food');
  assert.equal(merchantKey('Swiggy@ybl'), merchantKey('swiggy@okaxis'));
});

test('duplicates: same SMS twice, same payment seen by two sources, hand-typed twin', () => {
  const sms = 'Rs.120.00 debited from a/c **1234 on 12-05-26 to VPA swiggy@ybl(UPI Ref No 412345678901)';
  const first = toExpense(parse(sms, { sender: 'VM-HDFCBK-S' }));
  assert.equal(findDuplicate(first, []), null);
  assert.equal(findDuplicate(first, [first]).level, 'certain');
  // same payment arriving later as a notification: same ref, different smsId
  const viaNotification = { ...first, smsId: 'other', receivedAt: receivedAt + 5000 };
  assert.equal(findDuplicate(viaNotification, [first]).level, 'certain');
  // same shop and amount with a different ref is a different payment
  assert.equal(findDuplicate({ ...first, smsId: 'x', ref: '999999999999' }, [first]), null);
  // no refs: close in time is a duplicate, hours apart is only a maybe
  const a = toExpense(parse('Rs 60 debited from A/c XX1234 to VPA chai@ybl on 12-05-26', { receivedAt }));
  const b = toExpense(parse('Rs 60 debited from A/c XX1234 to VPA chai@ybl on 12-05-26', { receivedAt: receivedAt + 30000 }));
  const c = toExpense(parse('Rs 60 debited from A/c XX1234 to VPA chai@ybl on 12-05-26', { receivedAt: receivedAt + 3 * 3600000 }));
  assert.equal(findDuplicate(b, [a]).level, 'certain');
  assert.equal(findDuplicate(c, [a]).level, 'possible'); // same shop, amount and day but hours apart: ask, don't guess
  assert.equal(findDuplicate({ ...c, merchantKey: 'other shop' }, [a]), null);
  // a hand-typed expense with the same amount and day is only flagged, not dropped
  const manual = { id: 'm1', amount: 120, date: '2026-05-12', description: 'Lunch', category: 'Food' };
  assert.equal(findDuplicate(first, [manual]).level, 'possible');
});

test('upcoming payments with an amount and a date become bill suggestions, not expenses', () => {
  const r = parse('Rs 999 will be debited from your A/c on 15-05-26 towards Netflix');
  assert.equal(r.ok, true); assert.equal(r.kind, 'upcoming');
  assert.equal(r.amount, 999); assert.equal(r.date, '2026-05-15'); assert.equal(r.merchant, 'Netflix'); assert.equal(r.category, 'Entertainment');
  assert.equal(r.repeat, 'once');
  assert.equal(toExpense(r), null);                                           // it has not happened, so it is not spending
  const bill = toBillSuggestion(r);
  assert.deepEqual([bill.title, bill.amount, bill.dueDate, bill.repeat, bill.source], ['Netflix', 999, '2026-05-15', 'once', 'sms']);
  assert.equal(toBillSuggestion(parse('Rs 120 debited from A/c XX1234 to VPA a@ybl')), null);
});

test('real mandate notice (Central Bank of India wording, reference kept as given): amount, due date, shop, repeating', () => {
  const r = parse('Ur upcoming mandate is set 19-10-2026 and ur A/c will be DR with Rs. 123.00 towards Flipkart for ASPRESENTED Ref- YJP9b955757a31a46dcbe94e7b7d4912050. If mandate is paused execution will not happen - Central Bank of India', { sender: 'VM-CBINDA-S' });
  assert.equal(r.ok, true); assert.equal(r.kind, 'upcoming');
  assert.equal(r.amount, 123); assert.equal(r.date, '2026-10-19'); assert.equal(r.merchant, 'Flipkart'); assert.equal(r.category, 'Shopping');
  assert.equal(r.ref, 'YJP9b955757a31a46dcbe94e7b7d4912050'); assert.equal(r.repeat, 'monthly'); // a mandate repeats
  assert.equal(toBillSuggestion(r).dueDate, '2026-10-19');
});

test('real SBI credit from a person (name and numbers replaced): read as money in, never as spending or as a salary', () => {
  const r = parse('Dear SBI User, your A/c X1234-credited by Rs.200 on 27Sep25 transfer from Mrs TEST PERSON1 Ref No 111111111111 -SBI', { sender: 'AX-SBIINB' });
  assert.equal(r.ok, true); assert.equal(r.kind, 'credit'); assert.equal(r.amount, 200);
  assert.equal(r.date, '2025-09-27'); assert.equal(r.ref, '111111111111'); assert.equal(r.account, '1234');
  assert.equal(toExpense(r), null);
});

test('an alphanumeric reference is only taken when it mixes letters and digits', () => {
  assert.equal(parse('Rs 50 will be debited on 15-05-26 towards Shop. Ref- ABCDEFGHIJKLMN').ref, '');
  assert.equal(parse('Rs 50 will be debited on 15-05-26 towards Shop. Ref- 123456789012').ref, '123456789012');
});

// These are INVENTED salary messages in formats typical of Indian banks. No real salary message was available to check against.
test('invented salary credits are marked as salary and give a payday suggestion', () => {
  const samples = [
    ['Dear Customer, your A/c X1234 is credited by Rs.45000.00 on 01May26 by transfer from ACME TECHNOLOGIES PVT LTD SALARY. Ref No 111111111111 -SBI', '2026-05-01'],
    ['Your A/c XXXXXX1234 has been credited with INR 45,000.00 on 30-04-26 towards SALARY APR 2026. Avl Bal INR 52,310.55', '2026-04-30'],
    ['NEFT Cr-ACMEPVT-SAL-Rs 45000 credited to A/c X1234 on 28/04/26 Ref 111111111111', '2026-04-28'],
    ['Rs 45,000.00 credited to your A/c XX1234 on 12-05-26. Payroll credit from ACME INDIA', '2026-05-12'],
  ];
  for (const [text, date] of samples) {
    const r = parse(text);
    assert.equal(r.ok, true, text); assert.equal(r.kind, 'credit'); assert.equal(r.amount, 45000); assert.equal(r.date, date); assert.equal(r.salary, true, text);
    const s = toSalarySuggestion(r);
    assert.deepEqual([s.amount, s.date, s.source], [45000, date, 'sms']);
    assert.equal(toExpense(r), null);
  }
});

test('credits that are not a salary, or only mention the word in an offer, are not marked', () => {
  for (const text of [
    'Rs 200 credited to your A/c XX1234 on 12-05-26 by transfer from a friend. Ref No 111111111111',
    'Apply for a salary account today! Rs 500 credited as a welcome bonus to A/c XX1234 on 12-05-26',
    'Rs 3000 credited to A/c XX1234 on 10-05-26: salary advance repaid',
    'Your personal loan of Rs 50000 is credited to A/c XX1234 on 10-05-26. Salary linked offer applies',
  ]) {
    const r = parse(text);
    assert.equal(r.kind, 'credit', text); assert.equal(r.salary, false, text); assert.equal(toSalarySuggestion(r), null);
  }
  // money going OUT is never a salary, whatever words it contains
  const out = parse('Rs 500 debited from A/c XX1234 to VPA salary.shop@ybl on 12-05-26');
  assert.equal(out.kind, 'debit'); assert.equal(out.salary, false); assert.equal(toSalarySuggestion(out), null);
});

console.log(`\n${passed} SMS parser tests passed.`);
