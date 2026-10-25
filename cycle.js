// The budgeting period you are in. By default it is the calendar month; if your salary arrives on, say, the 25th,
// the period can run from payday to the day before the next payday, so "left this month" really means
// "left until the money comes in again". The monthly budget you set applies to each period.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  // settings: { mode: 'month' | 'payday', paydayDay: 1..31 }; anything invalid falls back to the calendar month.
  function normalize(settings) {
    const day = Math.round(Number(settings && settings.paydayDay));
    return { mode: settings && settings.mode === 'payday' ? 'payday' : 'month', paydayDay: day >= 1 && day <= 31 ? day : 1 };
  }

  // The period that contains `today`: { mode, start, end, days, paydayDay }. A payday on the 31st falls on the
  // last day of shorter months, and a payday on the 1st is the same as the calendar month.
  function cycleFor(today, settings) {
    const s = normalize(settings);
    const month = today.slice(0, 7);
    let start, end;
    if (s.mode === 'month' || s.paydayDay === 1) {
      start = `${month}-01`;
      end = U.dateInMonth(month, 31);
    } else {
      const thisPayday = U.dateInMonth(month, s.paydayDay);
      if (today >= thisPayday) {
        start = thisPayday;
        end = U.addDays(U.dateInMonth(U.shiftMonth(month, 1), s.paydayDay), -1);
      } else {
        start = U.dateInMonth(U.shiftMonth(month, -1), s.paydayDay);
        end = U.addDays(thisPayday, -1);
      }
    }
    return { mode: s.mode, start, end, days: U.daysBetween(start, end) + 1, paydayDay: s.paydayDay };
  }

  // Should Penny offer to change the payday because a salary arrived on salaryDate? Returns { day } or null.
  // Nothing is offered when the setting already fits: a payday within 3 days of the salary day, or (counting by calendar
  // month) a salary at the very start or end of a month, which the calendar month already matches.
  function suggestPayday(settings, salaryDate) {
    if (!U.isValidDate(salaryDate)) return null;
    const s = normalize(settings);
    const day = Number(salaryDate.slice(8, 10));
    if (s.mode === 'payday') {
      const gap = Math.abs(s.paydayDay - day);
      return Math.min(gap, 30 - gap) <= 3 ? null : { day };
    }
    return day <= 3 || day >= 28 ? null : { day };
  }

  const inCycle = (cycle, date) => Boolean(date) && date >= cycle.start && date <= cycle.end;
  const sumIn = (items, cycle) => U.round2((items || []).filter(item => inCycle(cycle, item.date)).reduce((total, item) => total + (Number(item.amount) || 0), 0));

  const api = { normalize, cycleFor, suggestPayday, inCycle, sumIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Cycle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
