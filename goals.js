// Savings goals: create, add money, withdraw, delete. Pure functions that return new arrays instead of
// mutating, so the UI can save the result and tests can compare before and after. Plans keep the shape the
// app already stores: { id, title, target, saved, targetDate, contributions:[{ id, amount, date, createdAt }], createdAt }.
// A withdrawal is a contribution with a negative amount and type 'withdraw'.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const fail = error => ({ ok: false, error });
  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const todayOf = options => U.formatDate((options && options.now) || new Date());
  const newId = options => ((options && options.newId) || defaultId)();

  function savedOf(plan) {
    return Math.max(0, Number(plan && plan.saved) || 0);
  }

  function replacePlan(plans, updated) {
    return plans.map(plan => (plan.id === updated.id ? updated : plan));
  }

  // input: { title, target, targetDate (optional), days (optional, used when no targetDate) }
  function createGoal(input, options = {}) {
    const title = String(input.title || '').trim();
    const target = Number(input.target);
    if (!title) return fail('Enter a name for the goal.');
    if (!Number.isFinite(target) || target <= 0) return fail('Enter a target amount above zero.');

    const today = todayOf(options);
    let targetDate = '';
    if (input.targetDate) {
      if (!U.isValidDate(input.targetDate)) return fail('Enter a valid target date.');
      if (input.targetDate < today) return fail('The target date cannot be in the past.');
      targetDate = input.targetDate;
    } else if (Number(input.days) > 0) {
      targetDate = U.addDays(today, Math.ceil(Number(input.days)));
    }

    // Daily saving: a fixed amount comes out of each day's limit until the date. `planned` is the same plan without the
    // automatic part: you add the money yourself, and the goal only shows what to put away each day.
    let auto = {};
    if (input.autoDaily) {
      if (!targetDate) return fail('Pick a date to save a little every day.');
      const own = Number(input.dailyAmount);
      auto = { autoDaily: true, dailyAmount: own > 0 ? U.round2(own) : Math.ceil(target / (U.daysBetween(today, targetDate) + 1)), autoUntil: U.addDays(today, -1) };
    } else if (input.planned && targetDate) auto = { planned: true };
    const now = (options.now || new Date()).getTime();
    return {
      ok: true,
      plan: { id: newId(options), title: title.slice(0, 80), target: U.round2(target), saved: 0, targetDate, contributions: [], createdAt: now, ...auto },
    };
  }

  // Changes anything set when the goal was created. The money already saved and its history stay as they are.
  // input: { title, target, targetDate / days (both empty = no date), autoDaily, planned }
  function editGoal(plans, planId, input, options = {}) {
    return change(plans, planId, plan => {
      const title = String(input.title === undefined ? plan.title : input.title).trim();
      const target = Number(input.target === undefined ? plan.target : input.target);
      if (!title) return fail('Enter a name for the goal.');
      if (!Number.isFinite(target) || target <= 0) return fail('Enter a target amount above zero.');
      const today = todayOf(options);
      let targetDate = plan.targetDate || '';
      if (input.targetDate !== undefined || input.days !== undefined) {
        if (input.targetDate) {
          if (!U.isValidDate(input.targetDate)) return fail('Enter a valid target date.');
          if (input.targetDate < today && input.targetDate !== plan.targetDate) return fail('The target date cannot be in the past.');
          targetDate = input.targetDate;
        } else if (Number(input.days) > 0) targetDate = U.addDays(today, Math.ceil(Number(input.days)));
        else targetDate = '';
      }
      const { autoDaily, dailyAmount, autoUntil, planned, ...rest } = plan;
      let extra = {};
      const remaining = Math.max(0, target - savedOf(plan));
      if (input.autoDaily) {
        if (!targetDate) return fail('Pick a date to save a little every day.');
        if (targetDate < today) return fail('The target date has passed. Pick a later date to save a little every day.');
        const own = Number(input.dailyAmount);
        if (remaining > 0) extra = { autoDaily: true, dailyAmount: own > 0 ? U.round2(own) : Math.ceil(remaining / (U.daysBetween(today, targetDate) + 1)), autoUntil: autoDaily && autoUntil ? autoUntil : U.addDays(today, -1) };
      } else if (input.planned && targetDate) extra = { planned: true };
      const updated = { ...rest, title: title.slice(0, 80), target: U.round2(target), targetDate, ...extra };
      return { ok: true, plans: replacePlan(plans, updated), plan: updated };
    });
  }

  // "Save it in 3, 6 or 12 months and it is this much a day": the choices shown while you set a goal up.
  function savingPlans(remaining, today, months = [3, 6, 12]) {
    const left = Math.max(0, Number(remaining) || 0);
    return months.map(m => {
      const days = Math.round(m * 365 / 12), perDay = Math.ceil(left / (days + 1));
      return { months: m, days, date: U.addDays(today, days), perDay, perMonth: Math.round(perDay * 365 / 12) };
    });
  }

  // "If I save 10 a day (or 200 a month), when do I get there?" perDay may be a fraction (200 a month is 200 / 30 a day).
  // Today counts as the first day of saving. Returns { days, date, months, years, text } or null when nothing is left or the amount is not above zero.
  function reachIn(remaining, perDay, today) {
    const left = Number(remaining), step = Number(perDay);
    if (!(left > 0) || !(step > 0)) return null;
    const days = Math.ceil(left / step - 1e-9);
    const months = Math.round(days / (365 / 12));
    const years = Math.floor(months / 12), restMonths = months % 12;
    const text = days <= 31 ? `${days} day${days === 1 ? '' : 's'}`
      : years >= 50 ? 'more than 50 years'
      : years >= 1 ? `${years} year${years === 1 ? '' : 's'}${restMonths ? ` ${restMonths} month${restMonths === 1 ? '' : 's'}` : ''}`
      : `${months} month${months === 1 ? '' : 's'}`;
    return { days, date: U.addDays(today, days - 1), months, years, text };
  }

  // A typed line like "set aside 20 for phone", "20 set aside bike", "save 500 goal trip" or "rs 1,500 goal". Returns null when the line is
  // not about a goal (so it can be an ordinary expense); otherwise { ok, amount, goal, choices, reason }. When the goal is not clear
  // (no name, or several could match) ok is false and `choices` lists the goals to pick from. With only one goal, no name is needed.
  const ASIDE_RE = /\b(?:set(?:ting)?\s*aside|put\s*aside|put\s*away|saved?|saving|goal)\b/i;
  function parseSetAside(text, plans) {
    const raw = String(text || '').trim();
    if (!raw || !ASIDE_RE.test(raw)) return null;
    const m = /(?:₹|rs\.?\s*|inr\s*)?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(raw);
    const amount = m ? U.round2(Number(m[1].replace(/,/g, ''))) : 0;
    if (!(amount > 0)) return null;
    const goals = plans || [], lower = raw.toLowerCase();
    const scored = goals.map(plan => {
      const title = String(plan.title || '').toLowerCase().trim();
      let score = title && lower.includes(title) ? 100 : 0;
      for (const word of title.split(/[^a-z0-9]+/).filter(w => w.length >= 3)) if (new RegExp(`\\b${word}\\b`).test(lower)) score += word.length;
      return { plan, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    let goal = null;
    if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) goal = scored[0].plan;
    else if (!scored.length && goals.length === 1) goal = goals[0];
    return { ok: Boolean(goal), amount, goal, choices: goal ? [goal] : (scored.length > 1 ? scored.map(x => x.plan) : goals), reason: goal ? '' : goals.length ? 'which' : 'none' };
  }

  function change(plans, planId, build) {
    const plan = (plans || []).find(item => item.id === planId);
    if (!plan) return fail('That goal no longer exists.');
    return build(plan);
  }

  function addToGoal(plans, planId, amount, date, options = {}) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return fail('Enter an amount above zero.');
    const when = date || todayOf(options);
    if (!U.isValidDate(when)) return fail('Enter a valid date.');
    return change(plans, planId, plan => {
      const contribution = { id: newId(options), amount: U.round2(value), date: when, createdAt: (options.now || new Date()).getTime() };
      const updated = { ...plan, saved: U.round2(savedOf(plan) + contribution.amount), contributions: [...(plan.contributions || []), contribution] };
      return { ok: true, plans: replacePlan(plans, updated), plan: updated, contribution };
    });
  }

  function withdrawFromGoal(plans, planId, amount, date, options = {}) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return fail('Enter an amount above zero.');
    const when = date || todayOf(options);
    if (!U.isValidDate(when)) return fail('Enter a valid date.');
    return change(plans, planId, plan => {
      if (value > savedOf(plan) + 0.005) return fail('You cannot take out more than the goal has saved.');
      const contribution = { id: newId(options), type: 'withdraw', amount: -U.round2(value), date: when, createdAt: (options.now || new Date()).getTime() };
      const updated = { ...plan, saved: U.round2(Math.max(0, savedOf(plan) + contribution.amount)), contributions: [...(plan.contributions || []), contribution] };
      return { ok: true, plans: replacePlan(plans, updated), plan: updated, contribution };
    });
  }

  function removeContribution(plans, planId, contributionId) {
    return change(plans, planId, plan => {
      const contribution = (plan.contributions || []).find(item => item.id === contributionId);
      if (!contribution) return fail('That entry no longer exists.');
      const updated = {
        ...plan,
        saved: U.round2(Math.max(0, savedOf(plan) - (Number(contribution.amount) || 0))),
        contributions: plan.contributions.filter(item => item.id !== contributionId),
      };
      return { ok: true, plans: replacePlan(plans, updated), plan: updated };
    });
  }

  // outcome 'return': the saved money goes back to your available balance (its contributions disappear,
  //   so the months it was set aside in free it up again).
  // outcome 'spent': you used it for the goal; it becomes one expense on `date` so it still counts as spent.
  function deleteGoal(plans, planId, options = {}) {
    const outcome = options.outcome === 'spent' ? 'spent' : 'return';
    return change(plans, planId, plan => {
      const released = savedOf(plan);
      let expense = null;
      if (outcome === 'spent' && released > 0) {
        const date = options.date || todayOf(options);
        if (!U.isValidDate(date)) return fail('Enter a valid date.');
        expense = {
          id: newId(options), amount: released, description: String(plan.title || 'Goal').slice(0, 100), category: 'Other',
          date, createdAt: (options.now || new Date()).getTime(), source: 'goal', goalId: plan.id,
        };
      }
      return { ok: true, plans: plans.filter(item => item.id !== planId), released, outcome, expense };
    });
  }

  // Money set aside for goals during a month (withdrawals subtract). It lowers that month's spendable
  // budget. Older goals that only have a saved total and no dated entries cannot be placed in a month.
  // With `asOf` ('YYYY-MM-DD') only entries dated on or before that day count, which is how a past day's
  // numbers are rebuilt exactly as they stood at the end of that day.
  function goalReservedInRange(plans, start, end, asOf) {
    let total = 0;
    for (const plan of plans || []) {
      for (const item of plan.contributions || []) {
        if (item.date && item.date >= start && item.date <= end && (!asOf || item.date <= asOf)) total += Number(item.amount) || 0;
      }
    }
    return U.round2(total);
  }
  // Every entry put into goals in a range, as { date, amount, spread }. A top-up is used up from that day's limit and money
  // taken out is added to it (spread false); only a leftover moved in from an earlier day is shared over the rest of the
  // period (spread true).
  function goalMovesInRange(plans, start, end, asOf) {
    const moves = [];
    for (const plan of plans || []) {
      for (const item of plan.contributions || []) {
        if (!(item.date && item.date >= start && item.date <= end && (!asOf || item.date <= asOf))) continue;
        const amount = Number(item.amount) || 0;
        if (amount) moves.push({ date: item.date, amount, spread: Boolean(item.swept) });
      }
    }
    return moves;
  }
  // Flags one entry as a leftover moved in from an earlier day, so it is shared over the period instead of charged to today.
  function markSwept(plans, planId, contributionId) {
    return (plans || []).map(plan => (plan.id !== planId ? plan : { ...plan, contributions: (plan.contributions || []).map(item => (item.id === contributionId ? { ...item, swept: true } : item)) }));
  }
  function goalReservedForMonth(plans, month, asOf) {
    return goalReservedInRange(plans, `${month}-01`, `${month}-31`, asOf);
  }

  function totalSaved(plans) {
    return U.round2((plans || []).reduce((sum, plan) => sum + savedOf(plan), 0));
  }

  function goalProgress(plan, today) {
    const target = Math.max(0, Number(plan.target) || 0);
    const saved = savedOf(plan);
    const remaining = U.round2(Math.max(0, target - saved));
    const achieved = target > 0 && saved >= target;
    const progress = { target, saved, remaining, achieved, pct: target ? Math.min(100, U.round2(saved / target * 100)) : 0, daysLeft: null, neededPerDay: null, neededPerMonth: null };

    if (achieved) return { ...progress, status: 'achieved' };
    if (!plan.targetDate) return { ...progress, status: 'no-deadline' };

    const daysLeft = U.daysBetween(today, plan.targetDate);
    if (daysLeft < 0) return { ...progress, status: 'overdue', daysLeft };
    // Today counts as a day you can still save, so a goal due today needs the whole remainder today.
    const span = daysLeft + 1;
    return { ...progress, status: 'active', daysLeft, neededPerDay: U.round2(remaining / span), neededPerMonth: U.round2(remaining / span * 30) };
  }

  // Adds the daily amount for every day since the last time, up to today (or the goal's date, or until it is full).
  // Each is an ordinary entry dated that day, so it comes out of that day's limit. Returns { plans, changed }.
  function applyAutoSave(plans, today, options = {}) {
    let changed = false;
    const next = (plans || []).map(plan => {
      if (!plan.autoDaily || !(plan.dailyAmount > 0) || !plan.autoUntil) return plan;
      const last = plan.targetDate && plan.targetDate < today ? plan.targetDate : today;
      if (last <= plan.autoUntil) return plan;
      const contributions = [...(plan.contributions || [])];
      let saved = savedOf(plan);
      for (let date = U.addDays(plan.autoUntil, 1); date <= last; date = U.addDays(date, 1)) {
        const amount = Math.min(plan.dailyAmount, U.round2(Math.max(0, Number(plan.target) - saved)));
        if (!(amount > 0)) break;
        contributions.push({ id: `auto-${plan.id}-${date}`, amount, date, createdAt: (options.now || new Date()).getTime(), auto: true });
        saved = U.round2(saved + amount);
      }
      changed = true;
      return { ...plan, contributions, saved, autoUntil: last };
    });
    return { plans: changed ? next : plans, changed };
  }
  const stopAutoSave = (plans, planId) => (plans || []).map(plan => (plan.id === planId ? { ...plan, autoDaily: false } : plan));

  const api = { applyAutoSave, stopAutoSave, createGoal, editGoal, savingPlans, reachIn, parseSetAside, addToGoal, withdrawFromGoal, removeContribution, deleteGoal, goalReservedForMonth, goalReservedInRange, goalMovesInRange, markSwept, totalSaved, goalProgress, savedOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Goals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
