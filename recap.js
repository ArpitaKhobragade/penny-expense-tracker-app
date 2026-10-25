// A short look back at the last seven days: what you spent, where, your quiet days and your streak under the daily limit.
// Pure function; the Today screen shows it as one card about once a week.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  // input: { expenses, rows (day rows from the day-by-day list: [{ date, over }]), today, days (default 7) }
  // The week ends yesterday, so the card never describes a day that is still going on.
  // -> { from, to, total, count, perDay, noSpendDays, biggest, topCategory: { category, amount } | null, streak }
  function weeklyRecap(input) {
    const days = input.days || 7;
    const to = U.addDays(input.today, -1), from = U.addDays(to, -(days - 1));
    const items = (input.expenses || []).filter(e => e.date && e.date >= from && e.date <= to && !e.cashIn);
    const total = U.round2(items.reduce((sum, e) => sum + U.spendOf(e), 0));
    const byCategory = {};
    for (const e of items) byCategory[e.category || 'Other'] = U.round2((byCategory[e.category || 'Other'] || 0) + U.spendOf(e));
    const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
    const biggest = items.reduce((max, e) => (!max || U.spendOf(e) > U.spendOf(max) ? e : max), null);
    const spentDays = new Set(items.filter(e => U.spendOf(e) > 0).map(e => e.date));
    let streak = 0;
    const byDate = new Map((input.rows || []).map(r => [r.date, r]));
    for (let d = to; byDate.has(d) && !byDate.get(d).over && streak < days; d = U.addDays(d, -1)) streak++;
    return {
      from, to, total, count: items.length, perDay: U.round2(total / days), noSpendDays: days - spentDays.size,
      biggest: biggest && U.spendOf(biggest) > 0 ? biggest : null,
      topCategory: top ? { category: top[0], amount: top[1] } : null, streak,
    };
  }

  const api = { weeklyRecap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Recap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
