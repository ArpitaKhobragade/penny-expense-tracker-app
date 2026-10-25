// Salary planner helpers: which goals to feed this period, and how to share an amount between them. Pure functions.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;
  const G = typeof require === 'function' ? require('./goals.js') : root.Goals;

  // Goals still open, with what each needs for the rest of this period to stay on pace: [{ id, title, remaining, amount }]
  // A goal with a date needs (remaining / days to the date) a day; one without a date asks for 10% of what is missing.
  function suggestGoals(plans, today, periodDaysLeft) {
    const out = [];
    for (const plan of plans || []) {
      const p = G.goalProgress(plan, today);
      if (p.achieved || p.status === 'overdue') continue;
      const perDay = p.neededPerDay;
      const raw = perDay != null ? perDay * Math.max(1, periodDaysLeft) : p.remaining * 0.1;
      const amount = Math.min(p.remaining, Math.ceil(raw / 10) * 10);
      if (amount > 0) out.push({ id: plan.id, title: plan.title, remaining: p.remaining, amount });
    }
    return out;
  }

  // Shares `total` between the suggestions in proportion to their amounts, never more than a goal is missing.
  // -> [{ id, amount }] (only amounts above zero)
  function splitGoals(suggestions, total) {
    const want = suggestions.reduce((sum, s) => sum + s.amount, 0);
    const value = Math.max(0, Number(total) || 0);
    if (!(want > 0) || !(value > 0)) return [];
    const out = [];
    let left = value;
    suggestions.forEach((s, i) => {
      const share = i === suggestions.length - 1 ? left : Math.min(left, U.round2(value * s.amount / want));
      const amount = Math.min(U.round2(share), s.remaining);
      left = U.round2(left - amount);
      if (amount > 0) out.push({ id: s.id, amount });
    });
    return out;
  }

  const api = { suggestGoals, splitGoals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Salary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
