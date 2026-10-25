// Budgets with their own money, next to "Daily needs" (the main monthly budget). Spending that belongs to a budget (say
// Shopping or Orders) is paid from that budget first and does not touch your daily limit. Only what goes over the
// budget's money is counted against Daily needs, so it lowers the daily limit from that day on.
// A pot is { id, name, limit (for each period), categories: [], keywords: [], createdAt }; money added later is a top-up,
// { id, potId, amount, date }, and counts in the period its date falls in.
// Pure functions: they take the current data and return new data.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextId = options => ((options && options.newId) || defaultId)();
  const inCycle = (cycle, date) => Boolean(date) && date >= cycle.start && date <= cycle.end;

  const words = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map(w => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 20);

  // input: { name, limit, categories: [], keywords: [] or 'swiggy, zomato' }. Returns { ok, pot } or { ok:false, error }.
  function normalizePot(input, base = {}) {
    const name = String(input.name == null ? '' : input.name).trim().replace(/\s+/g, ' ').slice(0, 30);
    const limit = U.round2(Number(input.limit));
    const categories = [...new Set((input.categories || []).filter(c => U.CATEGORIES.includes(c)))];
    const keywords = words(input.keywords);
    if (!name) return { ok: false, error: 'Give the budget a name.' };
    if (!Number.isFinite(limit) || limit <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    if (!categories.length && !keywords.length) return { ok: false, error: 'Pick a category or add a shop name.' };
    return { ok: true, pot: { ...base, name, limit, categories, keywords } };
  }

  function createPot(data, input, options = {}) {
    const made = normalizePot(input, { id: nextId(options), createdAt: (options.now || new Date()).getTime() });
    if (!made.ok) return made;
    if ((data.pots || []).some(p => p.name.toLowerCase() === made.pot.name.toLowerCase())) return { ok: false, error: 'You already have a budget with that name.' };
    return { ok: true, pot: made.pot, data: { ...data, pots: [...(data.pots || []), made.pot] } };
  }

  function updatePot(data, id, input) {
    const current = (data.pots || []).find(p => p.id === id);
    if (!current) return { ok: false, error: 'That budget no longer exists.' };
    const made = normalizePot(input, current);
    if (!made.ok) return made;
    if ((data.pots || []).some(p => p.id !== id && p.name.toLowerCase() === made.pot.name.toLowerCase())) return { ok: false, error: 'You already have a budget with that name.' };
    return { ok: true, pot: made.pot, data: { ...data, pots: data.pots.map(p => (p.id === id ? made.pot : p)) } };
  }

  // Removing a budget also removes the money added to it. Its spending goes back to Daily needs.
  const removePot = (data, id) => ({ ...data, pots: (data.pots || []).filter(p => p.id !== id), topUps: (data.topUps || []).filter(t => t.potId !== id) });

  function addTopUp(data, potId, amount, date, options = {}) {
    if (!(data.pots || []).some(p => p.id === potId)) return { ok: false, error: 'That budget no longer exists.' };
    const value = U.round2(Number(amount));
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    if (!U.isValidDate(date)) return { ok: false, error: 'Enter a valid date.' };
    const topUp = { id: nextId(options), potId, amount: value, date };
    return { ok: true, topUp, data: { ...data, topUps: [...(data.topUps || []), topUp] } };
  }

  // Does this expense belong to the pot by its category or by a shop name in its description?
  function matches(pot, expense) {
    if ((pot.categories || []).includes(expense.category)) return true;
    const text = `${expense.description || ''} ${expense.merchantKey || ''}`.toLowerCase();
    return (pot.keywords || []).some(word => text.includes(word));
  }

  // The budget an expense is paid from. expense.potId can say so outright ('none' means Daily needs); otherwise the first
  // budget (oldest first) whose category or shop names match. null means Daily needs.
  function potFor(expense, pots) {
    if (expense.potId === 'none') return null;
    if (expense.potId) { const chosen = (pots || []).find(p => p.id === expense.potId); if (chosen) return chosen; }
    return (pots || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).find(p => matches(p, expense)) || null;
  }

  const budgetOf = (data, pot, cycle) => U.round2(pot.limit + (data.topUps || []).filter(t => t.potId === pot.id && inCycle(cycle, t.date)).reduce((sum, t) => sum + t.amount, 0));
  const ownShare = e => U.spendOf(e);

  // For a period: each budget's money, what was spent from it, and what is left (negative = over), plus `expenses`, the same
  // list with spending covered by a budget taken out, for the daily-limit maths. Only the part above a budget's money stays,
  // on the day it went over. Expenses outside the period, and ones without a budget, are returned unchanged.
  function spendingView(expenses, data, cycle) {
    const pots = data.pots || [];
    const summary = new Map(pots.map(p => [p.id, { pot: p, budget: budgetOf(data, p, cycle), added: U.round2(budgetOf(data, p, cycle) - p.limit), spent: 0, covered: 0, count: 0 }]));
    const order = (expenses || []).filter(e => inCycle(cycle, e.date)).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
    const adjusted = new Map();
    for (const e of order) {
      const pot = potFor(e, pots);
      if (!pot) continue;
      const s = summary.get(pot.id), own = ownShare(e);
      const covered = Math.min(own, Math.max(0, s.budget - s.covered));
      s.covered = U.round2(s.covered + covered); s.spent = U.round2(s.spent + own); s.count++;
      adjusted.set(e.id, { ...e, amount: U.round2(own - covered), owedTotal: 0 });
    }
    return {
      expenses: (expenses || []).map(e => adjusted.get(e.id) || e),
      pots: [...summary.values()].map(s => ({ pot: s.pot, budget: s.budget, added: s.added, spent: s.spent, left: U.round2(s.budget - s.spent), over: s.spent > s.budget ? U.round2(s.spent - s.budget) : 0, count: s.count })),
    };
  }

  const api = { createPot, updatePot, removePot, addTopUp, matches, potFor, budgetOf, spendingView, words };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Pots = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
