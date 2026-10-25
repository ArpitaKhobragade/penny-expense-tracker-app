// Bank accounts and what is in them. The balance comes from the "Avl Bal" figure in bank messages, so it is as fresh as
// the last message, and every figure carries the day it was read. Pure functions: they take the current data and return
// the new data, so the screen only has to save what comes back.
// data = { accounts: [{ key, name, balance, asOf, stamp, source: 'sms' | 'manual', include }], hidden: [key] }
// key is the last digits of the account number; accounts typed in by hand without digits get a key starting with "m".
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const STALE_DAYS = 3;
  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextId = options => ((options && options.newId) || defaultId)();

  const keyOf = raw => String(raw || '').replace(/\D/g, '').slice(-4);
  const defaultName = key => (/^\d+$/.test(key) ? `Account ••${key}` : 'Account');
  const isNewer = (reading, current) => reading.date > current.asOf || (reading.date === current.asOf && reading.stamp >= (current.stamp || 0));

  // readings: [{ account, balance, date, stamp }] as found in bank messages. The newest reading for each account wins,
  // whatever order they arrive in; an account you removed is not added back.
  function applyBalances(data, readings) {
    let accounts = (data.accounts || []).map(a => ({ ...a }));
    const hidden = data.hidden || [];
    const usable = (readings || []).filter(r => keyOf(r.account) && Number.isFinite(Number(r.balance)) && Number(r.balance) >= 0 && U.isValidDate(r.date))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.stamp || 0) - (b.stamp || 0));
    for (const raw of usable) {
      const reading = { ...raw, balance: U.round2(Number(raw.balance)), stamp: Number(raw.stamp) || 0 };
      const key = keyOf(reading.account);
      const index = accounts.findIndex(a => a.key === key);
      if (index < 0) {
        if (hidden.includes(key)) continue;
        accounts.push({ key, name: defaultName(key), balance: reading.balance, asOf: reading.date, stamp: reading.stamp, source: 'sms', include: true });
      } else if (isNewer(reading, accounts[index])) {
        accounts[index] = { ...accounts[index], balance: reading.balance, asOf: reading.date, stamp: reading.stamp, source: 'sms' };
      }
    }
    return { ...data, accounts, hidden };
  }

  // input: { key (to change an existing account), last4 (optional digits for a new one), name, balance, include }.
  // A balance you type counts as read today. Saving only a new name or tick keeps the old reading and its date.
  // Returns { ok, data, account } or { ok:false, error }.
  function saveAccount(data, input = {}, options = {}) {
    const balance = input.balance === '' || input.balance == null ? NaN : U.round2(Number(input.balance));
    if (!Number.isFinite(balance) || balance < 0) return { ok: false, error: 'Enter the balance as a number, zero or more.' };
    const now = options.now || new Date();
    const accounts = (data.accounts || []).map(a => ({ ...a }));
    let key = input.key || '';
    if (!key) {
      const digits = String(input.last4 || '').replace(/\D/g, '');
      if (input.last4 && !(digits.length >= 3 && digits.length <= 4)) return { ok: false, error: 'Use the last 3 or 4 digits of the account number, or leave it empty.' };
      key = digits || `m${nextId(options)}`;
    }
    const name = String(input.name == null ? '' : input.name).trim().slice(0, 40);
    const index = accounts.findIndex(a => a.key === key);
    const base = index >= 0 ? accounts[index] : { key, name: defaultName(key), include: true };
    const changed = index < 0 || U.round2(base.balance) !== balance;
    const dated = U.isValidDate(input.asOf);     // a balance taken from a statement belongs to the statement's last day
    const account = {
      ...base, name: name || base.name || defaultName(key), include: input.include == null ? base.include !== false : Boolean(input.include),
      balance, asOf: changed ? (dated ? input.asOf : U.formatDate(now)) : base.asOf, stamp: changed ? (dated ? new Date(`${input.asOf}T23:59:00`).getTime() : now.getTime()) : base.stamp, source: changed ? 'manual' : base.source,
    };
    if (index >= 0) accounts[index] = account; else accounts.push(account);
    return { ok: true, account, data: { ...data, accounts, hidden: (data.hidden || []).filter(k => k !== key) } };
  }

  // Removed for good: a later bank message does not bring it back (typing it in again does).
  function removeAccount(data, key) {
    return { ...data, accounts: (data.accounts || []).filter(a => a.key !== key), hidden: [...new Set([...(data.hidden || []), key])] };
  }

  // The balance Penny can stand behind without a fresh message: the last balance (read, imported or typed) less what you
  // have recorded spending after it. A payment with no account named belongs to the main account (the first one counted
  // towards bills). Money coming in is not known, so this is "probable", and it never drops below zero.
  // Returns every account with `spentSince`, `probable` and `estimated` (true when something has been taken off).
  function withEstimates(data, expenses) {
    const accounts = data.accounts || [];
    const main = accounts.find(a => a.include !== false) || accounts[0];
    const spent = {};
    for (const e of expenses || []) {
      const key = keyOf(e.account);
      const owner = accounts.find(a => a.key === key) || main;
      const amount = Number(e.amount);
      if (!owner || !(amount > 0)) continue;
      const when = Number(e.receivedAt) || Number(e.createdAt) || 0;
      if (e.date > owner.asOf || (e.date === owner.asOf && when > (owner.stamp || 0))) spent[owner.key] = U.round2((spent[owner.key] || 0) + amount);
    }
    return accounts.map(a => {
      const spentSince = spent[a.key] || 0;
      return { ...a, spentSince, probable: U.round2(Math.max(0, Number(a.balance) - spentSince)), estimated: spentSince > 0 };
    });
  }

  // What is left after the bills that are coming, from the accounts that bills are paid from. With options.expenses the
  // probable balances (see withEstimates) are used instead of the last known ones.
  // dues: [{ amount, date, title }] unpaid bills. threshold: warn below this much left (0 = only warn when short).
  // status: 'none' (no balance known) | 'ok' | 'low' | 'short'.
  function outlook(data, dues, options = {}) {
    const all = options.expenses ? withEstimates(data, options.expenses) : (data.accounts || []).map(a => ({ ...a, probable: Number(a.balance) || 0, estimated: false }));
    const included = all.filter(a => a.include !== false);
    if (!included.length) return { status: 'none', accounts: 0, total: 0, bills: 0, after: 0, shortBy: 0, asOf: '', stale: false, lastDue: '', estimated: false };
    const total = U.round2(included.reduce((sum, a) => sum + a.probable, 0));
    const list = dues || [];
    const bills = U.round2(list.reduce((sum, d) => sum + (Number(d.amount) || 0), 0));
    const after = U.round2(total - bills);
    const threshold = Math.max(0, Number(options.threshold) || 0);
    const asOf = included.reduce((oldest, a) => (!oldest || a.asOf < oldest ? a.asOf : oldest), '');
    const status = after < 0 ? 'short' : threshold > 0 && after < threshold ? 'low' : 'ok';
    return {
      status, accounts: included.length, total, bills, after, shortBy: after < 0 ? -after : 0, asOf,
      stale: Boolean(options.today && asOf && U.daysBetween(asOf, options.today) > STALE_DAYS),
      lastDue: list.reduce((last, d) => (d.date && d.date > last ? d.date : last), ''), count: list.length,
      estimated: included.some(a => a.estimated),
    };
  }

  const api = { keyOf, applyBalances, saveAccount, removeAccount, withEstimates, outlook, STALE_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Accounts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
