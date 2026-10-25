// "How much can I spend?" for today, for a date range and for a month. Pure functions over plain data.
// Every figure is recalculated from what is left, so there are no rollover rules to maintain:
// spend less today and tomorrow's allowance grows; overspend and the shortfall spreads over the days left.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const amountOf = item => U.spendOf(item);   // your own share: money others owe you back is not spending
  const sum = items => U.round2(items.reduce((total, item) => total + amountOf(item), 0));

  const amounts = items => U.round2(items.reduce((total, item) => total + (Number(item.amount) || 0), 0));

  function spreadOver(remaining, days) {
    return days > 0 ? U.round2(Math.max(0, remaining) / days) : 0;
  }

  // input: { month:'YYYY-MM' or cycle:{start,end}, today:'YYYY-MM-DD', budget, addedFunds, goalReserved, expenses, commitments }
  //   goalReserved: money set aside for goals in this period (see goals.goalReservedInRange)
  //   commitments: bills not yet paid that fall in this period, [{ date, amount }] (see bills.billCommitments)
  //   goalMoves: money put into goals, one { date, amount, spread } per entry (see goals.goalMovesInRange). Money put in on a day
  //     is used up from that day's limit like spending is, and money taken out (a negative amount) is added to it; entries
  //     marked spread (a moved leftover) are shared over the rest of the period instead. When given, it replaces goalReserved.
  //   billPayments: ids of expenses that paid a bill (see bills.billPaymentIds); their money was already set aside, so they
  //     count against the period but not against any one day's allowance
  // Expenses dated after today count as commitments too (a rent entry for the 28th) and lower today's allowance.
  function safeToSpend(input) {
    const { today } = input;
    const start = input.cycle ? input.cycle.start : `${input.month}-01`;
    const end = input.cycle ? input.cycle.end : U.dateInMonth(input.month, 31);
    const days = U.daysBetween(start, end) + 1;
    const budget = Math.max(0, Number(input.budget) || 0);
    const addedFunds = Math.max(0, Number(input.addedFunds) || 0);
    const moves = Array.isArray(input.goalMoves) ? input.goalMoves.filter(m => m.date && m.date >= start && m.date <= end) : null;
    const dayMoves = moves ? moves.filter(m => !m.spread) : [];
    const goalReserved = moves ? amounts(moves) : Number(input.goalReserved) || 0;
    const pool = U.round2(budget + addedFunds - (moves ? amounts(moves.filter(m => m.spread)) : goalReserved));
    const periodExpenses = (input.expenses || []).filter(e => e.date && e.date >= start && e.date <= end);
    const billsDue = sum((input.commitments || []).filter(c => c.date >= start && c.date <= end));
    const billIds = new Set(input.billPayments || []);
    const fixedPaid = sum(periodExpenses.filter(e => billIds.has(e.id)));        // bills already paid this period
    const dayExpenses = periodExpenses.filter(e => !billIds.has(e.id));          // everything else, day by day

    const available = U.round2(budget + addedFunds - goalReserved);
    const spent = sum(periodExpenses);
    const monthLeft = U.round2(available - spent - billsDue); // what is really free: after spending and unpaid bills
    const result = {
      hasBudget: budget + addedFunds > 0,
      status: 'current',
      available, spent, monthLeft, billsDue,
      overBy: monthLeft < 0 ? U.round2(-monthLeft) : 0,
      goalReserved: U.round2(goalReserved),
      cycle: { start, end, days },
      daysLeft: 0, spentToday: 0, committed: 0,
      allowanceToday: null, leftToday: null, tomorrowAllowance: null,
    };

    if (today > end) return { ...result, status: 'past' };
    if (today < start) {
      result.status = 'upcoming';
      result.daysLeft = days;
      result.allowanceToday = result.hasBudget ? spreadOver(available - spent - billsDue, days) : null;
      return result;
    }

    const daysLeft = U.daysBetween(today, end) + 1;
    const goalBefore = amounts(dayMoves.filter(m => m.date < today)), goalToday = amounts(dayMoves.filter(m => m.date === today)), goalAfter = amounts(dayMoves.filter(m => m.date > today));
    const before = sum(dayExpenses.filter(e => e.date < today)) + goalBefore;
    const spentToday = sum(dayExpenses.filter(e => e.date === today));
    const committed = sum(dayExpenses.filter(e => e.date > today)) + goalAfter;
    const allowance = result.hasBudget ? spreadOver(pool - fixedPaid - before - committed - billsDue, daysLeft) : null;
    const remainingAfterToday = pool - fixedPaid - before - spentToday - goalToday - committed - billsDue;

    return {
      ...result, daysLeft, spentToday, goalToday, committed,
      dayPool: U.round2(pool - fixedPaid - billsDue), daySpent: U.round2(before + spentToday + goalToday),
      allowanceToday: allowance,
      leftToday: allowance === null ? null : U.round2(allowance - spentToday - goalToday),
      tomorrowAllowance: result.hasBudget && daysLeft > 1 ? spreadOver(remainingAfterToday, daysLeft - 1) : null,
    };
  }

  // input: { start, end, total, today, expenses }  (all dates 'YYYY-MM-DD', end inclusive)
  // Every expense dated inside the range counts, not only ones created from the target form.
  function periodAllowance(input) {
    const { start, end, today } = input;
    const total = Math.max(0, Number(input.total) || 0);
    const days = U.daysBetween(start, end) + 1;
    if (!(days >= 1)) return { valid: false, status: 'invalid' };

    const inRange = (input.expenses || []).filter(e => e.date >= start && e.date <= end);
    const goalIn = (input.goalMoves || []).filter(m => m.date >= start && m.date <= end && Number(m.amount));   // money put into goals counts as used, money taken out as added
    const spent = sum(inRange), goal = amounts(goalIn), used = U.round2(spent + goal);
    const status = today < start ? 'upcoming' : today > end ? 'ended' : 'active';
    const result = {
      valid: true, status, days, total, spent, goal,
      remaining: U.round2(total - used),
      overBy: used > total ? U.round2(used - total) : 0,
      daysLeft: 0, spentToday: 0, goalToday: 0, committed: 0, allowanceToday: null, leftToday: null,
    };
    if (status === 'ended') return result;
    if (status === 'upcoming') return { ...result, daysLeft: days, allowanceToday: spreadOver(total - used, days) };

    const daysLeft = U.daysBetween(today, end) + 1;
    const before = sum(inRange.filter(e => e.date < today)) + amounts(goalIn.filter(m => m.date < today));
    const spentToday = sum(inRange.filter(e => e.date === today)), goalToday = amounts(goalIn.filter(m => m.date === today));
    const committed = sum(inRange.filter(e => e.date > today)) + amounts(goalIn.filter(m => m.date > today));
    const allowance = spreadOver(total - before - committed, daysLeft);
    return { ...result, daysLeft, spentToday, goalToday, committed, allowanceToday: allowance, leftToday: U.round2(allowance - spentToday - goalToday) };
  }

  // One row per day of the range, each with the allowance that applied at the start of that day.
  function periodSchedule(input) {
    const { start, end } = input;
    const total = Math.max(0, Number(input.total) || 0);
    const days = U.daysBetween(start, end) + 1;
    if (!(days >= 1)) return [];
    const expenses = (input.expenses || []).filter(e => e.date >= start && e.date <= end);
    const moves = (input.goalMoves || []).filter(m => m.date >= start && m.date <= end);
    const funds = (input.funds || []).filter(f => f.date);   // money added on a later day only counts from that day on
    const rows = [];
    let spentSoFar = 0;
    for (let i = 0; i < days; i++) {
      const date = U.addDays(start, i);
      const spent = U.round2(sum(expenses.filter(e => e.date === date)) + amounts(moves.filter(m => m.date === date)));
      const allowance = spreadOver(total + amounts(funds.filter(f => f.date <= date)) - spentSoFar, days - i);
      rows.push({ date, spent, allowance, left: U.round2(allowance - spent), over: spent > allowance });
      spentSoFar = U.round2(spentSoFar + spent);
    }
    return rows;
  }

  // The same day-by-day view for a month or pay cycle. Same input as safeToSpend. Bills are set aside first (paid or not),
  // so the money left over is spread across the days, and the bill payments themselves are not counted as a day's spending.
  // Rows run from the first day up to `today` (all days once the period is over); an empty list means no budget is set.
  function monthSchedule(input) {
    const start = input.cycle ? input.cycle.start : `${input.month}-01`;
    const end = input.cycle ? input.cycle.end : U.dateInMonth(input.month, 31);
    const budget = Math.max(0, Number(input.budget) || 0), addedFunds = Math.max(0, Number(input.addedFunds) || 0);
    if (!(budget + addedFunds > 0)) return [];
    const billIds = new Set(input.billPayments || []);
    const periodExpenses = (input.expenses || []).filter(e => e.date && e.date >= start && e.date <= end);
    const fixedPaid = sum(periodExpenses.filter(e => billIds.has(e.id)));
    const billsDue = sum((input.commitments || []).filter(c => c.date >= start && c.date <= end));
    const moves = Array.isArray(input.goalMoves) ? input.goalMoves.filter(m => m.date && m.date >= start && m.date <= end) : null;
    const dayMoves = moves ? moves.filter(m => !m.spread) : [];
    const reserved = moves ? amounts(moves.filter(m => m.spread)) : Number(input.goalReserved) || 0;
    // With dated money (fundList) each addition counts from its own day; without it the whole sum counts from day one.
    const funds = Array.isArray(input.fundList) ? input.fundList.filter(f => f.date && f.date >= start && f.date <= end) : null;
    const total = U.round2(budget + (funds ? 0 : addedFunds) - reserved - fixedPaid - billsDue);
    const rows = periodSchedule({ start, end, total, funds: funds || [], expenses: periodExpenses.filter(e => !billIds.has(e.id)), goalMoves: dayMoves });
    return rows.filter(row => row.date <= input.today);
  }

  const api = { safeToSpend, periodAllowance, periodSchedule, monthSchedule };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BudgetMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
