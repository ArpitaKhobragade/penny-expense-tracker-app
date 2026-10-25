const assert = require('node:assert/strict');
const Ac = require('./accounts.js');
const P = require('./sms-parser.js');
const I = require('./inbox.js');
const S = require('./store.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const empty = () => ({ accounts: [], hidden: [] });
const reading = (account, balance, date, stamp = 1) => ({ account, balance, date, stamp });
const at = (d, h = 12) => new Date(2026, 9, d, h).getTime();
const parse = (text, extra = {}) => P.parseBankSms(text, { sender: 'AX-SBIUPI', receivedAt: at(22), ...extra });

test('reads the balance from the usual wordings', () => {
  assert.equal(parse('Rs.500.00 debited from A/c X9742 on 22-10-26 to VPA shop@ybl. Avl Bal Rs.1,234.56 UPI Ref 100000000011').balance, 1234.56);
  assert.equal(parse('Your A/c XX1234 credited Rs 300 on 22Oct26. Available balance in a/c XX1234 is INR 5,000.00').balance, 5000);
  assert.equal(parse('Rs 40 debited from A/c X9742 on 22-10-26 to Test Shop. Bal: 880').balance, 880);
  assert.equal(parse('Rs 40 debited from A/c X9742 on 22-10-26 to Test Shop').balance, null);
});

test('the amount is never mistaken for the balance, nor a card limit or a minimum for a balance', () => {
  const r = parse('Rs.500.00 debited from A/c X9742 on 22-10-26 to Test Shop. Avl Bal Rs.1,234.56');
  assert.equal(r.amount, 500); assert.equal(r.balance, 1234.56);
  assert.equal(parse('Rs 100 spent on Card XX5555 at Test Shop on 22-10-26. Avl Limit Rs 40,000').balance, null);
  assert.equal(parse('Rs 100 debited from A/c X9742 on 22-10-26 to Test Shop. Min Bal Rs 500 required').balance, null);
  assert.equal(parse('Rs 100 debited from A/c X9742 on 22-10-26 to Test Shop. Avl Bal Rs 50.00 Dr').balance, null);   // overdrawn
});

test('a message that only reports a balance is read, offers that mention a balance are not', () => {
  const r = parse('Available Bal in a/c XX1234 is Rs 750.25 as on 22-10-26');
  assert.equal(r.ok, true); assert.equal(r.kind, 'balance'); assert.equal(r.balance, 750.25); assert.equal(r.account, '1234'); assert.equal(r.date, '2026-10-22');
  assert.equal(P.toExpense(r), null);
  assert.equal(parse('Your A/c XX1234 balance is Rs 15000. Apply for a loan today').ok, false);
  assert.equal(parse('Check your balance anytime on our app').ok, false);
});

test('the inbox hands over the balances found, and a balance-only message adds nothing to review', () => {
  const inbox = { inbox: [], upcoming: [], salary: [], settle: [], memory: {}, dismissed: [] };
  const run = I.ingestMessages('Rs.500.00 debited from A/c X9742 on 22-10-26 to Test Shop. Avl Bal Rs.1,234.56', inbox, { single: true, sender: 'AX-SBIUPI', receivedAt: at(22), expenses: [], now: new Date(2026, 9, 22, 13), newId: () => 'i1' });
  assert.equal(run.results[0].status, 'added'); assert.equal(run.data.inbox.length, 1);
  assert.deepEqual(run.readings, [{ account: '9742', balance: 1234.56, date: '2026-10-22', stamp: at(22) }]);
  const only = I.ingestMessages('Available Bal in a/c XX1234 is Rs 750.25 as on 22-10-26', inbox, { single: true, sender: 'AX-SBIUPI', receivedAt: at(22), now: new Date(2026, 9, 22, 13) });
  assert.equal(only.results[0].status, 'balance'); assert.equal(only.data.inbox.length, 0); assert.equal(only.readings.length, 1);
  const pasted = I.ingestMessages('Rs 20 debited from A/c X9742 on 20-10-26 to Test Shop. Avl Bal Rs 100', inbox, { expenses: [], now: new Date(2026, 9, 22, 13) });
  assert.equal(pasted.readings[0].stamp, new Date('2026-10-20T12:00:00').getTime());      // a paste counts as midday on its own day
});

test('ingestNative gathers readings from every message and does not count a balance message as skipped', () => {
  const inbox = { inbox: [], upcoming: [], salary: [], settle: [], memory: {}, dismissed: [] };
  const messages = [
    { sender: 'AX-SBIUPI', body: 'Rs.500.00 debited from A/c X9742 on 22-10-26 to Test Shop. Avl Bal Rs.1,234.56 UPI Ref 100000000011', receivedAt: at(22, 9) },
    { sender: 'AX-SBIUPI', body: 'Available Bal in a/c XX1234 is Rs 750.25 as on 22-10-26', receivedAt: at(22, 10) },
  ];
  const r = I.ingestNative(messages, inbox, { expenses: [], now: new Date(2026, 9, 22, 13) });
  assert.equal(r.added, 1); assert.equal(r.skipped, 0); assert.equal(r.readings.length, 2);
});

test('each account keeps its newest balance, whatever order the messages arrive in', () => {
  let data = Ac.applyBalances(empty(), [reading('9742', 900, '2026-10-22', 5), reading('XX9742', 1500, '2026-10-20', 9), reading('1234', 300, '2026-10-21')]);
  assert.equal(data.accounts.length, 2);
  const a = data.accounts.find(x => x.key === '9742');
  assert.equal(a.balance, 900); assert.equal(a.asOf, '2026-10-22'); assert.equal(a.source, 'sms'); assert.equal(a.name, 'Account ••9742'); assert.equal(a.include, true);
  data = Ac.applyBalances(data, [reading('9742', 100, '2026-10-21', 99)]);          // older day: ignored
  assert.equal(data.accounts.find(x => x.key === '9742').balance, 900);
  data = Ac.applyBalances(data, [reading('9742', 850, '2026-10-22', 6)]);           // same day, later message: wins
  assert.equal(data.accounts.find(x => x.key === '9742').balance, 850);
  data = Ac.applyBalances(data, [reading('9742', 777, '2026-10-22', 2)]);           // same day, earlier message: ignored
  assert.equal(data.accounts.find(x => x.key === '9742').balance, 850);
});

test('rubbish readings are ignored, and the input is never changed', () => {
  const start = empty();
  const data = Ac.applyBalances(start, [reading('', 5, '2026-10-22'), reading('1234', 'abc', '2026-10-22'), reading('1234', -5, '2026-10-22'), reading('1234', 5, 'soon')]);
  assert.equal(data.accounts.length, 0); assert.deepEqual(start, empty());
});

test('you can type in an account, change its name, and a new name alone does not make an old balance look fresh', () => {
  const now = new Date(2026, 9, 22, 10);
  let r = Ac.saveAccount(empty(), { name: ' Salary account ', last4: '9742', balance: '2500.5' }, { now });
  assert.equal(r.ok, true); assert.equal(r.account.key, '9742'); assert.equal(r.account.name, 'Salary account'); assert.equal(r.account.balance, 2500.5); assert.equal(r.account.source, 'manual'); assert.equal(r.account.asOf, '2026-10-22');
  const withSms = Ac.applyBalances(r.data, [reading('9742', 2000, '2026-10-23', 1)]);
  const later = new Date(2026, 9, 28, 10);
  const renamed = Ac.saveAccount(withSms, { key: '9742', name: 'Main', balance: 2000, include: false }, { now: later });
  assert.equal(renamed.account.asOf, '2026-10-23'); assert.equal(renamed.account.source, 'sms'); assert.equal(renamed.account.name, 'Main'); assert.equal(renamed.account.include, false);
  const corrected = Ac.saveAccount(renamed.data, { key: '9742', balance: 1900 }, { now: later });
  assert.equal(corrected.account.asOf, '2026-10-28'); assert.equal(corrected.account.source, 'manual'); assert.equal(corrected.account.name, 'Main');
  const noDigits = Ac.saveAccount(empty(), { name: 'Cash wallet', balance: 300 }, { now, newId: () => 'x1' });
  assert.equal(noDigits.account.key, 'mx1');
});

test('bad input to an account is refused', () => {
  assert.equal(Ac.saveAccount(empty(), { name: 'x', balance: '' }).ok, false);
  assert.equal(Ac.saveAccount(empty(), { name: 'x', balance: -1 }).ok, false);
  assert.equal(Ac.saveAccount(empty(), { name: 'x', balance: 5, last4: '12' }).ok, false);
  assert.equal(Ac.saveAccount(empty(), { name: 'x', balance: 5, last4: '12345' }).ok, false);
});

test('a removed account stays removed when a bank message arrives, until you add it again', () => {
  let data = Ac.applyBalances(empty(), [reading('9742', 900, '2026-10-22')]);
  data = Ac.removeAccount(data, '9742');
  assert.equal(data.accounts.length, 0);
  assert.equal(Ac.applyBalances(data, [reading('9742', 800, '2026-10-23')]).accounts.length, 0);
  const again = Ac.saveAccount(data, { last4: '9742', name: 'Back', balance: 800 }, { now: new Date(2026, 9, 23) });
  assert.equal(again.data.accounts.length, 1); assert.equal(again.data.hidden.includes('9742'), false);
});

const dues = (...amounts) => amounts.map((amount, i) => ({ amount, date: `2026-10-${25 + i}`, title: `Bill ${i + 1}` }));
const withBalance = (...balances) => ({ accounts: balances.map((b, i) => ({ key: `100${i}`, name: 'A', balance: b, asOf: '2026-10-22', stamp: 1, source: 'sms', include: true })), hidden: [] });

test('the outlook is what is left after the coming bills, and says so when the balance will not cover them', () => {
  let o = Ac.outlook(withBalance(5000), dues(1200, 800), { today: '2026-10-22' });
  assert.equal(o.status, 'ok'); assert.equal(o.total, 5000); assert.equal(o.bills, 2000); assert.equal(o.after, 3000); assert.equal(o.lastDue, '2026-10-26'); assert.equal(o.count, 2);
  o = Ac.outlook(withBalance(1500), dues(1200, 800), { today: '2026-10-22' });
  assert.equal(o.status, 'short'); assert.equal(o.shortBy, 500); assert.equal(o.after, -500);
  assert.equal(Ac.outlook(withBalance(2000), dues(2000), { today: '2026-10-22' }).status, 'ok');   // exactly enough is not short
});

test('a cushion makes a "low" warning before it is actually short; zero means only warn when short', () => {
  assert.equal(Ac.outlook(withBalance(2500), dues(2000), { threshold: 1000, today: '2026-10-22' }).status, 'low');
  assert.equal(Ac.outlook(withBalance(2500), dues(2000), { threshold: 0, today: '2026-10-22' }).status, 'ok');
  assert.equal(Ac.outlook(withBalance(3500), dues(2000), { threshold: 1000, today: '2026-10-22' }).status, 'ok');
});

test('only the accounts you count towards bills are added up, and nothing known means no outlook', () => {
  const data = withBalance(1000, 4000); data.accounts[1].include = false;
  assert.equal(Ac.outlook(data, dues(500), {}).total, 1000);
  data.accounts[0].include = false;
  assert.equal(Ac.outlook(data, dues(500), {}).status, 'none');
  assert.equal(Ac.outlook(empty(), [], {}).status, 'none');
  assert.equal(Ac.outlook(withBalance(100), [], {}).status, 'ok');                                    // no bills: nothing to be short of
});

test('a balance read days ago is marked stale, with the oldest reading shown', () => {
  const data = withBalance(1000, 2000); data.accounts[1].asOf = '2026-10-15';
  const o = Ac.outlook(data, [], { today: '2026-10-22' });
  assert.equal(o.asOf, '2026-10-15'); assert.equal(o.stale, true);
  assert.equal(Ac.outlook(withBalance(1000), [], { today: '2026-10-24' }).stale, false);
});

test('accounts are saved on their own and survive a reload', () => {
  const mem = {};
  const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(S.loadAccounts(storage), { accounts: [], hidden: [] });
  const data = Ac.removeAccount(Ac.applyBalances(empty(), [reading('9742', 900, '2026-10-22'), reading('1234', 50, '2026-10-22')]), '1234');
  assert.equal(S.saveAccounts(storage, data), true);
  const back = S.loadAccounts(storage);
  assert.equal(back.accounts.length, 1); assert.equal(back.accounts[0].balance, 900); assert.deepEqual(back.hidden, ['1234']);
  storage.setItem(S.ACCOUNTS_KEY, '{oops'); assert.deepEqual(S.loadAccounts(storage), { accounts: [], hidden: [] });
  assert.equal(S.loadSettings(storage).lowBalance, 0);
  storage.setItem(S.SETTINGS_KEY, JSON.stringify({ lowBalance: '1500' })); assert.equal(S.loadSettings(storage).lowBalance, 1500);
  storage.setItem(S.SETTINGS_KEY, JSON.stringify({ lowBalance: -5 })); assert.equal(S.loadSettings(storage).lowBalance, 0);
});

const spendOn = (id, date, amount, extra = {}) => ({ id, date, amount, description: id, category: 'Food', createdAt: 1000, ...extra });

test('without a fresh message the balance is the last one less what you have spent since', () => {
  const data = Ac.saveAccount(empty(), { last4: '9742', name: 'Main', balance: 5000 }, { now: new Date(2026, 9, 20, 12) }).data;   // typed on 20 Oct
  const expenses = [spendOn('a', '2026-10-19', 700), spendOn('b', '2026-10-21', 300), spendOn('c', '2026-10-22', 450)];
  const [a] = Ac.withEstimates(data, expenses);
  assert.equal(a.balance, 5000); assert.equal(a.spentSince, 750); assert.equal(a.probable, 4250); assert.equal(a.estimated, true);   // 19 Oct is before the balance
});

test('a payment named for an account comes off that account, and the one that arrived with the balance is not taken off twice', () => {
  let data = Ac.applyBalances(empty(), [reading('9742', 1000, '2026-10-22', 5000), reading('1234', 800, '2026-10-22', 5000)]);
  const expenses = [
    spendOn('same', '2026-10-22', 40, { account: '9742', receivedAt: 5000 }),     // the very message that carried the balance
    spendOn('later', '2026-10-22', 60, { account: '9742', receivedAt: 6000 }),
    spendOn('other', '2026-10-23', 100, { account: '1234' }),
  ];
  const found = Object.fromEntries(Ac.withEstimates(data, expenses).map(a => [a.key, a]));
  assert.equal(found['9742'].probable, 940); assert.equal(found['1234'].probable, 700);
});

test('the probable balance never goes below zero, and an account with nothing spent is not marked as an estimate', () => {
  const data = withBalance(100, 400);
  const out = Ac.withEstimates(data, [spendOn('big', '2026-10-23', 250)]);
  assert.equal(out[0].probable, 0); assert.equal(out[0].estimated, true);       // the main account takes the unnamed payment
  assert.equal(out[1].probable, 400); assert.equal(out[1].estimated, false);
  assert.deepEqual(Ac.withEstimates(empty(), [spendOn('x', '2026-10-23', 5)]), []);
});

test('the outlook uses the probable balance when it is given the expenses, so the warning stays current', () => {
  const data = withBalance(3500);
  const expenses = [spendOn('lunch', '2026-10-23', 600)];
  assert.equal(Ac.outlook(data, dues(3000), { today: '2026-10-23' }).status, 'ok');                       // 3500 against 3000
  const o = Ac.outlook(data, dues(3000), { today: '2026-10-23', expenses });
  assert.equal(o.total, 2900); assert.equal(o.status, 'short'); assert.equal(o.shortBy, 100); assert.equal(o.estimated, true);
});

console.log(`\n${passed} account balance tests passed.`);
