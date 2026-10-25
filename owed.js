// Money other people owe you. When you pay for a group ("dinner ₹2,000 for four"), the whole amount leaves your
// account but only your own share is spending; the rest is owed to you until each person pays it back.
// A debt belongs to one expense and one person: { id, expenseId, person, personKey, amount, date, description,
// createdAt, payments: [{ id, amount, date, smsId, ref }] }. Pure functions: they take the current debts and
// return the new ones, so the screen only has to save what comes back.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const EPS = 0.005;
  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextId = options => ((options && options.newId) || defaultId)();

  // "Rahul K." and "rahul k" are the same person. Devanagari letters are kept so Hindi names work too.
  const nameKey = raw => String(raw || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim().replace(/\s+/g, ' ');

  const paidOf = debt => U.round2((debt.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const outstanding = debt => Math.max(0, U.round2((Number(debt.amount) || 0) - paidOf(debt)));
  const isSettled = debt => outstanding(debt) <= EPS;
  const openDebts = debts => debts.filter(d => !isSettled(d));

  // The total others owe you for one expense (settled or not): the part that is not your spending.
  const owedTotalFor = (expenseId, debts) => U.round2(debts.filter(d => d.expenseId === expenseId).reduce((sum, d) => sum + (Number(d.amount) || 0), 0));

  // Equal split of a bill between you and `others` people: what each of them owes, and what you keep.
  function splitEqually(total, others) {
    const count = Math.max(0, Math.floor(Number(others) || 0));
    const amount = Number(total);
    if (!(amount > 0) || count < 1) return { share: 0, own: U.round2(amount > 0 ? amount : 0) };
    const share = U.round2(amount / (count + 1));
    return { share, own: U.round2(amount - share * count) };
  }

  // entries: [{ person, amount }] for one expense. All or nothing: either every entry is valid or nothing changes.
  // Returns { ok, debts, added } or { ok:false, error }.
  function addDebts(debts, expense, entries, options = {}) {
    if (!expense || !expense.id) return { ok: false, error: 'Pick the payment you made for others first.' };
    const clean = [];
    for (const entry of entries || []) {
      const person = String((entry && entry.person) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const rawAmount = entry && entry.amount;
      if (!person && (rawAmount === '' || rawAmount == null)) continue; // an empty row
      const amount = U.round2(Number(rawAmount));
      if (!person) return { ok: false, error: 'Enter who owes you for each amount.' };
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: `Enter an amount above zero for ${person}.` };
      clean.push({ person, amount });
    }
    if (!clean.length) return { ok: false, error: 'Add at least one person who owes you.' };
    const total = U.round2(clean.reduce((sum, c) => sum + c.amount, 0));
    if (owedTotalFor(expense.id, debts) + total > Number(expense.amount) + EPS) {
      return { ok: false, error: `Others cannot owe you more than the ₹${U.round2(Number(expense.amount))} you paid.` };
    }
    const now = (options.now || new Date()).getTime();
    const added = clean.map(c => ({
      id: nextId(options), expenseId: expense.id, person: c.person, personKey: nameKey(c.person), amount: c.amount,
      date: expense.date, description: String(expense.description || 'Payment').slice(0, 100), createdAt: now, payments: [],
    }));
    return { ok: true, debts: [...debts, ...added], added };
  }

  // Someone paid some of a debt back. Never more than is still owed; any excess is reported, not kept.
  // info: { amount, date, smsId, ref }. Returns { ok, debts, applied, extra } or { ok:false, error }.
  function recordPayment(debts, debtId, info = {}, options = {}) {
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return { ok: false, error: 'That amount is no longer in your list.' };
    const amount = U.round2(Number(info.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    if (info.smsId && (debt.payments || []).some(p => p.smsId === info.smsId)) return { ok: false, error: 'That message is already counted.' };
    const left = outstanding(debt);
    if (left <= EPS) return { ok: false, error: `${debt.person} has already paid this back.` };
    const applied = Math.min(amount, left);
    const payment = { id: nextId(options), amount: applied, date: info.date || U.formatDate(options.now || new Date()), smsId: info.smsId || '', ref: info.ref || '' };
    return {
      ok: true, applied, extra: U.round2(amount - applied),
      debts: debts.map(d => (d.id === debtId ? { ...d, payments: [...(d.payments || []), payment] } : d)),
    };
  }

  // A payment from one person goes against what they owe, oldest first. Returns { ok, debts, applied, extra } or { ok:false, error }.
  function settleFor(debts, personKey, info = {}, options = {}) {
    const open = openDebts(debts).filter(d => d.personKey === personKey).sort((a, b) => (a.createdAt - b.createdAt) || String(a.date).localeCompare(String(b.date)));
    if (!open.length) return { ok: false, error: 'Nothing is owed by that person.' };
    let left = U.round2(Number(info.amount));
    if (!Number.isFinite(left) || left <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    let current = debts, applied = 0;
    for (const debt of open) {
      if (left <= EPS) break;
      const run = recordPayment(current, debt.id, { ...info, amount: left }, options);
      if (!run.ok) { if (applied === 0) return run; break; }
      current = run.debts; applied = U.round2(applied + run.applied); left = U.round2(left - run.applied);
    }
    return { ok: true, debts: current, applied, extra: Math.max(0, left) };
  }

  function undoPayment(debts, debtId, paymentId) {
    return debts.map(d => (d.id === debtId ? { ...d, payments: (d.payments || []).filter(p => p.id !== paymentId) } : d));
  }

  // "They are not going to pay the rest": what was already paid stays, the unpaid part becomes your own spending.
  function writeOff(debts, debtId) {
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return debts;
    const paid = paidOf(debt);
    return paid > EPS ? debts.map(d => (d.id === debtId ? { ...d, amount: paid } : d)) : debts.filter(d => d.id !== debtId);
  }

  // Removed entirely (entered by mistake); the whole payment counts as your spending again.
  const removeDebt = (debts, debtId) => debts.filter(d => d.id !== debtId);

  // Expenses with `owedTotal` set from the debts, so the spending maths can count only your own share.
  // A stale `owedTotal` with no debt behind it is dropped.
  function annotate(expenses, debts) {
    const totals = {};
    for (const d of debts || []) totals[d.expenseId] = (totals[d.expenseId] || 0) + (Number(d.amount) || 0);
    return (expenses || []).map(e => {
      const owed = Math.min(U.round2(totals[e.id] || 0), Number(e.amount) || 0);
      if (owed > 0) return e.owedTotal === owed ? e : { ...e, owedTotal: owed };
      if (!('owedTotal' in e)) return e;
      const { owedTotal, ...rest } = e;
      return rest;
    });
  }

  // Who owes what: { outstanding, people: [{ person, personKey, outstanding, debts (open, oldest first) }], settled: [debt] }
  function summary(debts) {
    const people = new Map();
    for (const d of openDebts(debts || [])) {
      const entry = people.get(d.personKey) || { person: d.person, personKey: d.personKey, outstanding: 0, debts: [] };
      entry.outstanding = U.round2(entry.outstanding + outstanding(d));
      entry.debts.push(d);
      people.set(d.personKey, entry);
    }
    const list = [...people.values()].map(p => ({ ...p, debts: p.debts.sort((a, b) => (a.createdAt - b.createdAt) || String(a.date).localeCompare(String(b.date))) }))
      .sort((a, b) => b.outstanding - a.outstanding || a.person.localeCompare(b.person));
    return {
      outstanding: U.round2(list.reduce((sum, p) => sum + p.outstanding, 0)),
      people: list,
      settled: (debts || []).filter(isSettled),
    };
  }

  // Two names that probably mean the same person: they share a word (3+ letters), or one word starts the other.
  function namesMatch(a, b) {
    const ka = nameKey(a), kb = nameKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const wa = ka.split(' ').filter(w => w.length >= 3), wb = kb.split(' ').filter(w => w.length >= 3);
    return wa.some(x => wb.some(y => x === y || x.startsWith(y) || y.startsWith(x)));
  }

  // Who could this incoming money be from? credit: { amount, counterparty, date }. Best guess first. A debt made after the
  // money arrived cannot be what it paid for.
  // Each: { person, personKey, outstanding, score, byName, exact }. Nothing is changed; the person confirms.
  function matchCredit(credit, debts) {
    const amount = U.round2(Number(credit && credit.amount));
    if (!(amount > 0)) return [];
    const found = [];
    const possible = (debts || []).filter(d => !credit.date || !d.date || d.date <= credit.date);
    for (const group of summary(possible).people) {
      const byName = Boolean(credit.counterparty) && namesMatch(credit.counterparty, group.person);
      const exact = Math.abs(group.outstanding - amount) <= EPS || group.debts.some(d => Math.abs(outstanding(d) - amount) <= EPS);
      if (!byName && !exact) continue;
      let score = byName ? 3 : 1;
      if (exact) score += 1;
      if (byName && amount > group.outstanding + EPS) score -= 1; // more than they owe: probably paying for something else too
      found.push({ person: group.person, personKey: group.personKey, outstanding: group.outstanding, score, byName, exact });
    }
    return found.sort((a, b) => b.score - a.score || b.outstanding - a.outstanding);
  }

  const api = { nameKey, paidOf, outstanding, isSettled, openDebts, owedTotalFor, splitEqually, addDebts, recordPayment, settleFor, undoPayment, writeOff, removeDebt, annotate, summary, namesMatch, matchCredit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Owed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
