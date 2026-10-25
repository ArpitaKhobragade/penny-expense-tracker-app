// Scheduled bills (rent, EMI, a subscription). Money for a bill that is due but not yet paid is set aside before
// the daily amount is worked out, so the number on the Today screen only counts money that is really free.
// A bill is { id, title, amount, dueDate, repeat: 'once' | 'monthly', source, createdAt }. A monthly bill falls
// on the same day of every month (the last day in shorter months). "Paid" is remembered per occurrence in
// `paid` = { 'billId|YYYY-MM-DD': 'YYYY-MM-DD the payment happened' }. All functions are pure.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const MATCH_DAYS_BEFORE = 5;   // a payment up to 5 days before the due date counts
  const MATCH_DAYS_AFTER = 10;   // ...or up to 10 days after
  const STOP_WORDS = new Set(['the', 'for', 'and', 'bill', 'pay', 'payment', 'monthly', 'upi', 'txn']);

  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const keyOf = (billId, date) => `${billId}|${date}`;

  function createBill(input, options = {}) {
    const title = String(input.title || '').trim();
    const amount = Number(input.amount);
    if (!title) return { ok: false, error: 'Enter a name for the bill.' };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    if (!U.isValidDate(input.dueDate)) return { ok: false, error: 'Enter the date it is due.' };
    return {
      ok: true,
      bill: {
        id: ((options.newId) || defaultId)(), title: title.slice(0, 80), amount: U.round2(amount), dueDate: input.dueDate,
        repeat: input.repeat === 'monthly' ? 'monthly' : 'once', source: input.source === 'sms' ? 'sms' : 'manual',
        createdAt: (options.now || new Date()).getTime(),
      },
    };
  }

  // The dates this bill falls due between start and end (inclusive).
  function occurrencesInRange(bill, start, end) {
    if (!U.isValidDate(bill.dueDate)) return [];
    if (bill.repeat !== 'monthly') return bill.dueDate >= start && bill.dueDate <= end ? [bill.dueDate] : [];
    const day = Number(bill.dueDate.slice(8, 10));
    const dates = [];
    for (let month = bill.dueDate.slice(0, 7); month <= end.slice(0, 7); month = U.shiftMonth(month, 1)) {
      const date = U.dateInMonth(month, day);
      if (date >= bill.dueDate && date >= start && date <= end) dates.push(date);
    }
    return dates;
  }

  const words = text => (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 3 && !STOP_WORDS.has(w));

  // A payment counts as this bill's when the amount is about right, it is near the due date, and it shares a word
  // with the bill's name. Matching on the name keeps a ₹500 coffee from paying off a ₹500 bill.
  function matchesPayment(bill, dueDate, expense) {
    const tolerance = Math.max(1, bill.amount * 0.01);
    if (Math.abs(Number(expense.amount) - bill.amount) > tolerance) return false;
    const offset = U.daysBetween(dueDate, expense.date);
    if (!(offset >= -MATCH_DAYS_BEFORE && offset <= MATCH_DAYS_AFTER)) return false;
    const have = new Set(words(`${expense.description || ''} ${expense.merchant || ''} ${expense.merchantKey || ''}`));
    return words(bill.title).some(w => have.has(w));
  }

  // A suggestion (from a bank message) is "the same bill" as one you already have when the amount matches
  // and the names share a word, so the same autopay is not offered again once it is in your bills.
  function isSameBill(existing, suggestion) {
    if (Math.abs(Number(existing.amount) - Number(suggestion.amount)) > 1) return false;
    const have = new Set(words(existing.title));
    return words(suggestion.title).some(w => have.has(w));
  }

  // input: { bills, paid, expenses, start, end, today, asOf }
  // Every occurrence in the period with its state: 'paid' | 'overdue' | 'today' | 'upcoming'.
  // With `asOf`, payments made after that day are ignored, which rebuilds how things stood on that day.
  function billOccurrences(input) {
    const { bills = [], paid = {}, start, end, today } = input;
    const asOf = input.asOf || null;
    const expenses = (input.expenses || []).filter(e => e.date && (!asOf || e.date <= asOf)).sort((a, b) => a.date.localeCompare(b.date));
    const used = new Set();
    const rows = [];
    for (const bill of bills) {
      for (const date of occurrencesInRange(bill, start, end)) rows.push({ bill, date });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));

    return rows.map(({ bill, date }) => {
      const key = keyOf(bill.id, date);
      let paidOn = typeof paid[key] === 'string' && (!asOf || paid[key] <= asOf) ? paid[key] : null;
      let expenseId = null;
      if (!paidOn) {
        const hit = expenses.filter(e => !used.has(e.id) && matchesPayment(bill, date, e))
          .sort((a, b) => Math.abs(U.daysBetween(date, a.date)) - Math.abs(U.daysBetween(date, b.date)))[0];
        if (hit) { used.add(hit.id); paidOn = hit.date; expenseId = hit.id; }
      }
      const state = paidOn ? 'paid' : date < today ? 'overdue' : date === today ? 'today' : 'upcoming';
      return { key, billId: bill.id, title: bill.title, amount: bill.amount, date, paidOn, state, expenseId };
    });
  }

  // The occurrences still to be paid: what the spending maths sets aside.
  function billCommitments(input) {
    return billOccurrences(input).filter(o => o.state !== 'paid');
  }

  // The expenses that were payments of bills: the ones matched above, plus the ones recorded by "Mark paid"
  // (they carry a billKey). That money was already set aside, so the spending maths keeps these payments out of any
  // single day's allowance; otherwise paying a bill you planned for would eat into that day's amount a second time.
  function billPaymentIds(rows, expenses, paid, asOf) {
    const ids = new Set((rows || []).filter(r => r.expenseId).map(r => r.expenseId));
    for (const e of expenses || []) {
      if (e.billKey && (paid || {})[e.billKey] && (!asOf || e.date <= asOf)) ids.add(e.id);
    }
    return [...ids];
  }

  function markPaid(paid, key, onDate) {
    return { ...(paid || {}), [key]: onDate };
  }
  function unmarkPaid(paid, key) {
    const { [key]: _removed, ...rest } = paid || {};
    return rest;
  }

  // Removes a bill and the "paid" notes that belonged to it.
  function deleteBill(data, billId) {
    const paid = {};
    for (const [key, value] of Object.entries(data.paid || {})) if (!key.startsWith(`${billId}|`)) paid[key] = value;
    return { bills: (data.bills || []).filter(b => b.id !== billId), paid };
  }

  const api = { createBill, occurrencesInRange, billOccurrences, billCommitments, billPaymentIds, isSameBill, markPaid, unmarkPaid, deleteBill, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Bills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
