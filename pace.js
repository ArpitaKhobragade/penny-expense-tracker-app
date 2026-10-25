// "Will my money last?" At the pace you have been spending, on which day would this period's spending money run out?
// Pure function over plain numbers; the Today screen shows a warning only when the answer is before the period ends.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const MIN_DAYS = 4;   // fewer days than this says little about a pace

  // input: { cycle: { start, end }, today, dayPool (money for day-to-day spending this period, after bills and goals),
  //          daySpent (day-to-day spending and goal top-ups so far, today included) }
  // -> { status: 'early' | 'ok' | 'over' | 'warn', average, runOutDate, daysShort }
  //    'warn' carries runOutDate (first day without money) and daysShort (days from then to the end, inclusive).
  function checkPace(input) {
    const { cycle, today } = input;
    const total = U.daysBetween(cycle.start, cycle.end) + 1;
    const elapsed = U.daysBetween(cycle.start, today) + 1;
    const pool = Number(input.dayPool) || 0, spent = Number(input.daySpent) || 0;
    if (!(elapsed >= MIN_DAYS) || today > cycle.end) return { status: 'early', average: 0 };
    const average = U.round2(spent / elapsed);
    if (!(pool > 0) || spent >= pool) return { status: 'over', average };
    if (!(average > 0)) return { status: 'ok', average };
    const covered = Math.floor(pool / average);          // days from the start of the period that the money covers
    if (covered >= total) return { status: 'ok', average };
    const runOutDate = U.addDays(cycle.start, covered);
    if (runOutDate <= today) return { status: 'over', average };
    return { status: 'warn', average, runOutDate, daysShort: U.daysBetween(runOutDate, cycle.end) + 1 };
  }

  const api = { checkPace, MIN_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Pace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
