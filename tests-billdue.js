// Bill reminders from utilities, phone companies, card issuers and lenders: sample wording with invented amounts and names.
const assert = require('node:assert/strict');
const { parseBankSms, toBillSuggestion } = require('./sms-parser.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }
const receivedAt = new Date('2026-10-20T10:00:00').getTime();
const parse = (text, sender = 'AX-AIRTEL') => parseBankSms(text, { sender, receivedAt, now: new Date('2026-10-20T10:00:00') });

test('a phone bill reminder becomes a bill with its amount and due date', () => {
  const r = parse('Your Airtel postpaid bill of Rs 499.00 is due on 25-10-2026. Pay now to avoid late fee.');
  assert.equal(r.ok, true); assert.equal(r.kind, 'upcoming');
  assert.equal(r.amount, 499); assert.equal(r.date, '2026-10-25'); assert.equal(r.repeat, 'monthly');
  const bill = toBillSuggestion(r);
  assert.deepEqual([bill.title, bill.amount, bill.dueDate, bill.source], ['Airtel bill', 499, '2026-10-25', 'sms']);
});

test('the total due on a card statement is read, not the credit limit', () => {
  const r = parse('Your credit card statement is ready. Total amount due Rs 5,432.10, minimum due Rs 270. Pay by 28-Oct-26. Avl credit limit Rs 80,000.', 'VM-CARDBK');
  assert.equal(r.ok, true); assert.equal(r.amount, 5432.1); assert.equal(r.date, '2026-10-28');
  assert.equal(toBillSuggestion(r).title, 'Credit card bill');
});

test('a due date without a year means the next time that day comes round', () => {
  const r = parse('EMI of Rs 3,200 is due on 05 Nov. Please keep funds ready.', 'VM-LOANCO');
  assert.equal(r.ok, true); assert.equal(r.amount, 3200); assert.equal(r.date, '2026-11-05'); assert.equal(toBillSuggestion(r).title, 'EMI'); assert.equal(r.repeat, 'monthly');
});

test('an electricity bill is named from the message', () => {
  const r = parse('BSES: Your electricity bill of Rs 1,240 is due by 27-10-2026.', 'VK-BSESDL');
  assert.equal(r.ok, true); assert.equal(toBillSuggestion(r).title, 'Electricity bill'); assert.equal(r.repeat, 'once');
});

test('a bill that was already paid, an offer or an OTP is not a bill', () => {
  assert.equal(parse('Thank you for your payment of Rs 499. Your bill due on 25-10-2026 is cleared.').ok, false);
  assert.equal(parse('Payment of Rs 499 received successfully for your bill due on 25-10-2026.').ok, false);
  assert.equal(parse('Congratulations! Pre-approved loan offer. EMI from Rs 999. Apply now, due date 30-10-2026.').ok, false);
  assert.equal(parse('Your OTP for bill payment of Rs 499 due on 25-10-2026 is 123456.').ok, false);
});

test('a reminder with no amount or no date is left alone', () => {
  assert.equal(parse('Your bill is due soon. Please pay on time.').ok, false);
  assert.equal(parse('Your bill of Rs 499 is ready.').ok, false);
});

const Upi = require('./upi.js');
test('a bill reminder in a UPI app notification becomes a bill message; payments and offers do not', () => {
  const at = new Date('2026-10-20T10:00:00').getTime();
  const out = Upi.billMessages([
    { title: 'Electricity bill due', text: 'Pay ₹1,240 by 27 Oct to avoid a late fee.', postedAt: at },
    { title: 'Payment successful', text: 'You paid ₹20 to Roop Sagar Foodw', postedAt: at },
    { title: 'Cashback offer', text: 'Win up to ₹500. Use code PAY5. T&C apply.', postedAt: at },
  ], parseBankSms);
  assert.equal(out.length, 1); assert.equal(out[0].sender, 'UPIAPP'); assert.match(out[0].body, /Electricity bill due/);
  assert.equal(toBillSuggestion(parseBankSms('Airtel bill due. Pay ₹499 by 28 Oct.', { sender: 'UPIAPP', receivedAt: at })).title, 'Airtel bill');
  assert.equal(toBillSuggestion(parseBankSms('Electricity bill due. Pay ₹1,240 by 27 Oct.', { sender: 'UPIAPP', receivedAt: at })).title, 'Electricity bill');
  const r = parseBankSms(out[0].body, { sender: 'UPIAPP', receivedAt: at });
  assert.equal(r.kind, 'upcoming'); assert.equal(r.amount, 1240); assert.equal(r.date, '2026-10-27');
});
console.log(`\n${passed} bill reminder tests passed.`);
