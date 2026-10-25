// Payments that repeat every month (Netflix, an EMI, rent) found in your own expenses, so they can become bills without typing,
// and bills whose price has quietly changed. Pure functions over plain data.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const key = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const keyOf = e => key(e.merchantKey || e.description);
  const GENERIC = new Set(['', 'bankdebit', 'atmwithdrawal', 'purchase', 'moneyreceived', 'other', 'lent']);
  const monthOf = date => date.slice(0, 7);

  // True when two names are the same thing ("Netflix" and "NETFLIX.COM"), either containing the other.
  const sameName = (a, b) => { const x = key(a), y = key(b); return Boolean(x && y) && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))); };

  // The next date on or after `today` that falls on `day` of a month (clamped for short months).
  function nextOn(day, today) {
    let month = monthOf(today);
    for (let i = 0; i < 3; i++) {
      const date = U.dateInMonth(month, day);
      if (date >= today) return date;
      month = U.shiftMonth(month, 1);
    }
    return U.dateInMonth(month, day);
  }

  // options: { today, dismissed: [key] }. Each suggestion: { key, title, amount, day, nextDate, count, changed: { from, to } | null }
  // A payment counts as monthly when it happened in at least two different months, 26 to 35 days apart, for about the same
  // amount (within 10%, or any size when the newest one differs from the one before: that is a price change).
  function findRecurring(expenses, bills, options = {}) {
    const today = options.today, dismissed = new Set(options.dismissed || []);
    const groups = new Map();
    for (const e of expenses || []) {
      if (!e.date || e.cashIn || !(U.spendOf(e) > 0)) continue;
      const k = keyOf(e);
      if (GENERIC.has(k)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const found = [];
    for (const [k, list] of groups) {
      if (dismissed.has(k)) continue;
      const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date));
      // one entry per month, the latest of that month
      const perMonth = [];
      for (const e of sorted) { if (perMonth.length && monthOf(perMonth[perMonth.length - 1].date) === monthOf(e.date)) perMonth[perMonth.length - 1] = e; else perMonth.push(e); }
      if (perMonth.length < 2) continue;
      const last = perMonth[perMonth.length - 1], before = perMonth[perMonth.length - 2];
      const gap = U.daysBetween(before.date, last.date);
      if (gap < 26 || gap > 35) continue;
      const a = U.spendOf(last), b = U.spendOf(before);
      const close = Math.abs(a - b) <= Math.max(a, b) * 0.1;
      const changed = !close && perMonth.length >= 3 && Math.abs(U.spendOf(perMonth[perMonth.length - 3]) - b) <= Math.max(b, U.spendOf(perMonth[perMonth.length - 3])) * 0.1 ? { from: b, to: a } : null;
      if (!close && !changed) continue;
      const title = (last.merchant || last.description || '').slice(0, 80);
      if ((bills || []).some(bill => sameName(bill.title, title))) continue;
      found.push({ key: k, title, amount: a, day: Number(last.date.slice(8, 10)), nextDate: nextOn(Number(last.date.slice(8, 10)), today), count: perMonth.length, changed });
    }
    return found.sort((x, y) => y.amount - x.amount);
  }

  // Bills whose latest matching payment (in the last 45 days) is a different amount: { bill, from, to, date }
  function priceChanges(bills, expenses, today) {
    const out = [];
    for (const bill of bills || []) {
      if (bill.repeat !== 'monthly') continue;
      const latest = (expenses || []).filter(e => e.date && e.date <= today && U.daysBetween(e.date, today) <= 45 && sameName(bill.title, e.merchant || e.description))
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!latest) continue;
      const to = U.spendOf(latest), from = Number(bill.amount) || 0;
      if (to > 0 && Math.abs(to - from) >= Math.max(5, from * 0.05)) out.push({ bill, from, to: U.round2(to), date: latest.date });
    }
    return out;
  }

  const api = { findRecurring, priceChanges, sameName, nextOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Recurring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
