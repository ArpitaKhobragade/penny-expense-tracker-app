// "Can I afford this?": shows what a purchase would do to today, this month and your goals before you make it.
// It runs the same spending maths as the Today screen on a copy of your data with the purchase added, so the
// "after" figures are exactly what Today would show if you recorded it. Nothing is saved.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;
  const B = typeof require === 'function' ? require('./budget-math.js') : root.BudgetMath;
  const G = typeof require === 'function' ? require('./goals.js') : root.Goals;
  const C = typeof require === 'function' ? require('./cycle.js') : root.Cycle;
  const Bi = typeof require === 'function' ? require('./bills.js') : root.Bills;

  // input: { price, today, budget, monthlyFunds, expenses, plans, settings (pay cycle), bills, paid }
  // verdict: 'fits-today' | 'fits-month' (over today's amount, month still covers it) | 'over-month' | 'no-budget'
  function checkAffordability(input) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Enter a price above zero.' };

    const today = input.today;
    const cycle = C.cycleFor(today, input.settings);
    const rows = Bi.billOccurrences({ bills: input.bills, paid: input.paid, expenses: input.expenses, start: cycle.start, end: cycle.end, today });
    const view = expenses => B.safeToSpend({
      cycle, today, budget: input.budget, addedFunds: C.sumIn(input.monthlyFunds, cycle),
      goalMoves: G.goalMovesInRange(input.plans, cycle.start, cycle.end),
      expenses, commitments: rows.filter(r => r.state !== 'paid'), billPayments: Bi.billPaymentIds(rows, input.expenses, input.paid),
    });
    const before = view(input.expenses || []);
    const after = view([...(input.expenses || []), { date: today, amount: price }]);
    if (!before.hasBudget) return { ok: true, verdict: 'no-budget', price: U.round2(price) };

    const verdict = after.leftToday >= 0 ? 'fits-today' : after.monthLeft >= 0 ? 'fits-month' : 'over-month';

    // How many days of saving for each goal the price equals, at the pace that goal needs to hit its date.
    const goals = (input.plans || [])
      .map(plan => ({ plan, progress: G.goalProgress(plan, today) }))
      .filter(({ progress }) => progress.status === 'active' && progress.neededPerDay > 0)
      .sort((a, b) => a.plan.targetDate.localeCompare(b.plan.targetDate))
      .map(({ plan, progress }) => ({ id: plan.id, title: plan.title, days: Math.round(price / progress.neededPerDay * 10) / 10 }));

    return {
      ok: true, verdict, price: U.round2(price),
      today: { before: before.leftToday, after: after.leftToday, limit: before.allowanceToday },
      month: { before: before.monthLeft, after: after.monthLeft, overBy: after.overBy },
      tomorrow: before.tomorrowAllowance == null ? null : { before: before.tomorrowAllowance, after: after.tomorrowAllowance },
      daysOfSpending: before.allowanceToday > 0 ? Math.round(price / before.allowanceToday * 10) / 10 : null,
      goals,
    };
  }

  const api = { checkAffordability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Afford = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
