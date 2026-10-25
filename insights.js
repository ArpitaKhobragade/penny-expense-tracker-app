// History and insights: where the money went in a period, and how that compares with the one before.
// Pure functions over plain data; periods come from cycle.js, so they follow the calendar month or your payday.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;
  const C = typeof require === 'function' ? require('./cycle.js') : root.Cycle;

  const amountOf = e => U.spendOf(e);        // your own share, as in the budget
  const total = items => U.round2(items.reduce((sum, e) => sum + amountOf(e), 0));
  const within = (items, start, end) => items.filter(e => e.date && e.date >= start && e.date <= end);
  const pct1 = n => Math.round(n * 10) / 10;

  // The period before (direction -1) or after (+1) the given one.
  function shiftCycle(cycle, settings, direction) {
    return direction < 0 ? C.cycleFor(U.addDays(cycle.start, -1), settings) : C.cycleFor(U.addDays(cycle.end, 1), settings);
  }

  // expenses: everything recorded; cycle: the period to look at; today: 'YYYY-MM-DD'.
  // For a period still in progress the comparison uses the previous period up to the same day, so a half-finished
  // month is not set against a whole one.
  function summarize(expenses, cycle, settings, today) {
    const items = within(expenses || [], cycle.start, cycle.end);
    const sum = total(items);
    const inProgress = today >= cycle.start && today <= cycle.end;
    const elapsed = inProgress ? U.daysBetween(cycle.start, today) + 1 : cycle.days;

    const byCat = {};
    for (const e of items) byCat[e.category || 'Other'] = (byCat[e.category || 'Other'] || 0) + amountOf(e);
    const byCategory = Object.entries(byCat)
      .map(([category, amount]) => ({ category, amount: U.round2(amount), pct: sum ? pct1(amount / sum * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount);

    const biggest = items.reduce((top, e) => (!top || amountOf(e) > amountOf(top) ? e : top), null);

    const previous = shiftCycle(cycle, settings, -1);
    const previousEnd = inProgress ? U.addDays(previous.start, Math.min(elapsed, previous.days) - 1) : previous.end;
    const previousTotal = total(within(expenses || [], previous.start, previousEnd));
    const change = previousTotal > 0 ? pct1((sum - previousTotal) / previousTotal * 100) : null;

    return {
      cycle, count: items.length, total: sum, items,
      dailyAverage: elapsed > 0 ? U.round2(sum / elapsed) : 0,
      byCategory, biggest,
      comparison: { previousTotal, change, previous, basis: inProgress ? 'same-point' : 'full' },
      inProgress,
    };
  }

  const api = { shiftCycle, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Insights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
