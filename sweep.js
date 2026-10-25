// Offers to move yesterday's unspent money into a goal. The leftover is "what the Today screen would have
// shown as left at the end of yesterday", rebuilt from the data as it stood then, so it matches what you saw.
// Only yesterday is offered: unspent money from earlier days has already been spread over the days since,
// so adding several days together would count some of it twice.
// On the last day of a month, yesterday's leftover is the whole month's unspent budget.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;
  const B = typeof require === 'function' ? require('./budget-math.js') : root.BudgetMath;
  const G = typeof require === 'function' ? require('./goals.js') : root.Goals;
  const C = typeof require === 'function' ? require('./cycle.js') : root.Cycle;
  const Bi = typeof require === 'function' ? require('./bills.js') : root.Bills;

  const MIN_AMOUNT = 50;
  const no = reason => ({ offer: false, reason });

  const remainingOf = plan => U.round2(Math.max(0, (Number(plan.target) || 0) - G.savedOf(plan)));

  // Goals that can still take money, soonest deadline first (no deadline last), then oldest first.
  function openGoals(plans) {
    return (plans || [])
      .filter(plan => remainingOf(plan) > 0)
      .sort((a, b) => {
        const da = a.targetDate || '9999-12-31', db = b.targetDate || '9999-12-31';
        return da.localeCompare(db) || (a.createdAt || 0) - (b.createdAt || 0);
      });
  }

  // input: { today, budget, monthlyFunds, expenses, plans, decided: { 'YYYY-MM-DD': 'moved'|'kept' },
  //          trackedSince, pendingDates: [dates of bank messages still waiting for review], minAmount,
  //          settings (pay cycle), bills, paid }
  function suggestSweep(input) {
    const day = U.addDays(input.today, -1);
    if (!day) return no('bad-date');
    if ((input.decided || {})[day]) return no('decided');

    // Do not treat days before you started using the app as "unspent".
    const since = input.trackedSince;
    const hadSpending = (input.expenses || []).some(e => e.date === day);
    if (since && (day < since || (day === since && !hadSpending))) return no('before-tracking');

    // Unreviewed bank messages from that day would make the leftover look bigger than it is.
    if ((input.pendingDates || []).some(d => d <= day)) return no('review-pending');

    // The period that day belonged to, and the bills still unpaid at the end of that day.
    const cycle = C.cycleFor(day, input.settings);
    const expenses = (input.expenses || []).filter(e => e.date <= day);
    const rows = Bi.billOccurrences({ bills: input.bills, paid: input.paid, expenses, start: cycle.start, end: cycle.end, today: day, asOf: day });
    const view = B.safeToSpend({
      cycle, today: day, budget: input.budget, addedFunds: C.sumIn(input.monthlyFunds, cycle),
      goalMoves: G.goalMovesInRange(input.plans, cycle.start, cycle.end, day),
      expenses, commitments: rows.filter(r => r.state !== 'paid'), billPayments: Bi.billPaymentIds(rows, expenses, input.paid, day),
    });
    if (!view.hasBudget) return no('no-budget');

    const leftover = Math.floor(view.leftToday);
    if (leftover < (input.minAmount == null ? MIN_AMOUNT : input.minAmount)) return no('too-small');

    const goals = openGoals(input.plans).map(plan => {
      const remaining = remainingOf(plan);
      return { id: plan.id, title: plan.title, remaining, amount: Math.min(leftover, Math.ceil(remaining)) };
    });
    if (!goals.length) return no('no-goal');

    return {
      offer: true, date: day, leftover, month: day.slice(0, 7), cycle,
      monthEnd: day === cycle.end,
      goals, goalId: goals[0].id, amount: goals[0].amount,
    };
  }

  const api = { suggestSweep, openGoals, MIN_AMOUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Sweep = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
