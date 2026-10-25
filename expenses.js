// Changing an expense after it was recorded. Pure: returns a new list instead of changing the old one.
// An expense keeps everything it came with (where it came from, its bank reference, the bill it paid); only the
// fields you edit change, and each is checked the same way as when an expense is first added.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  // edits: any of { amount, description, category, date }. Returns { ok, expenses, expense } or { ok:false, error }.
  function editExpense(expenses, id, edits) {
    const current = (expenses || []).find(e => e.id === id);
    if (!current) return { ok: false, error: 'That expense no longer exists.' };

    const amount = edits.amount == null ? Number(current.amount) : Number(edits.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    const date = edits.date == null ? current.date : edits.date;
    if (!U.isValidDate(date)) return { ok: false, error: 'Enter a valid date.' };
    const category = edits.category == null ? current.category : edits.category;
    if (!U.CATEGORIES.includes(category)) return { ok: false, error: 'Choose one of the categories.' };
    const description = (edits.description == null ? current.description : String(edits.description)).trim().slice(0, 100) || 'Expense';

    const expense = { ...current, amount: U.round2(amount), description, category, date, edited: true };
    return { ok: true, expense, expenses: expenses.map(e => (e.id === id ? expense : e)) };
  }

  // Tidy text for matching: lower case, so a search for "swiggy" finds "Swiggy".
  const norm = value => String(value == null ? '' : value).toLowerCase();

  // Expenses matching a search box: part of the description or category, or an amount ("150" finds ₹150 and ₹1,500).
  function searchExpenses(expenses, query) {
    const q = norm(query).trim();
    if (!q) return expenses.slice();
    return expenses.filter(e => norm(e.description).includes(q) || norm(e.category).includes(q) || String(e.amount).includes(q.replace(/[₹,\s]/g, '')));
  }

  const api = { editExpense, searchExpenses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Expenses = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
