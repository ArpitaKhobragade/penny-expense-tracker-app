// Screen code for today.html. The rules (parsing, budget maths, goals, inbox) live in the modules it loads;
// this file only reads the saved data, draws it, and passes what you tap back to those modules.
(() => {
  const U = ExpenseUtils, B = BudgetMath, G = Goals, I = Inbox, S = Store, Sw = Sweep, A = Afford, C = Cycle, Bi = Bills, Ex = Expenses, Ins = Insights, O = Owed, Ac = Accounts, Pt = Pots, Tr = Trash, Pa = Pace, Rc = Recap, Rec = Recurring, Ca = Cash, Up = Upi, Sa = Salary, Xb = ExtrasBridge;
  const $ = id => document.getElementById(id);
  const sv = path => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  const ICON = {
    Food: sv('<path d="M5 8h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5zM16 9h2a2 2 0 0 1 0 4h-2M8 3v2M12 3v2"/>'),
    Travel: sv('<path d="M7 17L17 7M9 7h8v8"/>'),
    Shopping: sv('<path d="M5 8h14l-1 11H6zM9 8V6a3 3 0 0 1 6 0v2"/>'),
    Bills: sv('<path d="M7 3h8l4 4v14H7zM14 3v5h5M10 13h6M10 17h6"/>'),
    Health: sv('<path d="M12 5v14M5 12h14"/>'),
    Education: sv('<path d="M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z"/>'),
    Entertainment: sv('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>'),
    Other: sv('<circle cx="12" cy="12" r="1.5"/>'),
    Owed: sv('<path d="M17 7L7 17M15 17H7V9"/>'),
  };
  const CATEGORY_META = { Food: [ICON.Food, '#e6f2e9'], Travel: [ICON.Travel, '#e8f0fb'], Shopping: [ICON.Shopping, '#f7eee7'], Bills: [ICON.Bills, '#f1edfa'], Health: [ICON.Health, '#fceeed'], Education: [ICON.Education, '#edf3fa'], Entertainment: [ICON.Entertainment, '#f9eff7'], Other: [ICON.Other, '#f1f3f1'] };
  const VIEWS = ['today', 'add', 'review', 'goals', 'newgoal', 'history', 'bills', 'accounts', 'cash', 'settings', 'trash', 'more'];
  const SUBVIEWS = ['history', 'bills', 'accounts', 'cash', 'settings', 'trash'];   // reached from More; Back returns there

  // Falls back to memory if the browser refuses storage, and says so, instead of failing silently.
  const storage = (() => {
    try { localStorage.setItem('__pocket', '1'); localStorage.removeItem('__pocket'); return localStorage; }
    catch { const mem = {}; return { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; }, memoryOnly: true }; }
  })();

  let state = S.loadState(storage);
  let inboxData = S.loadInbox(storage);
  let sweeps = S.loadSweeps(storage);
  let billData = S.loadBills(storage);
  let settings = S.loadSettings(storage);
  let owedData = S.loadOwed(storage);
  let accountData = S.loadAccounts(storage);
  let potsData = S.loadPots(storage);
  let cashData = S.loadCash(storage);
  let trashData = S.loadTrash(storage);
  state.expenses = O.annotate(state.expenses, owedData.debts); // what others owe you for a payment is not your spending
  let openOwedForm = null; // personKey of the "got money back" form that is open
  let currentSweep = null;
  let openGoalForm = null; // { id, kind: 'add' | 'take' }
  let openGoalHistory = null; // id of the goal whose history is showing
  let toastTimer;

  const today = () => U.formatDate(new Date());
  const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: Math.abs(value) % 1 ? 2 : 0 }).format(value);
  // Spendable amounts are shown rounded down so the app never promises more than there is.
  const rupees = value => money(Math.floor(value + 0.0001));
  // Bank balances can be hidden with the eye on Account balances; nothing else is hidden.
  const bank = value => (settings.hideAmounts ? '₹ ••••' : money(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const longDate = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  function dayLabel(iso) {
    const t = today();
    if (iso === t) return 'Today';
    if (iso === U.addDays(t, -1)) return 'Yesterday';
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  const meta = category => CATEGORY_META[category] || CATEGORY_META.Other;
  const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function showToast(message, action) {
    const toast = $('toast'), button = $('toast-action');
    $('toast-text').textContent = message;
    button.classList.toggle('hidden', !action);
    button.onclick = action ? () => { toast.classList.remove('show'); action.run(); } : null;
    if (action) button.textContent = action.label;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), action ? 5000 : 2600);
  }

  function commit() {
    state.plans = G.applyAutoSave(state.plans, today()).plans;   // goals that take a little every day
    state.expenses = O.annotate(state.expenses, owedData.debts);
    const saved = S.saveState(storage, state) && S.saveInbox(storage, inboxData) && S.saveSweeps(storage, sweeps) && S.saveBills(storage, billData) && S.saveOwed(storage, owedData) && S.saveAccounts(storage, accountData) && S.savePots(storage, potsData) && S.saveCash(storage, cashData) && S.saveSettings(storage, settings) && S.saveTrash(storage, trashData);
    if (!saved) showToast('Could not save. Check your browser storage settings.');
    render();
    return saved;
  }

  // ---------- numbers ----------
  const cycleNow = () => C.cycleFor(today(), settings);
  const isMonthly = () => { const c = cycleNow(); return c.mode === 'month' || c.paydayDay === 1; };
  const restOfPeriod = () => (isMonthly() ? 'the rest of the month' : 'the days until payday');
  // Spending as the daily limit sees it: what a budget (Shopping, Orders...) covers with its own money is taken out, and only
  // the part above that budget stays.
  const spendingList = () => state.expenses.filter(e => !e.cashIn);   // an ATM withdrawal added to cash in hand is not spending
  const budgetView = () => Pt.spendingView(spendingList(), potsData, cycleNow());
  // The money for day-to-day spending: the monthly budget minus what is set aside in specific budgets. Spending that falls
  // inside a specific budget comes out of that budget, and only what goes beyond it comes out of the daily money.
  const needsReserved = () => U.round2(budgetView().pots.reduce((sum, p) => sum + p.budget, 0));
  // "Cut from the monthly budget" (the default): the daily money is what is left after the specific budgets. "Keep it separate":
  // the specific budgets are extra money and the daily money is the whole monthly budget.
  const addedFor = cycle => (state.budget > 0 ? C.sumIn(state.monthlyFunds, cycle) : 0);
  const dailyBudget = () => (state.budget > 0 ? (settings.specificMode === 'extra' ? U.round2(state.budget) : Math.max(0, U.round2(state.budget - needsReserved()))) : 0);
  const budgetExpenses = () => budgetView().expenses;
  // Every bill falling in the current period, with whether it is paid yet.
  function billRows() {
    const cycle = cycleNow();
    return Bi.billOccurrences({ bills: billData.bills, paid: billData.paid, expenses: state.expenses, start: cycle.start, end: cycle.end, today: today() });
  }
  function outlook() {
    const cycle = cycleNow(), rows = billRows();
    return B.safeToSpend({
      cycle, today: today(), budget: dailyBudget(), addedFunds: addedFor(cycle),
      goalMoves: G.goalMovesInRange(state.plans, cycle.start, cycle.end), expenses: budgetExpenses(),
      commitments: rows.filter(row => row.state !== 'paid'), billPayments: Bi.billPaymentIds(rows, state.expenses, billData.paid),
    });
  }
  // ---------- Today ----------
  function renderHero(o) {
    const hero = $('hero');
    hero.classList.remove('over', 'idle');
    $('hero-set-budget').classList.add('hidden');
    const set = (label, amount, sub, foot, pct) => {
      $('hero-label').textContent = label; $('hero-amount').textContent = amount; $('hero-sub').textContent = ''; $('hero-foot').textContent = '';
      $('hero-bar-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    };
    if (!o.hasBudget) {
      hero.classList.add('idle');
      set('Let’s get started', 'Set a budget', '', '', 0);
      $('hero-set-budget').classList.remove('hidden');
      return;
    }
    const tomorrow = o.tomorrowAllowance == null ? (isMonthly() ? 'Last day of the month' : 'Last day before payday') : `Tomorrow about ${rupees(o.tomorrowAllowance)} · ${o.daysLeft} days left ${isMonthly() ? 'this month' : 'until payday'}`;
    if (o.overBy > 0) {
      hero.classList.add('over');
      set(`You’re over this ${isMonthly() ? 'month' : 'pay cycle'}’s budget by`, money(Math.ceil(o.overBy)), `Spent ${money(o.spent)} of ${money(o.available)}`, '', 100);
    } else if (o.allowanceToday === 0) {
      hero.classList.add('idle');
      set('Nothing left to spend today', money(0), '', tomorrow, 100);
    } else if (o.leftToday < 0) {
      hero.classList.add('over');
      set('Over today’s limit by', money(Math.ceil(-o.leftToday)), `Today’s limit was ${rupees(o.allowanceToday)} · spent ${money(o.spentToday)}${o.goalToday ? ` · saved ${money(o.goalToday)}` : ''}`, tomorrow, 100);
    } else {
      set('You can spend today', rupees(o.leftToday), `Today’s limit ${rupees(o.allowanceToday)} · spent ${money(o.spentToday)}${o.goalToday ? ` · saved ${money(o.goalToday)}` : ''}`, tomorrow, o.allowanceToday ? (o.spentToday + o.goalToday) / o.allowanceToday * 100 : 0);
    }
  }

  const potTag = e => { const p = Pt.potFor(e, potsData.pots); return `${e.cash ? ' · cash' : ''}${p ? ` · ${esc(p.name)}` : ''}`; };
  // One expense in a list. Tap it to edit; the × deletes.
  function expenseRow(e) {
    const m = meta(e.category), forOthers = Number(e.owedTotal) > 0;
    return `<div class="row"><div class="sym" style="background:${m[1]}" aria-hidden="true">${m[0]}</div>
      <div class="tap" data-edit="${esc(e.id)}" role="button" tabindex="0" aria-label="Edit ${esc(e.description)}"><div class="row-title">${esc(e.description)}${e.source === 'sms' ? '<span class="pill">from bank</span>' : ''}</div><div class="row-meta">${esc(e.category)} · ${dayLabel(e.date)}${potTag(e)}${forOthers ? ` · you paid ${money(Number(e.amount))} for others` : ''}</div></div>
      <div class="row-amount">−${money(U.spendOf(e))}</div>
      <button class="icon-btn" type="button" data-delete-expense="${esc(e.id)}" aria-label="Delete ${esc(e.description)}"><span class="ico ico-x" aria-hidden="true"></span></button></div>`;
  }

  function renderToday() {
    const o = outlook();
    renderHero(o);
    pushWidget(o);
    $('stat-left-label').textContent = o.billsDue > 0 ? 'After bills' : 'Left';
    $('stat-spent-label').textContent = 'Spent';
    $('stat-left').textContent = o.hasBudget ? money(o.monthLeft) : '—';
    $('stat-left').classList.toggle('neg', o.hasBudget && o.monthLeft < 0);
    $('stat-spent').textContent = money(o.spent);
    $('stat-goals').textContent = money(o.goalReserved);
    renderSalary();
    renderPace(o);
    renderBillsCard();
    renderOwedCard();
    renderSweep();
    renderPlanning();
  }

  // ---------- Today: a salary arrived, offer to count the budget from payday ----------
  function renderSalary() {
    const card = $('salary-card');
    const item = (inboxData.salary || []).slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!item) { card.classList.add('hidden'); return; }
    const day = Number(item.date.slice(8, 10));
    card.classList.remove('hidden');
    card.dataset.id = item.id;
    $('salary-title').textContent = `Salary of ${money(item.amount)} arrived on ${longDate(item.date)}`;
    $('salary-yes').textContent = `Use the ${ordinal(day)} as payday`;
  }
  $('salary-yes').addEventListener('click', () => {
    const before = settings;
    const result = I.acceptSalary(inboxData, $('salary-card').dataset.id);
    if (!result.ok) { showToast(result.error); return; }
    settings = { ...settings, ...result.settings }; inboxData = result.data; commit();
    showToast(`Your budget now starts on day ${result.day}`, { label: 'Undo', run: () => { settings = before; commit(); } });
  });
  $('salary-plan').addEventListener('click', () => {
    const item = (inboxData.salary || []).find(s => s.id === $('salary-card').dataset.id);
    if (item) openBudget({ salary: item.amount, fromMessage: item.id });
  });
  $('salary-no').addEventListener('click', () => {
    inboxData = I.ignoreSalary(inboxData, $('salary-card').dataset.id); commit();
    showToast('OK, your payday stays as it is');
  });

  // ---------- Today: move yesterday's leftover into a goal ----------
  function renderSweep() {
    const card = $('sweep-card');
    currentSweep = Sw.suggestSweep({
      today: today(), budget: dailyBudget(), monthlyFunds: state.budget > 0 ? state.monthlyFunds : [], expenses: budgetExpenses(), plans: state.plans,
      decided: sweeps.decided, trackedSince: [sweeps.trackedSince, settings.budgetFrom].filter(Boolean).sort().pop(), pendingDates: inboxData.inbox.map(item => item.date),
      settings, bills: billData.bills, paid: billData.paid,
    });
    if (!currentSweep.offer) { card.classList.add('hidden'); return; }
    const s = currentSweep;
    card.classList.remove('hidden');
    // Only rebuild the fields when the offer changes, so an amount you are editing is not reset.
    if (card.dataset.key !== `${s.date}|${s.goals.map(g => g.id).join(',')}`) {
      card.dataset.key = `${s.date}|${s.goals.map(g => g.id).join(',')}`;
      const monthName = new Date(`${s.month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long' });
      const monthlyCycle = s.cycle.mode === 'month' || s.cycle.paydayDay === 1;
      $('sweep-title').textContent = s.monthEnd ? `You finished ${monthlyCycle ? monthName : 'this pay cycle'} with ${rupees(s.leftover)} unspent` : `Yesterday you were ${rupees(s.leftover)} under your limit`;
      $('sweep-goal').innerHTML = s.goals.map(g => `<option value="${esc(g.id)}">${esc(g.title)} (${rupees(g.remaining)} to go)</option>`).join('');
      $('sweep-goal-field').classList.toggle('hidden', s.goals.length < 2);
      $('sweep-amount').value = s.amount; $('sweep-amount').max = s.leftover;
    }
  }
  function decideSweep(choice, goal, entry) {
    const s = currentSweep;
    sweeps.decided = { ...sweeps.decided, [s.date]: choice };
    commit();
    const undo = () => {
      if (entry) { const r = G.removeContribution(state.plans, entry.planId, entry.id); if (r.ok) state.plans = r.plans; }
      const { [s.date]: _, ...rest } = sweeps.decided; sweeps.decided = rest;
      commit();
    };
    showToast(choice === 'moved' ? `Moved ${money(entry.amount)} to ${goal.title}` : 'Kept as spending money', { label: 'Undo', run: undo });
  }
  $('sweep-goal').addEventListener('change', () => {
    const goal = currentSweep && currentSweep.goals.find(g => g.id === $('sweep-goal').value);
    if (goal) $('sweep-amount').value = goal.amount;
  });
  $('sweep-keep').addEventListener('click', () => { if (currentSweep && currentSweep.offer) decideSweep('kept'); });
  $('sweep-move').addEventListener('click', () => {
    const s = currentSweep;
    if (!s || !s.offer) return;
    const amount = Number($('sweep-amount').value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > s.leftover) { showToast(`Enter an amount up to ${rupees(s.leftover)}`); return; }
    const goalId = s.goals.length > 1 ? $('sweep-goal').value : s.goalId;
    const result = G.addToGoal(state.plans, goalId, amount, today());
    if (!result.ok) { showToast(result.error); return; }
    state.plans = G.markSwept(result.plans, goalId, result.contribution.id);
    decideSweep('moved', result.plan, { id: result.contribution.id, planId: goalId, amount: result.contribution.amount });
  });

  // ---------- Review ----------
  function categoryOptions(selected) {
    return U.CATEGORIES.map(c => `<option${c === selected ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }
  // ---------- Goals ----------
  function goalCard(plan) {
    const t = today(), p = G.goalProgress(plan, t);
    const form = openGoalForm && openGoalForm.id === plan.id ? (openGoalForm.kind === 'add'
      ? `<form class="goal-inline" data-goal-form="add" data-id="${esc(plan.id)}">
          <div class="two"><div class="field"><label for="a-${esc(plan.id)}">Amount to add (₹)</label><input id="a-${esc(plan.id)}" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required /></div>
          <div class="field"><label for="ad-${esc(plan.id)}">Date</label><input id="ad-${esc(plan.id)}" name="date" type="date" value="${t}" required /></div></div>
          <div class="row-actions"><button class="btn" type="button" data-act="close-form">Cancel</button><button class="btn primary" type="submit">Add money</button></div></form>`
      : `<form class="goal-inline" data-goal-form="take" data-id="${esc(plan.id)}">
          <div class="two"><div class="field"><label for="a-${esc(plan.id)}">Amount to take out (₹)</label><input id="a-${esc(plan.id)}" name="amount" type="number" inputmode="decimal" min="0.01" max="${p.saved}" step="0.01" required /></div>
          <div class="field"><label for="ad-${esc(plan.id)}">Date</label><input id="ad-${esc(plan.id)}" name="date" type="date" value="${t}" required /></div></div>
          <div class="row-actions"><button class="btn" type="button" data-act="close-form">Cancel</button><button class="btn primary" type="submit">Take out</button></div></form>`) : '';
    const entries = (plan.contributions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    const history = openGoalHistory === plan.id ? `<div class="goal-history">${entries.length ? entries.map(c => {
      const out = Number(c.amount) < 0;
      return `<div class="history-row"><span>${out ? 'Taken out' : 'Added'} · ${c.date ? dayLabel(c.date) : 'no date'}</span><strong class="${out ? 'neg' : 'pos'}">${out ? '−' : '+'}${money(Math.abs(Number(c.amount) || 0))}</strong>
        <button class="icon-btn" type="button" data-act="remove-entry" data-id="${esc(plan.id)}" data-entry="${esc(c.id)}" aria-label="Remove this entry"><span class="ico ico-x" aria-hidden="true"></span></button></div>`;
    }).join('') : '<p class="hint">Nothing yet</p>'}</div>` : '';
    const open = openGoalHistory === plan.id;
    const when = p.achieved ? 'Done' : p.status === 'active' ? `${p.daysLeft + 1} day${p.daysLeft === 0 ? '' : 's'} left` : p.status === 'overdue' ? 'Past the date' : 'No date';
    return `<article class="goal-card${open ? ' open' : ''}" data-id="${esc(plan.id)}">
      <div class="goal-head" role="button" tabindex="0" data-act="toggle-history" data-id="${esc(plan.id)}" aria-expanded="${open}" aria-label="${esc(plan.title)}, ${money(p.saved)} of ${money(p.target)}">
        <div class="goal-top"><h3 class="goal-title">${esc(plan.title)}${plan.autoDaily ? `<span class="pill">${money(plan.dailyAmount)} a day</span>` : plan.planned && p.neededPerDay ? `<span class="pill">Put away ${money(Math.ceil(p.neededPerDay))} a day</span>` : ''}</h3><span class="goal-pct">${Math.round(p.pct)}%</span></div>
        <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct)}" aria-label="${esc(plan.title)} progress"><div class="goal-bar-fill" style="width:${p.pct}%"></div></div>
        <div class="goal-meta"><span>${money(p.saved)} / ${money(p.target)}</span><span>${esc(when)}</span></div>
      </div>
      ${open ? `<div class="goal-actions"><button class="btn primary" type="button" data-act="open-add" data-id="${esc(plan.id)}">+ Add money</button>
        ${p.saved > 0 ? `<button class="btn" type="button" data-act="open-take" data-id="${esc(plan.id)}">Take out</button>` : ''}
        <button class="btn" type="button" data-act="edit-goal" data-id="${esc(plan.id)}">Edit</button>
        ${plan.autoDaily ? `<button class="btn" type="button" data-act="stop-auto" data-id="${esc(plan.id)}">Stop daily saving</button>` : ''}
        <button class="btn danger" type="button" data-act="delete-goal" data-id="${esc(plan.id)}">Delete</button></div>
      ${form}${history}` : ''}</article>`;
  }
  function renderGoals() {
    const plans = state.plans.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    $('goals-list').innerHTML = plans.length ? plans.map(goalCard).join('') : '<div class="empty">No goals yet</div>';
  }

  // ---------- Recently deleted ----------
  const TRASH_ICON = {
    goal: sv('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
    plan: sv('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
    budget: sv('<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l2-3h10"/>'),
  };
  function trashDetail(entry) {
    const d = entry.data || {};
    if (entry.kind === 'goal' && d.plan) return `Goal · ${money(G.savedOf(d.plan))} of ${money(d.plan.target)} saved`;
    if (entry.kind === 'plan' && d.plan) return `Specific period · ${money(d.plan.amount)} · ${shortDay(d.plan.startDate)} – ${shortDay(d.plan.endDate)}`;
    if (entry.kind === 'budget') return `${money(d.budget)}${d.pots && d.pots.pots && d.pots.pots.length ? ` · ${d.pots.pots.length} specific budget${d.pots.pots.length === 1 ? '' : 's'}` : ''}`;
    return '';
  }
  function renderTrash() {
    trashData = Tr.clean(trashData, Date.now());
    $('trash-list').innerHTML = trashData.length ? trashData.map(entry => `<div class="row"><div class="sym" style="background:#f1edfa" aria-hidden="true">${TRASH_ICON[entry.kind] || ''}</div>
        <div><div class="row-title">${esc(entry.title)}</div><div class="row-meta">${esc(trashDetail(entry))}<br>Deleted ${esc(Tr.ago(entry, Date.now()))} · ${Tr.daysLeft(entry, Date.now())} days left</div></div>
        <button class="btn small primary" type="button" data-trash-restore="${esc(entry.id)}">Restore</button>
        <button class="icon-btn" type="button" data-trash-forget="${esc(entry.id)}" aria-label="Delete ${esc(entry.title)} for good"><span class="ico ico-x" aria-hidden="true"></span></button></div>`).join('')
      : '<div class="empty">Nothing here. Goals, plans and budgets you delete will wait here for 30 days.</div>';
  }
  // Puts a deleted goal, plan or budget back exactly as it was. Undo takes it away again.
  function restoreDeleted(id) {
    const entry = Tr.find(trashData, id);
    if (!entry) return;
    const snap = { plans: state.plans, expenses: state.expenses, dailyTargets: state.dailyTargets, budget: state.budget, settings, potsData, trashData };
    const d = entry.data || {};
    if (entry.kind === 'goal' && d.plan) {
      if (!state.plans.some(p => p.id === d.plan.id)) state.plans = [...state.plans, d.plan];
      if (d.expenseId) state.expenses = state.expenses.filter(e => e.id !== d.expenseId);   // "I spent it on this goal" is undone with it
    } else if (entry.kind === 'plan' && d.plan) {
      if (!state.dailyTargets.some(p => p.id === d.plan.id)) state.dailyTargets = [...state.dailyTargets, d.plan];
      settings = { ...settings, todayMode: 'period', planId: d.plan.id };
    } else if (entry.kind === 'budget') {
      state.budget = U.round2(Number(d.budget) || 0);
      settings = { ...settings, budgetFrom: d.budgetFrom || today(), specificMode: d.specificMode === 'extra' ? 'extra' : 'inside', todayMode: 'month' };
      potsData = d.pots && Array.isArray(d.pots.pots) ? d.pots : potsData;
    }
    trashData = Tr.remove(trashData, id);
    commit();
    showToast(`${entry.title} restored`, { label: 'Undo', run: () => { Object.assign(state, { plans: snap.plans, expenses: snap.expenses, dailyTargets: snap.dailyTargets, budget: snap.budget }); settings = snap.settings; potsData = snap.potsData; trashData = snap.trashData; commit(); } });
  }
  $('trash-list').addEventListener('click', event => {
    const restore = event.target.closest('[data-trash-restore]'), forget = event.target.closest('[data-trash-forget]');
    if (restore) { restoreDeleted(restore.dataset.trashRestore); return; }
    if (forget) {
      const before = trashData, entry = Tr.find(trashData, forget.dataset.trashForget);
      if (!entry) return;
      trashData = Tr.remove(trashData, entry.id); commit();
      showToast(`${entry.title} deleted for good`, { label: 'Undo', run: () => { trashData = before; commit(); } });
    }
  });

  // ---------- More ----------
  // Light or dark: 'auto' follows the phone, so no attribute is set and the stylesheet's media query decides.
  const shownTheme = () => (settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : (phoneIsDark && phoneIsDark.matches ? 'dark' : 'light'));
  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === 'light' || settings.theme === 'dark') root.setAttribute('data-theme', settings.theme); else root.removeAttribute('data-theme');
    const shown = shownTheme();
    $('theme-btn').dataset.mode = shown;
    $('theme-btn').setAttribute('aria-label', shown === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    tellPhoneTheme();
  }
  // The strips behind Android's status bar and navigation bar follow the app's look, not only the phone's.
  const windowPlugin = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.PocketWindow) || null;
  const phoneIsDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let lastBarDark = null;
  function tellPhoneTheme() {
    const plugin = windowPlugin();
    if (!plugin) return;
    const dark = settings.theme === 'dark' || (settings.theme !== 'light' && Boolean(phoneIsDark && phoneIsDark.matches));
    if (dark === lastBarDark) return;
    lastBarDark = dark;
    try { plugin.setTheme({ dark }); } catch { lastBarDark = null; }
  }
  if (phoneIsDark && phoneIsDark.addEventListener) phoneIsDark.addEventListener('change', tellPhoneTheme);
  $('theme-btn').addEventListener('click', () => { settings = { ...settings, theme: shownTheme() === 'dark' ? 'light' : 'dark' }; commit(); });
  function renderMore() {
    applyTheme(); $('lock-method').textContent = LockUI.methodLabel();
    const month = outlook();
    $('menu-spent').textContent = money(month.spent);
    $('menu-left').textContent = month.hasBudget ? money(month.monthLeft) : '—';
    $('trash-count').textContent = trashData.length ? `(${trashData.length})` : ''; $('trash-count').classList.toggle('hidden', !trashData.length);
    $('hide-btn').setAttribute('aria-pressed', String(Boolean(settings.hideAmounts)));
    $('hide-btn').setAttribute('aria-label', settings.hideAmounts ? 'Show amounts' : 'Hide amounts'); }

  // Every screen is redrawn from the saved data after any change. One screen failing to draw never stops the others, so a
  // change made in one place (an edited category, say) always shows up everywhere else.
  function render() {
    for (const draw of [renderToday, renderSettle, renderGoals, renderTrash, renderHistory, renderBills, renderOwed, renderAccounts, renderRecurring, renderCashPrompt, renderRecap, renderCash, renderRecent, renderMore]) {
      try { draw(); } catch (error) { console.error(draw.name, error); }
    }
  }

  // ---------- navigation ----------
  let firstRoute = true;
  function route() {
    const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
    VIEWS.forEach(v => $(`view-${v}`).classList.toggle('hidden', v !== name));
    document.querySelectorAll('.tabbar a').forEach(a => { if (a.dataset.tab === (name === 'newgoal' ? 'goals' : SUBVIEWS.includes(name) ? 'more' : name)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (!firstRoute) render();   // a screen always opens with the latest figures
    window.scrollTo(0, 0);
    if (!firstRoute) $(`h-${name}`).focus({ preventScroll: true });
    firstRoute = false;
  }
  window.addEventListener('hashchange', route);
  // The phone's Back button asks here first: close an open sheet, go from a sub-screen back to More and from any other
  // tab back to Today. On Today it answers false and the app steps back to the home screen.
  window.pocketBack = () => {
    const open = [...document.querySelectorAll('dialog[open]')].pop();
    if (open) { open.close(); return true; }
    if (document.documentElement.hasAttribute('data-locked')) return false;
    if (location.hash === '#newgoal') { location.hash = '#goals'; return true; }   // Back from the new-goal page returns to the goals
    const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
    if (name === 'today' && settings.todayMode === 'period') {
      // Specific period: Back closes the plan form (New plan, Edit plan) and shows the plan again instead of leaving the app.
      // With no plan to go back to, it returns to Monthly.
      if (planFormOpen && plansList().length) { planFormOpen = false; planEditId = ''; $('plan-error').textContent = ''; renderPlan(); return true; }
      if (!plansList().length) { planFormOpen = false; planEditId = ''; settings = { ...settings, todayMode: 'month' }; commit(); return true; }
    }
    if (name === 'today') return false;
    location.hash = SUBVIEWS.includes(name) ? '#more' : '#today';
    return true;
  };

  // ---------- Today: add an expense by typing it ----------
  // "chai 20 today", "auto 80 yesterday", "movie 300 on 12 oct": amount, what it was, and when. English or Hinglish.
  const lastMonthDate = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `12 ${d.toLocaleDateString('en-IN', { month: 'short' }).toLowerCase()}`; })();
  const EXAMPLES = [`movie 300 on ${lastMonthDate}`];
  $('type-examples').innerHTML = EXAMPLES.map(text => `<button class="chip-btn" type="button" data-example="${esc(text)}">${esc(text)}</button>`).join('');
  // "chai 20 cash": the word cash marks it as paid in cash and is not part of the name.
  const splitCash = text => (/\bcash\b/i.test(text) ? { text: text.replace(/\bcash\b/ig, ' ').replace(/\s+/g, ' ').trim(), cash: true } : { text, cash: false });
  const previewTyped = () => {
    const text = $('type-input').value.trim();
    if (!text) { $('type-preview').textContent = ''; $('type-preview').classList.remove('bad'); return; }
    const r = U.parseNaturalExpense(splitCash(text).text);
    $('type-preview').classList.toggle('bad', !r.ok);
    $('type-preview').textContent = r.ok ? `${r.expense.description} · ${money(r.expense.amount)} · ${dayLabel(r.expense.date)}` : r.error;
  };
  $('type-input').addEventListener('input', previewTyped);
  // Whatever you type, Penny asks which category it is before it saves, then adds it.
  let catDraft = null;
  function askCategory(expense, cash, done) {
    catDraft = { expense, cash, done };
    $('cat-line').textContent = `${expense.description} · ${money(expense.amount)} · ${dayLabel(expense.date)}`;
    $('cat-options').innerHTML = U.CATEGORIES.map(c => `<button class="chip-btn pick${c === expense.category ? ' guess' : ''}" type="button" data-category="${esc(c)}">${esc(c)}</button>`).join('');
    $('cat-dialog').showModal();
  }
  $('cat-options').addEventListener('click', event => {
    const pick = event.target.closest('[data-category]');
    if (!pick || !catDraft) return;
    const draft = catDraft; catDraft = null; $('cat-dialog').close();
    state.expenses.push({ id: newId(), ...draft.expense, category: pick.dataset.category, ...(draft.cash ? { cash: true } : {}), createdAt: Date.now() });
    draft.done(); commit(); showToast(`Added ${money(draft.expense.amount)} to ${pick.dataset.category}`);
  });
  $('cat-close').addEventListener('click', () => { catDraft = null; $('cat-dialog').close(); });
  function typedSubmit(input, preview) {
    const cashed = splitCash(input.value), r = U.parseNaturalExpense(cashed.text);
    if (!r.ok) { preview.classList.add('bad'); preview.textContent = r.error; return; }
    askCategory(r.expense, cashed.cash, () => { input.value = ''; preview.textContent = ''; preview.classList.remove('bad'); });
  }
  $('tx-input').addEventListener('input', () => {
    const text = $('tx-input').value.trim();
    if (!text) { $('tx-preview').textContent = ''; $('tx-preview').classList.remove('bad'); return; }
    const r = U.parseNaturalExpense(splitCash(text).text);
    $('tx-preview').classList.toggle('bad', !r.ok);
    $('tx-preview').textContent = r.ok ? `${r.expense.description} · ${money(r.expense.amount)} · ${dayLabel(r.expense.date)}` : r.error;
  });
  $('tx-form').addEventListener('submit', event => { event.preventDefault(); typedSubmit($('tx-input'), $('tx-preview')); });
  $('voice-btn').addEventListener('click', async () => {
    try { LockUI.hold(); const heard = await Xb.listenVoice(); $('line-input').value = String((heard && heard.text) || ''); kpParse(); }
    catch (error) {
      const why = String((error && error.message) || error || '');
      if (why !== 'cancelled') showToast(why === 'unavailable' ? 'Voice typing is not available on this phone' : 'I could not hear that. Try again.');
    }
  });
  $('type-examples').addEventListener('click', event => {
    const chip = event.target.closest('[data-example]');
    if (!chip) return;
    $('type-input').value = chip.dataset.example; previewTyped(); $('type-input').focus();
  });
  $('type-form').addEventListener('submit', event => {
    event.preventDefault();
    typedSubmit($('type-input'), $('type-preview'));
  });
  // ---------- Add: one line first ----------
  // Type it like "chai 20", "auto 80 yesterday" or "movie 300 cash". Penny spots the amount, the category and the day; the
  // category buttons and the day buttons are there to change what it guessed. The Add button stays above the keyboard.
  const kp = { amount: 0, note: '', parsedDate: '', category: '', picked: false, dateChip: '', cashTouched: null, typedCash: false, error: '', hasText: false, goalMode: false, goalId: '', goalPicked: '', aside: null };
  const kpReset = () => { Object.assign(kp, { amount: 0, note: '', parsedDate: '', category: '', picked: false, dateChip: '', cashTouched: null, typedCash: false, error: '', hasText: false, goalMode: false, goalId: '', goalPicked: '', aside: null }); };
  const kpCash = () => (kp.cashTouched === null ? kp.typedCash : kp.cashTouched);
  const kpDate = () => (kp.dateChip === 'yesterday' ? U.addDays(today(), -1) : kp.dateChip === 'pick' ? ($('kp-date').value || today()) : kp.dateChip === 'today' ? today() : (kp.parsedDate || today()));
  const kpName = c => (c === 'Entertainment' ? 'Fun' : c === 'Education' ? 'Study' : c);
  function kpParse() {
    const text = $('line-input').value.trim(), cashed = splitCash(text);
    // "set aside 20 for phone": money for a goal, not an expense
    const aside = text ? G.parseSetAside(text, state.plans) : null;
    kp.aside = aside; kp.goalMode = Boolean(aside);
    if (aside) {
      Object.assign(kp, { hasText: true, amount: aside.amount, note: '', parsedDate: '', error: '', typedCash: false, goalId: aside.ok ? aside.goal.id : (kp.goalPicked && state.plans.some(p => p.id === kp.goalPicked) ? kp.goalPicked : '') });
      $('kp-error').textContent = ''; kpShow(); return;
    }
    kp.goalPicked = ''; kp.goalId = '';
    const r = text ? U.parseNaturalExpense(cashed.text) : null;
    kp.hasText = Boolean(text); kp.typedCash = cashed.cash; kp.error = r && !r.ok ? r.error : '';
    if (r && r.ok) {
      kp.amount = r.expense.amount; kp.note = r.expense.description; kp.parsedDate = r.expense.date;
      if (!kp.picked) kp.category = r.expense.category && r.expense.category !== 'Other' ? r.expense.category : '';   // a category you tapped is never changed by what you type
    } else { kp.amount = 0; kp.note = ''; kp.parsedDate = ''; if (!kp.picked) kp.category = ''; }
    $('kp-error').textContent = ''; kpShow();
  }
  function kpShow() {
    const when = kpDate(), spot = $('line-spot'), yesterday = U.addDays(today(), -1);
    const goal = kp.goalMode ? state.plans.find(p => p.id === kp.goalId) : null;
    spot.classList.toggle('bad', Boolean(kp.error) || (kp.goalMode && !goal && kp.aside && kp.aside.reason === 'none'));
    spot.classList.toggle('idle', !kp.hasText);
    $('kp-cats').classList.toggle('hidden', kp.goalMode); $('kp-cash').classList.toggle('hidden', kp.goalMode);
    const choices = kp.goalMode && state.plans.length > 1 ? state.plans : [];
    $('kp-goals').classList.toggle('hidden', !choices.length);
    $('kp-goals').innerHTML = choices.map(p => `<button class="chip-btn${p.id === kp.goalId ? ' on' : ''}" type="button" data-kpgoal="${esc(p.id)}">${esc(p.title)}</button>`).join('');
    if (kp.goalMode) {
      if (goal) spot.innerHTML = `<span><strong>${esc(money(kp.amount))}</strong> · Set aside for ${esc(goal.title)}</span><span>${esc(dayLabel(when))}</span>`;
      else if (kp.aside && kp.aside.reason === 'none') spot.textContent = 'You have no goals yet. Make one in Savings first.';
      else spot.textContent = `Which goal is the ${money(kp.amount)} for? Tap one below.`;
    }
    else if (!kp.hasText) spot.textContent = 'Type it like chai 20, auto 80 yesterday or movie 300 cash. Or set aside 20 for a goal.';
    else if (kp.error) spot.textContent = kp.error;
    else spot.innerHTML = `<span><strong>${esc(money(kp.amount))}</strong> · ${kp.category ? esc(kpName(kp.category)) : 'Pick a category'}${kpCash() ? ' · Cash' : ''}</span><span>${esc(dayLabel(when))}</span>`;
    $('kp-add').textContent = kp.amount > 0 ? (kp.goalMode ? (goal ? `Set aside ${money(kp.amount)}` : 'Add') : `Add ${money(kp.amount)}`) : 'Add';
    $('kp-cats').querySelectorAll('[data-kpcat]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kpcat === kp.category)));
    const other = (when !== today() && when !== yesterday) || kp.dateChip === 'pick';
    document.querySelectorAll('[data-kpdate]').forEach(b => b.classList.toggle('on', (b.dataset.kpdate === '0' && when === today() && kp.dateChip !== 'pick') || (b.dataset.kpdate === '-1' && when === yesterday && kp.dateChip !== 'pick') || (b.dataset.kpdate === 'pick' && other)));
    $('kp-date').classList.toggle('hidden', !other);
    if (other && document.activeElement !== $('kp-date')) $('kp-date').value = when;
    $('kp-cash').setAttribute('aria-pressed', String(kpCash()));
  }
  $('kp-cats').innerHTML = U.CATEGORIES.map(c => `<button class="cat-btn" type="button" data-kpcat="${esc(c)}" aria-pressed="false"><span class="cat-ic">${meta(c)[0]}</span><span>${esc(kpName(c))}</span></button>`).join('');
  $('line-input').addEventListener('input', kpParse);
  $('line-form').addEventListener('submit', event => { event.preventDefault(); $('kp-add').click(); });
  $('kp-goals').addEventListener('click', event => {
    const b = event.target.closest('[data-kpgoal]');
    if (!b) return;
    kp.goalPicked = b.dataset.kpgoal; kp.goalId = kp.goalPicked; $('kp-error').textContent = ''; kpShow();
  });
  $('kp-cats').addEventListener('click', event => {
    const b = event.target.closest('[data-kpcat]');
    if (!b) return;
    kp.category = b.dataset.kpcat; kp.picked = true; $('kp-error').textContent = ''; kpShow();
  });
  document.querySelector('.kp-chips').addEventListener('click', event => {
    const d = event.target.closest('[data-kpdate]');
    if (d) { kp.dateChip = d.dataset.kpdate === '0' ? 'today' : d.dataset.kpdate === '-1' ? 'yesterday' : 'pick'; if (kp.dateChip === 'pick') $('kp-date').value = kpDate(); kpShow(); return; }
    if (event.target.closest('#kp-cash')) { kp.cashTouched = !kpCash(); kpShow(); }
  });
  $('kp-date').addEventListener('input', () => { kp.dateChip = 'pick'; kpShow(); });
  $('kp-add').addEventListener('click', () => {
    if (kp.goalMode) {   // money set aside for a goal: it comes out of the day's limit and shows everywhere
      if (!(kp.amount > 0)) { $('kp-error').textContent = 'Type how much to set aside.'; return; }
      if (!kp.goalId) { $('kp-error').textContent = kp.aside && kp.aside.reason === 'none' ? 'Make a goal in Savings first.' : 'Tap the goal it is for.'; return; }
      const result = G.addToGoal(state.plans, kp.goalId, kp.amount, kpDate());
      if (!result.ok) { $('kp-error').textContent = result.error; return; }
      const before = state.plans, saidAmount = result.contribution.amount, saidGoal = result.plan.title;
      state.plans = result.plans; kpReset(); $('line-input').value = ''; $('kp-error').textContent = '';
      kpShow(); commit();
      showToast(`Set aside ${money(saidAmount)} for ${saidGoal}`, { label: 'Undo', run: () => { state.plans = before; commit(); } });
      return;
    }
    if (!(kp.amount > 0)) { $('kp-error').textContent = 'Type what you spent first, like chai 20.'; return; }
    if (!kp.category) { $('kp-error').textContent = 'Pick a category.'; return; }
    const date = kpDate();
    if (!U.isValidDate(date)) { $('kp-error').textContent = 'Pick a date.'; return; }
    const amount = U.round2(kp.amount), cash = kpCash();
    // A bank message keeps the category it arrived with ("Other" when Penny could not tell) until you change it yourself. So a typed
    // expense never edits it; if it looks like the same payment, Penny only offers to merge the two after adding yours.
    const twin = cash ? null : state.expenses.find(e => e.source === 'sms' && !e.edited && !e.cashIn && e.date === date && Math.abs(Number(e.amount) - amount) < 0.005);
    state.expenses.push({ id: newId(), amount, description: (kp.note || kp.category).slice(0, 100), category: kp.category, date, ...(cash ? { cash: true } : {}), createdAt: Date.now() });
    const label = `${money(amount)} to ${kp.category}`, typedId = state.expenses[state.expenses.length - 1].id, typedCategory = kp.category, typedNote = kp.note;
    Object.assign(kp, { amount: 0, note: '', parsedDate: '', category: '', picked: false, dateChip: '', cashTouched: null, typedCash: false, error: '', hasText: false });
    $('line-input').value = ''; $('kp-error').textContent = '';
    kpShow(); commit();
    if (twin) {
      showToast(`Added ${label}. Same as the bank payment?`, { label: 'Merge', run: () => {
        state.expenses = state.expenses.filter(e => e.id !== typedId).map(e => (e.id === twin.id ? { ...e, category: typedCategory, description: (typedNote || e.description).slice(0, 100), edited: true } : e));
        commit(); showToast(`Merged into the bank payment as ${typedCategory}`);
      } });
    } else showToast(`Added ${label}`);
  });
  kpShow();

  // What was added last, so a slip can be fixed right where you typed it.
  function renderRecent() {
    const latest = state.expenses.filter(e => !e.cashIn).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);
    $('recent-list').innerHTML = latest.length ? latest.map(expenseRow).join('') : '<div class="empty">Nothing added yet</div>';
  }
  // ---------- editing and removing expenses ----------
  // Removing an expense that paid a bill also marks that bill unpaid again; Undo restores both.
  function removeExpense(id) {
    const gone = state.expenses.find(e => e.id === id);
    if (!gone) return;
    const before = { expenses: state.expenses, billData };
    state.expenses = state.expenses.filter(e => e.id !== id);
    if (gone.billKey) billData = { ...billData, paid: Bi.unmarkPaid(billData.paid, gone.billKey) };
    commit();
    showToast('Expense deleted', { label: 'Undo', run: () => { state.expenses = before.expenses; billData = before.billData; commit(); } });
  }

  const editDialog = $('edit-dialog');
  let editingId = null;
  $('edit-category').innerHTML = categoryOptions('Other');
  function openEdit(id) {
    const e = state.expenses.find(x => x.id === id);
    if (!e) return;
    editingId = id;
    $('edit-desc').value = e.description; $('edit-amount').value = e.amount; $('edit-date').value = e.date; $('edit-category').value = e.category;
    fillEditPot(e);
    $('edit-cash').checked = Boolean(e.cash);
    const owed = O.owedTotalFor(id, owedData.debts);
    $('edit-split').textContent = owed ? 'Add more people' : 'Split with others';
    $('edit-error').textContent = '';
    editDialog.showModal();   // no focus: the keyboard would cover everything under the amount
  }
  // "Budget": Auto follows the category and shop names, Daily needs keeps it out of every budget, or pick one.
  function fillEditPot(e) {
    const pots = potsData.pots;
    $('edit-pot-field').classList.toggle('hidden', !pots.length);
    $('edit-pot').innerHTML = `<option value="">Auto</option><option value="none">Daily needs</option>${pots.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
    $('edit-pot').value = e.potId && (e.potId === 'none' || pots.some(p => p.id === e.potId)) ? e.potId : '';
  }
  function withPot(expenses, id, value) {
    if (!potsData.pots.length) return expenses;
    return expenses.map(e => { if (e.id !== id) return e; const { potId, ...rest } = e; return value ? { ...rest, potId: value } : rest; });
  }
  $('edit-close').addEventListener('click', () => editDialog.close());
  $('edit-delete').addEventListener('click', () => { const id = editingId; editDialog.close(); removeExpense(id); });
  $('edit-split').addEventListener('click', () => { const id = editingId; editDialog.close(); openSplit(id); });
  $('edit-form').addEventListener('submit', event => {
    event.preventDefault();
    const owedHere = O.owedTotalFor(editingId, owedData.debts);
    if (owedHere > 0 && Number($('edit-amount').value) < owedHere) { $('edit-error').textContent = `Others owe you ${money(owedHere)} for this, so the amount cannot be less than that.`; return; }
    const result = Ex.editExpense(state.expenses, editingId, { description: $('edit-desc').value, amount: $('edit-amount').value, date: $('edit-date').value, category: $('edit-category').value });
    if (!result.ok) { $('edit-error').textContent = result.error; return; }
    state.expenses = withPot(result.expenses, editingId, $('edit-pot').value).map(e => { if (e.id !== editingId) return e; const { cash, ...rest } = e; return $('edit-cash').checked ? { ...rest, cash: true } : rest; });
    editDialog.close(); commit(); showToast('Saved');
  });
  // The same row actions work in Today's recent list and in History.
  function wireExpenseList(host) {
    host.addEventListener('click', event => {
      const del = event.target.closest('[data-delete-expense]');
      if (del) { removeExpense(del.dataset.deleteExpense); return; }
      const tap = event.target.closest('[data-edit]');
      if (tap) openEdit(tap.dataset.edit);
    });
    host.addEventListener('keydown', event => {
      const tap = event.target.closest('[data-edit]');
      if (tap && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openEdit(tap.dataset.edit); }
    });
  }
  wireExpenseList($('hist-list'));
  wireExpenseList($('recent-list'));

  // ---------- History and insights ----------
  let historyOffset = 0, historyCategory = '';   // a category chosen in the breakdown shows only its expenses   // 0 = the current period, -1 = the one before, and so on
  function historyCycle() {
    let cycle = cycleNow();
    for (let i = 0; i < -historyOffset; i++) cycle = Ins.shiftCycle(cycle, settings, -1);
    return cycle;
  }
  const shortDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  function renderHistory() {
    const cycle = historyCycle();
    const monthly = cycle.mode === 'month' || cycle.paydayDay === 1;
    const s = Ins.summarize(spendingList(), cycle, settings, today());
    $('hist-title').textContent = monthly ? new Date(`${cycle.start}T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : `${shortDay(cycle.start)} – ${shortDay(cycle.end)}`;
    $('hist-sub').textContent = historyOffset === 0 ? (monthly ? 'This month, so far' : 'This pay cycle, so far') : monthly ? '' : `${cycle.days} days`;
    const earliest = state.expenses.reduce((min, e) => (e.date && (!min || e.date < min) ? e.date : min), '');
    $('hist-prev').disabled = !earliest || cycle.start <= earliest || historyOffset <= -60;
    $('hist-next').disabled = historyOffset >= 0;

    const cmp = s.comparison;
    const cmpText = cmp.change === null ? '' : cmp.change === 0 ? `The same as ${cmp.basis === 'same-point' ? 'the previous period at this point' : 'the previous period'}.`
      : `<span class="cmp ${cmp.change > 0 ? 'up' : 'down'}">${cmp.change > 0 ? '↑' : '↓'} ${Math.abs(cmp.change)}% ${cmp.change > 0 ? 'more' : 'less'}</span> than ${cmp.basis === 'same-point' ? 'the previous period at this point' : 'the previous period'} (${money(cmp.previousTotal)}).`;
    const dueNow = historyOffset === 0 ? billRows().filter(row => row.state !== 'paid') : [];
    $('hist-bills').classList.toggle('hidden', !dueNow.length);
    $('hist-bills').innerHTML = dueNow.length ? `<h2>Bills due</h2><div class="list">${dueNow.map(row => `<div class="row"><div class="sym" style="background:#f1edfa" aria-hidden="true">${ICON.Bills}</div>
      <div><div class="row-title">${esc(row.title)}</div><div class="row-meta ${row.state === 'overdue' ? 'neg' : ''}">${esc(dueText(row))}</div></div><div class="row-amount">${money(row.amount)}</div><button class="icon-btn" type="button" data-delete-bill="${esc(row.billId)}" aria-label="Delete ${esc(row.title)}"><span class="ico ico-x" aria-hidden="true"></span></button></div>`).join('')}</div>
      <a class="text-link" href="#bills">Bills and payday →</a>` : '';
    $('hist-summary').innerHTML = s.count
      ? `<div class="hist-total"><span>Spent</span><strong>${money(s.total)}</strong></div>
         <p>${s.count} expense${s.count === 1 ? '' : 's'} · about ${money(Math.round(s.dailyAverage))} a day</p>
         ${cmpText ? `<p>${cmpText}</p>` : ''}
         <p>Biggest: <strong>${money(U.spendOf(s.biggest))}</strong> on ${esc(s.biggest.description)} (${shortDay(s.biggest.date)})</p>`
      : `<div class="hist-total"><span>Spent</span><strong>${money(0)}</strong></div><p class="muted">Nothing recorded in this period.</p>${cmpText ? `<p>${cmpText}</p>` : ''}`;

    $('hist-cats').innerHTML = s.byCategory.length ? s.byCategory.map(c => {
      const m = meta(c.category);
      return `<button class="cat-row${historyCategory === c.category ? ' on' : ''}" type="button" data-hist-cat="${esc(c.category)}" aria-pressed="${historyCategory === c.category}"><div class="sym" style="background:${m[1]}" aria-hidden="true">${m[0]}</div>
        <div><span class="cat-name">${esc(c.category)}</span> <span class="cat-pct">${c.pct}%</span></div><div class="cat-amount">${money(c.amount)}</div>
        <div class="cat-bar" role="presentation"><i style="width:${Math.max(2, c.pct)}%"></i></div></button>`;
    }).join('') : '<div class="empty">Your spending will be broken down by category here.</div>';

    if (historyCategory && !s.byCategory.some(c => c.category === historyCategory)) historyCategory = '';
    $('hist-list-title').innerHTML = historyCategory ? `${esc(historyCategory)} <button class="text-link" type="button" data-hist-cat="">Show all</button>` : 'Expenses';
    $('hist-list-card').classList.toggle('hidden', !historyCategory);   // the expenses show once a category is tapped
    const shown = Ex.searchExpenses(s.items, $('hist-search').value).filter(e => !historyCategory || e.category === historyCategory).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    $('hist-list').innerHTML = shown.length
      ? shown.slice(0, 200).map(expenseRow).join('') + (shown.length > 200 ? `<div class="empty">Showing the latest 200 of ${shown.length}. Search to narrow it down.</div>` : '')
      : `<div class="empty">${$('hist-search').value.trim() ? 'Nothing matches that search.' : 'No expenses in this period.'}</div>`;
  }
  $('view-history').addEventListener('click', event => {
    const pick = event.target.closest('[data-hist-cat]');
    if (!pick) return;
    historyCategory = historyCategory === pick.dataset.histCat ? '' : pick.dataset.histCat;
    renderHistory();
  });
  $('hist-prev').addEventListener('click', () => { historyOffset -= 1; renderHistory(); });
  $('hist-next').addEventListener('click', () => { if (historyOffset < 0) { historyOffset += 1; renderHistory(); } });
  $('hist-search').addEventListener('input', renderHistory);

  // ---------- Today: can I afford this? ----------
  const affordDialog = $('afford-dialog');
  // A negative "left" is shown as an overshoot; positive amounts are rounded down like everywhere else.
  const leftText = value => (value < 0 ? `−${money(Math.ceil(-value))}` : rupees(value));
  const daysText = value => (Math.round(value * 10) / 10).toString();
  let affordCheck = null;

  function renderAfford() {
    const box = $('afford-result');
    affordCheck = null;
    $('afford-add').disabled = true;
    if (!$('afford-price').value) { box.innerHTML = ''; return; }
    const r = A.checkAffordability({ price: $('afford-price').value, today: today(), budget: dailyBudget(), monthlyFunds: state.budget > 0 ? state.monthlyFunds : [], expenses: budgetExpenses(), plans: state.plans, settings, bills: billData.bills, paid: billData.paid });
    if (!r.ok) { box.innerHTML = `<div class="verdict idle"><span>${esc(r.error)}</span></div>`; return; }
    affordCheck = r;
    $('afford-add').disabled = false;
    setTimeout(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
    if (r.verdict === 'no-budget') {
      box.innerHTML = '<div class="verdict idle"><strong>Set a monthly budget first</strong><span>Penny needs your budget to say whether this fits. You can still record it if you bought it.</span></div>';
      return;
    }
    const verdicts = {
      'fits-today': ['good', 'Yes, it fits today', `You’d still have ${leftText(r.today.after)} left today.`],
      'fits-month': ['warn', 'Over today’s amount, but this month covers it', `Today you’d be ${leftText(r.today.after).replace('−', '')} over.${r.tomorrow ? ` Tomorrow’s amount would drop from ${rupees(r.tomorrow.before)} to ${rupees(r.tomorrow.after)}.` : ''}`],
      'over-month': ['bad', 'That’s more than your budget has left', `You’d be ${money(Math.ceil(r.month.overBy))} over this month’s budget.`],
    };
    const v = verdicts[r.verdict];
    const row = (label, before, after) => `<dt>${label}</dt><dd class="${after < 0 ? 'neg' : ''}">${leftText(before)}<i>→</i>${leftText(after)}</dd>`;
    box.innerHTML = `<div class="verdict ${v[0]}"><strong>${v[1]}</strong><span>${esc(v[2])}</span></div>
      <dl class="compare">${row('Left today', r.today.before, r.today.after)}${row('Left this month', r.month.before, r.month.after)}${r.tomorrow ? row('Tomorrow’s amount', r.tomorrow.before, r.tomorrow.after) : ''}</dl>
      ${r.daysOfSpending ? `<p class="afford-note">That’s about ${daysText(r.daysOfSpending)} day${r.daysOfSpending === 1 ? '' : 's'} of your daily spending money.</p>` : ''}
      ${r.goals.length ? `<ul class="afford-goals">${r.goals.map(g => `<li>About ${daysText(g.days)} day${g.days === 1 ? '' : 's'} of saving for <strong>${esc(g.title)}</strong></li>`).join('')}</ul>` : ''}
      <p class="afford-note">Money you’ve set aside for goals is already left out of these numbers.</p>`;
  }
  $('afford-open').addEventListener('click', () => { $('afford-price').value = ''; $('afford-label').value = ''; renderAfford(); affordDialog.showModal(); });
  $('afford-close').addEventListener('click', () => affordDialog.close());
  $('afford-done').addEventListener('click', () => affordDialog.close());
  $('afford-price').addEventListener('input', renderAfford);
  $('afford-add').addEventListener('click', () => {
    if (!affordCheck) return;
    const label = $('afford-label').value.trim().slice(0, 100);
    state.expenses.push({ id: newId(), amount: affordCheck.price, description: label || 'Purchase', category: U.detectCategory(label), date: today(), createdAt: Date.now() });
    affordDialog.close(); commit(); showToast(`Added ${money(affordCheck.price)} to today’s spending`);
  });

  // ---------- Bills & payday ----------
  const ordinal = n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
  function dueText(row) {
    if (row.state === 'paid') return `Paid ${dayLabel(row.paidOn)}`;
    if (row.state === 'overdue') return `Overdue, was due ${dayLabel(row.date)}`;
    return row.state === 'today' ? 'Due today' : `Due ${dayLabel(row.date)}`;
  }

  function renderBillsCard() {
    const card = $('bills-card');
    const open = billRows().filter(row => row.state !== 'paid');
    if (!open.length) { card.classList.add('hidden'); return; }
    const total = open.reduce((sum, row) => sum + row.amount, 0);
    card.classList.remove('hidden');
    card.innerHTML = `<div class="period-top"><h2>Coming up</h2><span>${money(total)} set aside</span></div>
      <div class="list">${open.slice(0, 3).map(row => `<div class="row"><div class="sym" style="background:#f1edfa" aria-hidden="true">${ICON.Bills}</div>
        <div><div class="row-title">${esc(row.title)}</div><div class="row-meta ${row.state === 'overdue' ? 'neg' : ''}">${esc(dueText(row))}</div></div>
        <div class="row-amount">${money(row.amount)}</div><span></span></div>`).join('')}</div>
      <a class="text-link" href="#bills">${open.length > 3 ? `${open.length - 3} more · ` : ''}All bills →</a>`;
  }

  function renderBills() {
    const cycle = cycleNow();
    const form = $('cycle-form');
    form.elements['cycle-mode'].forEach(radio => { radio.checked = radio.value === (settings.mode === 'payday' ? 'payday' : 'month'); });
    $('payday-field').classList.toggle('hidden', settings.mode !== 'payday');
    if (document.activeElement !== $('payday-day')) $('payday-day').value = settings.mode === 'payday' ? settings.paydayDay : '';

    const rows = billRows();
    $('bill-rows').innerHTML = rows.length ? rows.map(row => `<div class="row"><div class="sym" style="background:#f1edfa" aria-hidden="true">${ICON.Bills}</div>
        <div><div class="row-title">${esc(row.title)}</div><div class="row-meta ${row.state === 'overdue' ? 'neg' : ''}">${esc(dueText(row))}</div></div>
        <div class="row-amount">${money(row.amount)}</div>
        ${row.state !== 'paid' ? `<button class="btn small" type="button" data-bill-act="mark" data-key="${esc(row.key)}">Mark paid</button>`
          : billData.paid[row.key] ? `<button class="btn small" type="button" data-bill-act="unmark" data-key="${esc(row.key)}">Undo</button>` : '<span class="chip good">Paid</span>'}</div>`).join('')
      : '<div class="empty">No bills this period</div>';

    $('bill-list').innerHTML = billData.bills.length ? billData.bills.map(bill => {
      const when = bill.repeat === 'monthly' ? `every month on the ${ordinal(Number(bill.dueDate.slice(8, 10)))}` : `once, on ${longDate(bill.dueDate)}`;
      return `<div class="row"><div class="sym" style="background:#f1edfa" aria-hidden="true">${ICON.Bills}</div>
        <div><div class="row-title">${esc(bill.title)}${bill.source === 'sms' ? ' <span class="pill">From a message</span>' : ''}</div><div class="row-meta">${money(bill.amount)} · ${esc(when)}</div></div><span></span>
        <button class="icon-btn" type="button" data-delete-bill="${esc(bill.id)}" aria-label="Delete ${esc(bill.title)}"><span class="ico ico-x" aria-hidden="true"></span></button></div>`;
    }).join('') : '<div class="empty">No bills yet</div>';
  }

  $('bill-date').value = today();
  $('cycle-form').addEventListener('change', () => {
    const mode = $('cycle-form').elements['cycle-mode'].value === 'payday' ? 'payday' : 'month';
    const day = Math.round(Number($('payday-day').value));
    if (mode === 'payday') {
      $('payday-field').classList.remove('hidden');
      if (!(day >= 1 && day <= 31)) { if (!$('payday-day').value) $('payday-day').focus(); else showToast('Enter a day from 1 to 31'); return; }
    }
    settings = { ...settings, mode, paydayDay: mode === 'payday' ? day : settings.paydayDay };
    commit(); showToast(mode === 'payday' ? `Your budget now starts on day ${day}` : 'Your budget now follows the calendar month');
  });
  $('bill-form').addEventListener('submit', event => {
    event.preventDefault();
    const result = Bi.createBill({ title: $('bill-title').value, amount: $('bill-amount').value, dueDate: $('bill-date').value, repeat: $('bill-repeat').value });
    if (!result.ok) { $('bill-error').textContent = result.error; return; }
    $('bill-error').textContent = '';
    billData = { ...billData, bills: [...billData.bills, result.bill] };
    $('bill-form').reset(); $('bill-date').value = today(); $('bill-form').classList.add('hidden'); $('bill-add-toggle').setAttribute('aria-expanded', 'false');
    commit(); showToast(`${result.bill.title} added`);
  });
  $('bill-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-bill-act]');
    if (!button) return;
    const key = button.dataset.key;
    // Marking a bill paid also records the payment as an expense, so the money you spent really leaves your budget.
    // Without that, ticking the box would hand the bill's money back to today's amount.
    const undoPaid = () => {
      state.expenses = state.expenses.filter(e => e.billKey !== key);
      billData = { ...billData, paid: Bi.unmarkPaid(billData.paid, key) };
      commit();
    };
    if (button.dataset.billAct === 'mark') {
      const row = billRows().find(r => r.key === key);
      if (!row) return;
      state.expenses = [...state.expenses, { id: newId(), amount: row.amount, description: row.title, category: 'Bills', date: today(), createdAt: Date.now(), billKey: key }];
      billData = { ...billData, paid: Bi.markPaid(billData.paid, key, today()) };
      commit();
      showToast(`${row.title} marked paid and recorded`, { label: 'Undo', run: undoPaid });
    } else undoPaid();
  });
  // A bill can be deleted wherever it is listed: Bills and payday, the Monthly budget sheet, Transactions. The money set aside for it
  // goes straight back into the monthly budget and the daily limit, and Undo puts it back.
  function deleteBillFrom(event) {
    const button = event.target.closest('[data-delete-bill]');
    if (!button) return;
    const before = billData;
    const bill = before.bills.find(b => b.id === button.dataset.deleteBill);
    if (!bill) return;
    billData = Bi.deleteBill(before, bill.id);
    commit();
    if ($('budget-dialog').open) renderBudgetLines();
    showToast(`${bill.title} deleted`, { label: 'Undo', run: () => { billData = before; commit(); if ($('budget-dialog').open) renderBudgetLines(); } });
  }
  for (const id of ['bill-list', 'bill-lines-list', 'hist-bills']) $(id).addEventListener('click', deleteBillFrom);

  // ---------- Account balances ----------
  // Unpaid bills that have to come out of the bank soon: the rest of this period, and at least the next week.
  function dueBills() {
    const cycle = cycleNow(), horizon = U.addDays(today(), 7);
    return Bi.billOccurrences({ bills: billData.bills, paid: billData.paid, expenses: state.expenses, start: cycle.start, end: horizon > cycle.end ? horizon : cycle.end, today: today() }).filter(row => row.state !== 'paid');
  }
  const balanceOutlook = () => Ac.outlook(accountData, dueBills(), { threshold: 0, today: today(), expenses: state.expenses });
  let openAcct = null;
  function accountCard(a, i) {
    const open = openAcct === a.key, stale = a.asOf && U.daysBetween(a.asOf, today()) > Ac.STALE_DAYS;
    const head = `<button class="acct-head" type="button" data-acct-toggle="${esc(a.key)}" aria-expanded="${open}"><span class="acct-name">${esc(a.name)}</span><span class="acct-amount">${bank(a.probable)}</span><span class="ico ico-right" aria-hidden="true"></span></button>`;
    const form = open ? `<form class="acct-form" data-acct-form data-key="${esc(a.key)}">
      <p class="hint">${a.estimated ? `Probably, after ${bank(a.spentSince)} spent since the last balance of ${bank(a.balance)} on ${esc(shortDay(a.asOf))}.` : `${stale ? 'Last known' : 'As of'} ${esc(shortDay(a.asOf))}.`}</p>
      <div class="two"><div class="field"><label for="an-${i}">Name</label><input id="an-${i}" name="name" maxlength="40" value="${esc(a.name)}" /></div>
        <div class="field"><label for="ab-${i}">Balance (₹)</label><input id="ab-${i}" name="balance" type="number" inputmode="decimal" min="0" step="0.01" value="${a.balance}" required /></div></div>
      <label class="choice-row"><input type="checkbox" name="include"${a.include !== false ? ' checked' : ''} /> <span>Bills are paid from this account</span></label>
      <p class="form-note error" data-error role="alert"></p>
      <div class="row-actions"><button class="btn danger" type="button" data-acct-act="remove">Remove</button><button class="btn primary" type="submit">Save</button></div></form>` : '';
    return `<div class="acct${open ? ' open' : ''}">${head}${form}</div>`;
  }
  function renderAccounts() {
    const o = balanceOutlook();
    $('acct-summary').innerHTML = o.status === 'none'
      ? '<span>In the bank</span><strong>—</strong>'
      : `<span>In the accounts bills are paid from</span><strong>${bank(o.total)}</strong><p class="muted">${o.count ? `${bank(o.bills)} of bills due by ${shortDay(o.lastDue)}, so ${settings.hideAmounts ? '₹ ••••' : leftText(o.after)} would be left.` : 'No bills coming up.'}${o.stale ? ' This was last read a few days ago, so it may be out of date.' : ''}</p>`;
    $('acct-list').innerHTML = Ac.withEstimates(accountData, state.expenses).map(accountCard).join('');
  }
  $('acct-list').addEventListener('submit', event => {
    const form = event.target.closest('[data-acct-form]');
    if (!form) return;
    event.preventDefault();
    const result = Ac.saveAccount(accountData, { key: form.dataset.key, name: form.elements.name.value, balance: form.elements.balance.value, include: form.elements.include.checked });
    if (!result.ok) { form.querySelector('[data-error]').textContent = result.error; return; }
    accountData = result.data; openAcct = null; commit(); showToast('Saved');
  });
  $('acct-list').addEventListener('click', event => {
    const head = event.target.closest('[data-acct-toggle]');
    if (head) { openAcct = openAcct === head.dataset.acctToggle ? null : head.dataset.acctToggle; renderAccounts(); return; }
    const button = event.target.closest('[data-acct-act="remove"]'), form = event.target.closest('[data-acct-form]');
    if (!button || !form) return;
    const before = accountData, account = before.accounts.find(a => a.key === form.dataset.key);
    if (!account) return;
    accountData = Ac.removeAccount(before, account.key); openAcct = null; commit();
    showToast(`${account.name} removed`, { label: 'Undo', run: () => { accountData = before; commit(); } });
  });
  const closeAcctAdd = () => { $('acct-add-form').classList.add('hidden'); $('acct-add-toggle').setAttribute('aria-expanded', 'false'); };
  $('acct-add-toggle').addEventListener('click', () => {
    const open = $('acct-add-form').classList.toggle('hidden') === false;
    $('acct-add-toggle').setAttribute('aria-expanded', String(open));
  });
  $('acct-add-form').addEventListener('submit', event => {
    event.preventDefault();
    const result = Ac.saveAccount(accountData, { name: $('acct-add-name').value, last4: $('acct-add-last4').value, balance: $('acct-add-balance').value });
    if (!result.ok) { $('acct-add-error').textContent = result.error; return; }
    $('acct-add-error').textContent = ''; $('acct-add-form').reset(); closeAcctAdd();
    accountData = result.data; commit(); showToast(`${result.account.name} added`);
  });

  // The keyboard pushes the page up, and the bottom bar used to ride up with it. While you type, the bar simply steps aside.
  const typingTarget = el => Boolean(el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select'));
  document.addEventListener('focusin', event => { if (typingTarget(event.target)) document.documentElement.setAttribute('data-typing', ''); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!typingTarget(document.activeElement)) document.documentElement.removeAttribute('data-typing'); }, 120));

  // The keyboard slides over the bottom of the page and the page stays where it is. Only when the field you tapped would be
  // hidden behind the keyboard does the page move, and only by as much as needed. The phone says how tall the keyboard is.
  const root = document.documentElement;
  let rawKeyboard = 0, fullHeight = root.clientHeight;
  function applyKeyboard() {
    fullHeight = Math.max(fullHeight, root.clientHeight);
    // If the phone already made the page shorter by the keyboard's height, nothing more is covered.
    const covered = rawKeyboard > 0 && fullHeight - root.clientHeight < rawKeyboard * 0.8 ? rawKeyboard : 0;
    root.style.setProperty('--kb', `${covered}px`);
    root.toggleAttribute('data-kb', rawKeyboard > 0 || fullHeight - root.clientHeight > 150);
    return covered;
  }
  function keepFieldAbove() {
    const el = document.activeElement;
    if (!typingTarget(el)) return;
    if (el.closest('dialog')) { el.scrollIntoView({ block: 'nearest' }); return; }   // a sheet lifts above the keyboard by itself
    const top = root.clientHeight - applyKeyboard() - 12, box = el.getBoundingClientRect();
    if (box.bottom > top) window.scrollBy(0, box.bottom - top);
    else if (box.top < 8) window.scrollBy(0, box.top - 8);
  }
  window.pocketKeyboard = pixels => { rawKeyboard = Math.max(0, Number(pixels) || 0); applyKeyboard(); if (rawKeyboard) setTimeout(keepFieldAbove, 120); };
  window.addEventListener('resize', () => { applyKeyboard(); setTimeout(keepFieldAbove, 120); });
  document.addEventListener('focusin', () => setTimeout(keepFieldAbove, 350));

  // ---------- Home: the calendar ----------
  // The month (or the plan) as a calendar: a day is green when you stayed under that day's limit and red when you went over it.
  // A day with no colour is before the budget began or still to come. Tap a day to see by how much.
  const picked = { month: '', plan: '' };
  function calendarHtml(rows, start, end, which) {
    if (!rows.length) return '<div class="empty">No days yet</div>';
    const byDate = new Map(rows.map(row => [row.date, row])), t = today();
    const leftText2 = row => `${money(Math.max(0, row.over ? Math.ceil(row.spent) : Math.floor(row.spent)))} spent, ${row.over ? `${money(Math.ceil(-row.left))} over` : `${rupees(row.left)} left`}`;
    // What was spent that day, short enough for a small square: 93, 115, 1150, 12.4k, 1.5L. Over the limit rounds up, under rounds down.
    const short = row => {
      const value = row.spent, a = Math.abs(value), sign = value < 0 ? '−' : '';
      const trim = n => String(n).replace(/\.0$/, '');
      if (a >= 100000) return `${sign}₹${trim((a / 100000).toFixed(a >= 1000000 ? 0 : 1))}L`;
      if (a >= 10000) return `${sign}₹${trim((a / 1000).toFixed(1))}k`;
      return `${sign}₹${row.over ? Math.ceil(a) : Math.floor(a)}`;
    };
    const cells = [];
    for (let i = new Date(`${start}T12:00:00`).getDay(); i > 0; i--) cells.push('<span class="cal-cell blank"></span>');
    for (let date = start; date <= end; date = U.addDays(date, 1)) {
      const row = byDate.get(date), n = Number(date.slice(8, 10));
      const cls = ['cal-cell', row ? (row.over ? 'over' : 'under') : 'none', date === t ? 'today' : '', picked[which] === date ? 'picked' : ''].filter(Boolean).join(' ');
      cells.push(row ? `<button class="${cls}" type="button" data-day="${date}" aria-label="${esc(dayLabel(date))}, ${esc(leftText2(row))}"><span class="cal-day">${n}</span><span class="cal-amt${short(row).length > 5 ? ' long' : ''}">${esc(short(row))}</span></button>` : `<span class="${cls}"><span class="cal-day">${n}</span></span>`);
    }
    const title = start.slice(0, 7) === end.slice(0, 7) ? new Date(`${start}T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + (start.slice(8, 10) !== '01' && which === 'month' ? ` · from ${shortDay(start)}` : '') : `${shortDay(start)} – ${shortDay(end)}`;
    const sel = byDate.get(picked[which]);
    return `<div class="cal-title">${esc(title)}</div><div class="cal-week">${[...'SMTWTFS'].map(l => `<span>${l}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div>
      <div class="cal-detail" aria-live="polite">${sel ? `${esc(dayLabel(sel.date))} · <strong class="${sel.over ? 'neg' : 'pos'}">${esc(leftText2(sel))}</strong>` : ''}</div>`;
  }
  for (const [id, which] of [['month-days', 'month'], ['plan-days', 'plan']]) {
    $(id).addEventListener('click', event => {
      const day = event.target.closest('[data-day]');
      if (!day) return;
      picked[which] = picked[which] === day.dataset.day ? '' : day.dataset.day;
      const y = window.scrollY;   // redrawing the calendar must not move the page
      renderPlanning();
      window.scrollTo(0, y);
    });
  }

  function monthRows() {
    const cycle = cycleNow(), rows = billRows();
    return B.monthSchedule({
      cycle, today: today(), budget: dailyBudget(), addedFunds: addedFor(cycle), fundList: state.budget > 0 ? state.monthlyFunds : [],
      goalMoves: G.goalMovesInRange(state.plans, cycle.start, cycle.end), expenses: budgetExpenses(),
      commitments: rows.filter(row => row.state !== 'paid'), billPayments: Bi.billPaymentIds(rows, state.expenses, billData.paid),
    });
  }
  function renderMonthDays() {
    // Days before the budget was set are not shown: a budget set today starts today.
    const cycle = cycleNow();
    const from = settings.budgetFrom && settings.budgetFrom > cycle.start && settings.budgetFrom <= cycle.end ? settings.budgetFrom : cycle.start;
    $('month-days').innerHTML = state.budget > 0 ? calendarHtml(monthRows().filter(row => row.date >= from), from, cycle.end, 'month') : '<div class="empty">Set a monthly budget</div>';
  }

  // ---------- Set money aside for a goal (the "Set aside" figure on Home) ----------
  function openAside() {
    const goals = state.plans.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    $('aside-form').classList.toggle('hidden', !goals.length); $('aside-empty').classList.toggle('hidden', goals.length > 0);
    $('aside-goal').innerHTML = goals.map(p => `<option value="${esc(p.id)}">${esc(p.title)} · ${money(G.savedOf(p))} of ${money(p.target)}</option>`).join('');
    $('aside-amount').value = ''; $('aside-date').value = today(); $('aside-error').textContent = '';
    $('aside-dialog').showModal();
  }
  $('stat-goals-btn').addEventListener('click', openAside);
  $('aside-close').addEventListener('click', () => $('aside-dialog').close());
  $('aside-cancel').addEventListener('click', () => $('aside-dialog').close());
  $('aside-new').addEventListener('click', () => { $('aside-dialog').close(); setGoalFormOpen(true); });
  $('aside-form').addEventListener('submit', event => {
    event.preventDefault();
    const result = G.addToGoal(state.plans, $('aside-goal').value, $('aside-amount').value, $('aside-date').value);
    if (!result.ok) { $('aside-error').textContent = result.error; return; }
    const before = state.plans;
    state.plans = result.plans; $('aside-dialog').close(); commit();
    showToast(`Set aside ${money(result.contribution.amount)} for ${result.plan.title}`, { label: 'Undo', run: () => { state.plans = before; commit(); } });
  });

  // ---------- Today: the monthly budget row; its sheet holds your specific budgets ----------
  // Each specific budget with what is left of it, and a button to add an expense straight to it.
  function renderSpecific() {
    const card = $('spec-card'), pots = state.budget > 0 ? budgetView().pots : [];
    card.classList.toggle('hidden', !pots.length);
    if (!pots.length) { card.innerHTML = ''; return; }
    card.innerHTML = `<h2>Specific budgets</h2>` + pots.map(p => {
      const pct = p.budget > 0 ? Math.min(100, Math.round(p.spent / p.budget * 100)) : 0;
      const text = p.left >= 0 ? `${money(p.left)} left of ${money(p.budget)}` : `${money(-p.left)} over ${money(p.budget)}`;
      return `<div class="spec-row${p.left < 0 ? ' over' : ''}"><div class="spec-top"><strong>${esc(p.pot.name)}</strong><span>${esc(text)}</span></div>
        <div class="spec-bar" role="presentation"><i style="width:${pct}%"></i></div>
        <button class="btn small" type="button" data-spec-add="${esc(p.pot.id)}">+ Add expense</button></div>`;
    }).join('');
  }
  let specTarget = '';
  $('spec-card').addEventListener('click', event => {
    const button = event.target.closest('[data-spec-add]');
    if (!button) return;
    const entry = budgetView().pots.find(p => p.pot.id === button.dataset.specAdd);
    if (!entry) return;
    specTarget = entry.pot.id;
    $('spec-title').textContent = `Add to ${entry.pot.name}`;
    $('spec-left').textContent = entry.left >= 0 ? `${money(entry.left)} left of ${money(entry.budget)} for ${entry.pot.name}.` : `${money(-entry.left)} over the ${money(entry.budget)} for ${entry.pot.name}.`;
    $('spec-amount').value = ''; $('spec-note').value = ''; $('spec-date').value = today(); $('spec-error').textContent = '';
    $('spec-dialog').showModal();
  });
  $('spec-close').addEventListener('click', () => $('spec-dialog').close());
  $('spec-cancel').addEventListener('click', () => $('spec-dialog').close());
  $('spec-form').addEventListener('submit', event => {
    event.preventDefault();
    const pot = potsData.pots.find(p => p.id === specTarget);
    const amount = U.round2(Number($('spec-amount').value)), date = $('spec-date').value;
    if (!pot) { $('spec-dialog').close(); return; }
    if (!(amount > 0)) { $('spec-error').textContent = 'Enter an amount above zero.'; return; }
    if (!U.isValidDate(date)) { $('spec-error').textContent = 'Pick a date.'; return; }
    const note = $('spec-note').value.trim();
    state.expenses.push({ id: newId(), amount, description: (note || pot.name).slice(0, 100), category: pot.categories[0] || 'Other', date, potId: pot.id, createdAt: Date.now() });
    $('spec-dialog').close(); commit();
    const now = budgetView().pots.find(p => p.pot.id === pot.id);
    showToast(now && now.left >= 0 ? `Added ${money(amount)} to ${pot.name}. ${money(now.left)} left` : `Added ${money(amount)} to ${pot.name}. Over by ${money(-(now ? now.left : 0))}`);
  });
  function renderBudgets() {
    renderSpecific();
    $('budget-open-title').textContent = state.budget > 0 ? 'Monthly budget' : 'Set monthly budget';
    $('budget-open-value').textContent = state.budget > 0 ? money(state.budget) : '';
    $('budget-delete').classList.toggle('hidden', !(state.budget > 0));
    $('budget-open').classList.toggle('hidden', !(state.budget > 0));   // with no budget the big "Set monthly budget" button is the way in
  }
  $('budget-open').addEventListener('click', () => openBudget());
  $('budget-close').addEventListener('click', () => $('budget-dialog').close());
  // "Add money" raises the monthly budget itself: the amount at the top of the sheet goes up by what you add, and it is saved at
  // once. There is no separate list. To change the amount later, open the same sheet and edit it.
  function addMonthMoney() {
    const amount = U.round2(Number($('fund-quick').value));
    if (!(amount > 0)) { $('fund-quick-error').textContent = 'Type how much to add.'; return; }
    const was = state.budget, wasField = $('budget-input').value, wasFrom = settings.budgetFrom;
    const now = U.round2((Number($('budget-input').value) || 0) + amount);
    if (!(was > 0)) settings = { ...settings, budgetFrom: today() };   // the first day of this budget
    state.budget = now; $('budget-input').value = now;
    $('fund-quick').value = ''; $('fund-quick-error').textContent = '';
    commit(); renderBudgetLines();
    showToast(`Monthly budget is now ${money(now)}`, { label: 'Undo', run: () => { state.budget = was; settings = { ...settings, budgetFrom: wasFrom }; $('budget-input').value = wasField; commit(); if ($('budget-dialog').open) renderBudgetLines(); } });
  }
  $('budget-add-money').addEventListener('click', addMonthMoney);
  $('fund-quick').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addMonthMoney(); } });
  $('fund-quick').addEventListener('input', () => { $('fund-quick-error').textContent = ''; });
  $('budget-delete').addEventListener('click', () => {
    // Deleting the monthly budget takes its specific budgets with it, so the next one starts clean.
    const before = state.budget, beforeSettings = settings, beforePots = potsData, beforeFunds = state.monthlyFunds, cycle = cycleNow(), beforeTrash = trashData;
    if (before > 0) trashData = Tr.add(trashData, { kind: 'budget', title: 'Monthly budget', data: { budget: before, budgetFrom: beforeSettings.budgetFrom || '', specificMode: beforeSettings.specificMode || 'inside', pots: beforePots } });
    state.budget = 0; settings = { ...settings, budgetFrom: '' }; potsData = { pots: [], topUps: [] };
    state.monthlyFunds = beforeFunds.filter(f => !(f.date >= cycle.start && f.date <= cycle.end));
    $('budget-dialog').close(); commit();
    showToast('Monthly budget deleted', { label: 'Undo', run: () => { state.budget = before; settings = beforeSettings; potsData = beforePots; state.monthlyFunds = beforeFunds; trashData = beforeTrash; commit(); } });
  });

  // Add money to Daily needs (this month's budget) or to one of your budgets.
  let fundTarget = null;
  function openFund(target) {
    const pot = target === 'daily' ? null : potsData.pots.find(p => p.id === target);
    if (target !== 'daily' && !pot) return;
    fundTarget = target;
    $('fund-title').textContent = pot ? `Add money to ${pot.name}` : 'Add money';
    $('fund-amount').value = ''; $('fund-date').value = today(); $('fund-error').textContent = '';
    $('fund-dialog').showModal();
  }
  $('fund-cancel').addEventListener('click', () => $('fund-dialog').close());
  $('fund-form').addEventListener('submit', event => {
    event.preventDefault();
    const amount = U.round2(Number($('fund-amount').value)), date = $('fund-date').value;
    if (!Number.isFinite(amount) || amount <= 0) { $('fund-error').textContent = 'Enter an amount above zero.'; return; }
    if (!U.isValidDate(date)) { $('fund-error').textContent = 'Pick a date.'; return; }
    const before = { funds: state.monthlyFunds, pots: potsData };
    let name = 'your month';
    if (fundTarget === 'daily') state.monthlyFunds = [...state.monthlyFunds, { id: newId(), amount, note: '', date, createdAt: Date.now() }];
    else {
      const result = Pt.addTopUp(potsData, fundTarget, amount, date);
      if (!result.ok) { $('fund-error').textContent = result.error; return; }
      potsData = result.data; name = (potsData.pots.find(p => p.id === fundTarget) || {}).name || 'budget';
    }
    $('fund-dialog').close(); commit();
    showToast(`Added ${money(amount)} to ${name}`, { label: 'Undo', run: () => { state.monthlyFunds = before.funds; potsData = before.pots; commit(); } });
  });

  // Create or change one of your budgets.
  let editingPot = null;
  const PRESETS = { Shopping: { name: 'Shopping', categories: ['Shopping'], keywords: '' }, Orders: { name: 'Orders', categories: [], keywords: 'swiggy, zomato, amazon, flipkart, blinkit, zepto' }, Travel: { name: 'Travel', categories: ['Travel'], keywords: '' } };
  $('pot-cats').innerHTML = U.CATEGORIES.map(c => `<label class="chip-check"><input type="checkbox" value="${esc(c)}" /><span>${esc(c)}</span></label>`).join('');
  const pickedCats = () => [...$('pot-cats').querySelectorAll('input:checked')].map(i => i.value);
  function fillPot(values) {
    $('pot-name').value = values.name || ''; $('pot-keywords').value = values.keywords || '';
    for (const box of $('pot-cats').querySelectorAll('input')) box.checked = (values.categories || []).includes(box.value);
  }
  function openPot(id) {
    const pot = id ? potsData.pots.find(p => p.id === id) : null;
    editingPot = pot ? pot.id : null;
    $('pot-title').textContent = pot ? 'Change budget' : 'New budget';
    $('pot-presets').classList.toggle('hidden', Boolean(pot)); $('pot-delete').classList.toggle('hidden', !pot);
    fillPot(pot ? { name: pot.name, categories: pot.categories, keywords: (pot.keywords || []).join(', ') } : {});
    $('pot-limit').value = pot ? pot.limit : ''; $('pot-error').textContent = '';
    $('pot-dialog').showModal();
  }
  $('pot-presets').addEventListener('click', event => {
    const button = event.target.closest('[data-preset]');
    if (button) fillPot(PRESETS[button.dataset.preset]);
  });
  $('pot-close').addEventListener('click', () => $('pot-dialog').close());
  $('pot-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = { name: $('pot-name').value, limit: $('pot-limit').value, categories: pickedCats(), keywords: $('pot-keywords').value };
    const result = editingPot ? Pt.updatePot(potsData, editingPot, input) : Pt.createPot(potsData, input);
    if (!result.ok) { $('pot-error').textContent = result.error; return; }
    potsData = result.data; $('pot-dialog').close(); commit(); showToast('Saved');
  });
  $('pot-delete').addEventListener('click', () => {
    const before = potsData, pot = before.pots.find(p => p.id === editingPot);
    if (!pot) return;
    potsData = Pt.removePot(before, pot.id); $('pot-dialog').close(); commit();
    showToast(`${pot.name} deleted`, { label: 'Undo', run: () => { potsData = before; commit(); } });
  });

  const plansList = () => {
    const t = today(), open = x => x.endDate >= t;
    return state.dailyTargets.filter(x => x.mode === 'period' && x.startDate && x.endDate)
      .sort((a, b) => (open(a) === open(b) ? (open(a) ? a.startDate.localeCompare(b.startDate) : b.endDate.localeCompare(a.endDate)) : (open(a) ? -1 : 1)));
  };
  function currentPlan() {
    const list = plansList(), t = today();
    return list.find(p => p.id === settings.planId) || list.find(p => p.startDate <= t && p.endDate >= t) || list[0] || null;
  }
  let planFormOpen = false, planLast = 'total', planEditId = '';
  const planDays = () => (U.isValidDate($('plan-start').value) && U.isValidDate($('plan-end').value) && $('plan-end').value >= $('plan-start').value ? U.daysBetween($('plan-start').value, $('plan-end').value) + 1 : 0);
  function relinkPlan() {
    const days = planDays();
    if (!days) return;
    if (planLast === 'total') { const v = Number($('plan-amount').value); $('plan-daily').value = v > 0 ? U.round2(v / days) : ''; }
    else { const v = Number($('plan-daily').value); $('plan-amount').value = v > 0 ? U.round2(v * days) : ''; }
  }
  $('plan-amount').addEventListener('input', () => { planLast = 'total'; relinkPlan(); });
  $('plan-daily').addEventListener('input', () => { planLast = 'daily'; relinkPlan(); });
  $('plan-start').addEventListener('change', relinkPlan);
  $('plan-end').addEventListener('change', relinkPlan);

  function renderPlanning() {
    const period = settings.todayMode === 'period';
    $('mode-month').setAttribute('aria-selected', String(!period)); $('mode-period').setAttribute('aria-selected', String(period));
    $('month-panel').classList.toggle('hidden', period); $('period-panel').classList.toggle('hidden', !period);
    renderBudgets();
    renderMonthDays();
    if (period) renderPlan();
  }

  function renderPlan() {
    const list = plansList(), plan = currentPlan(), t = today();
    const creating = planFormOpen || !plan;
    $('plan-bar').classList.toggle('hidden', !list.length || creating);
    $('plan-form').classList.toggle('hidden', !creating);
    $('plan-view').classList.toggle('hidden', creating);
    $('plan-cancel').classList.toggle('hidden', !list.length);
    $('plan-select').innerHTML = list.map(p => `<option value="${esc(p.id)}"${plan && p.id === plan.id ? ' selected' : ''}>${esc(p.note || 'Plan')} · ${esc(shortDay(p.startDate))} – ${esc(shortDay(p.endDate))}</option>`).join('');
    if (creating) return;

    // Money put into goals (and taken out) during the plan counts like spending (and like money back) on its day.
    const goalMoves = G.goalMovesInRange(state.plans, plan.startDate, plan.endDate);
    const r = B.periodAllowance({ start: plan.startDate, end: plan.endDate, total: plan.amount, today: t, expenses: spendingList(), goalMoves });
    const hero = $('phero');
    hero.classList.remove('over', 'idle');
    const set = (label, amount, pct) => {
      $('phero-label').textContent = label; $('phero-amount').textContent = amount; $('phero-sub').textContent = ''; $('phero-foot').textContent = '';
      $('phero-bar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    };
    if (r.status === 'upcoming') { hero.classList.add('idle'); set(`Starts ${longDate(plan.startDate)}`, `${rupees(r.allowanceToday)} a day`, 0); }
    else if (r.overBy > 0) { hero.classList.add('over'); set(r.status === 'ended' ? 'Went over budget by' : 'Over the budget by', money(Math.ceil(r.overBy)), 100); }
    else if (r.status === 'ended') { hero.classList.add('idle'); set('Plan finished', money(r.spent + r.goal), r.total ? (r.spent + r.goal) / r.total * 100 : 0); }
    else if (r.leftToday < 0) { hero.classList.add('over'); set('Over today’s limit by', money(Math.ceil(-r.leftToday)), 100); }
    else if (r.allowanceToday === 0) { hero.classList.add('idle'); set('Nothing left to spend today', money(0), 100); }
    else set('You can spend today', rupees(r.leftToday), r.allowanceToday ? (r.spentToday + r.goalToday) / r.allowanceToday * 100 : 0);

    $('pstat-budget').textContent = money(r.total); $('pstat-spent').textContent = money(r.spent + r.goal);
    $('pstat-left').textContent = money(r.remaining); $('pstat-left').classList.toggle('neg', r.remaining < 0);
    const rows = B.periodSchedule({ start: plan.startDate, end: plan.endDate, total: plan.amount, expenses: spendingList(), goalMoves }).filter(row => row.date <= t);
    $('plan-days').innerHTML = calendarHtml(rows, plan.startDate, plan.endDate, 'plan');
  }
  $('mode-month').addEventListener('click', () => { settings = { ...settings, todayMode: 'month' }; commit(); });
  $('mode-period').addEventListener('click', () => { settings = { ...settings, todayMode: 'period' }; commit(); });
  $('plan-select').addEventListener('change', () => { settings = { ...settings, planId: $('plan-select').value }; commit(); });
  $('plan-new').addEventListener('click', () => {
    planFormOpen = true; planEditId = ''; $('plan-form-title').textContent = 'New plan';
    $('plan-form').reset(); $('plan-start').value = today(); $('plan-end').value = today(); $('plan-error').textContent = ''; planLast = 'total';
    renderPlan();
  });
  // Tap the budget (or Edit) to change it. The daily limit, the figures and the calendar all follow when it is saved.
  function editPlan() {
    const plan = currentPlan();
    if (!plan) return;
    planFormOpen = true; planEditId = plan.id; $('plan-form-title').textContent = 'Edit plan';
    $('plan-note').value = plan.note || ''; $('plan-amount').value = plan.amount; $('plan-start').value = plan.startDate; $('plan-end').value = plan.endDate;
    planLast = 'total'; relinkPlan(); $('plan-error').textContent = '';
    renderPlan();
  }
  $('plan-edit').addEventListener('click', editPlan);
  $('pstat-budget-btn').addEventListener('click', editPlan);
  $('plan-cancel').addEventListener('click', () => { planFormOpen = false; planEditId = ''; $('plan-error').textContent = ''; renderPlan(); });
  $('plan-form').addEventListener('submit', event => {
    event.preventDefault();
    const amount = U.round2(Number($('plan-amount').value)), start = $('plan-start').value, end = $('plan-end').value;
    if (!Number.isFinite(amount) || amount <= 0) { $('plan-error').textContent = 'Enter a budget or a daily limit.'; return; }
    if (!U.isValidDate(start) || !U.isValidDate(end)) { $('plan-error').textContent = 'Pick both dates.'; return; }
    if (end < start) { $('plan-error').textContent = 'The end date comes before the start date.'; return; }
    $('plan-error').textContent = '';
    const fields = { amount, startDate: start, endDate: end, note: $('plan-note').value.trim().slice(0, 80) };
    const old = planEditId ? state.dailyTargets.find(x => x.id === planEditId) : null;
    const plan = old ? { ...old, ...fields } : { id: newId(), mode: 'period', ...fields, createdAt: Date.now() };
    state.dailyTargets = old ? state.dailyTargets.map(x => (x.id === old.id ? plan : x)) : [...state.dailyTargets, plan];
    settings = { ...settings, todayMode: 'period', planId: plan.id }; planFormOpen = false; planEditId = '';
    commit(); showToast('Saved');
  });
  $('plan-delete').addEventListener('click', () => {
    const plan = currentPlan();
    if (!plan) return;
    const before = state.dailyTargets, beforeSettings = settings, beforeTrash = trashData;
    trashData = Tr.add(trashData, { kind: 'plan', title: plan.note || 'Specific period plan', data: { plan } });
    state.dailyTargets = before.filter(x => x.id !== plan.id); settings = { ...settings, planId: '' }; commit();
    showToast('Plan deleted', { label: 'Undo', run: () => { state.dailyTargets = before; settings = { ...beforeSettings }; trashData = beforeTrash; commit(); } });
  });
  $('plan-start').value = today(); $('plan-end').value = today();

  // ---------- Who owes me ----------
  function renderOwedCard() {
    $('owed-card').classList.add('hidden'); return;   // Who owes me is no longer part of the app
    const card = $('owed-card'), s = O.summary(owedData.debts), payBacks = (inboxData.settle || []).length;
    if (!s.outstanding) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    card.innerHTML = `<div class="period-top"><h2>Owed to you</h2><span>${money(s.outstanding)}</span></div>
      <div class="list">${s.people.slice(0, 3).map(p => `<div class="row"><div class="sym" style="background:#e6f2e9" aria-hidden="true">${ICON.Owed}</div>
        <div><div class="row-title">${esc(p.person)}</div><div class="row-meta">${p.debts.length === 1 ? esc(p.debts[0].description) : `${p.debts.length} payments`}</div></div>
        <div class="row-amount">${money(p.outstanding)}</div><span></span></div>`).join('')}</div>
      <a class="text-link" href="#owed">${s.people.length > 3 ? `${s.people.length - 3} more · ` : ''}Who owes me${payBacks ? ` · ${payBacks} to confirm` : ''} →</a>`;
  }
  function owedDebtLine(d) {
    const left = O.outstanding(d), paid = O.paidOf(d);
    return `<div class="history-row"><span>${esc(d.description)} · ${dayLabel(d.date)}${paid ? ` · ${money(paid)} paid of ${money(d.amount)}` : ''}</span><strong>${money(left)}</strong>
      <button class="btn small" type="button" data-owed-act="forget" data-id="${esc(d.id)}" aria-label="Forget the ${money(left)} ${esc(d.person)} owes for ${esc(d.description)}">Forget</button></div>`;
  }
  function owedPersonCard(p, i) {
    const form = openOwedForm === p.personKey ? `<form class="goal-inline" data-owed-form data-key="${esc(p.personKey)}">
        <div class="two"><div class="field"><label for="op-${i}">Amount received (₹)</label><input id="op-${i}" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${p.outstanding}" required /></div>
        <div class="field"><label for="od-${i}">Date</label><input id="od-${i}" name="date" type="date" value="${today()}" required /></div></div>
        <p class="hint" data-hint role="status"></p><div class="row-actions"><button class="btn" type="button" data-owed-act="close-form">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>` : '';
    return `<article class="goal-card" data-key="${esc(p.personKey)}">
      <div class="goal-top"><h3 class="goal-title">${esc(p.person)}</h3><span class="chip">${money(p.outstanding)}</span></div>
      ${p.debts.map(owedDebtLine).join('')}
      <div class="goal-actions"><button class="btn primary" type="button" data-owed-act="open-pay" data-key="${esc(p.personKey)}">Got money back</button><button class="btn" type="button" data-owed-act="remind" data-key="${esc(p.personKey)}">Remind</button></div>
      ${form}</article>`;
  }
  function renderOwed() {
    const s = O.summary(owedData.debts);
    $('owed-total').textContent = money(s.outstanding);
    $('owed-list').innerHTML = s.people.length ? s.people.map(owedPersonCard).join('')
      : '<div class="card empty">Nobody owes you anything</div>';
    const settled = s.settled.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 30);
    $('owed-settled-wrap').classList.toggle('hidden', !settled.length);
    $('owed-settled-title').textContent = `Paid back (${s.settled.length})`;
    $('owed-settled').innerHTML = settled.map(d => `<div class="history-row"><span>${esc(d.person)} · ${esc(d.description)} · ${dayLabel(d.date)}</span><strong class="pos">${money(d.amount)}</strong><span></span></div>`).join('');
  }
  $('owed-add-form').addEventListener('submit', event => {
    event.preventDefault();
    const person = $('owed-add-name').value.trim(), amount = U.round2(Number($('owed-add-amount').value)), note = $('owed-add-note').value.trim();
    const expense = { id: newId(), amount, description: (note || `Lent to ${person}`).slice(0, 100), category: 'Other', date: today(), createdAt: Date.now() };
    const result = O.addDebts(owedData.debts, expense, [{ person, amount }]);
    if (!result.ok) { $('owed-add-error').textContent = result.error; return; }
    const before = { expenses: state.expenses, owed: owedData };
    state.expenses = [...state.expenses, expense]; owedData = { debts: result.debts };
    $('owed-add-form').reset(); $('owed-add-error').textContent = '';
    commit(); showToast(`${person} owes you ${money(amount)}`, { label: 'Undo', run: () => { state.expenses = before.expenses; owedData = before.owed; commit(); } });
  });
  $('owed-list').addEventListener('click', event => {
    const button = event.target.closest('[data-owed-act]');
    if (!button) return;
    const act = button.dataset.owedAct;
    if (act === 'open-pay') { openOwedForm = button.dataset.key; renderOwed(); const input = document.querySelector('[data-owed-form] input[name="amount"]'); if (input) input.focus(); }
    else if (act === 'close-form') { openOwedForm = null; renderOwed(); }
    else if (act === 'remind') {
      const person = O.summary(owedData.debts).people.find(p => p.personKey === button.dataset.key);
      if (!person) return;
      const what = person.debts.length === 1 ? ` for ${person.debts[0].description}` : '';
      const text = `Hi ${person.person}, a small reminder: ${money(person.outstanding)}${what} is still to come to me. Thanks!`;
      (LockUI.hold(), Xb.shareText(text, 'Reminder')).then(result => { if (result && result.copied) showToast('Message copied'); }).catch(() => showToast('Could not open the share sheet'));
    }
    else if (act === 'forget') {
      const debt = owedData.debts.find(d => d.id === button.dataset.id);
      if (!debt) return;
      const before = owedData;
      owedData = { debts: O.writeOff(before.debts, debt.id) }; commit();
      showToast(`${debt.person}’s ${money(O.outstanding(debt))} now counts as your own spending`, { label: 'Undo', run: () => { owedData = before; commit(); } });
    }
  });
  $('owed-list').addEventListener('submit', event => {
    const form = event.target.closest('[data-owed-form]');
    if (!form) return;
    event.preventDefault();
    const before = owedData, key = form.dataset.key;
    const person = (O.summary(before.debts).people.find(p => p.personKey === key) || {}).person || 'They';
    const result = O.settleFor(before.debts, key, { amount: form.elements.amount.value, date: form.elements.date.value }, {});
    if (!result.ok) { form.querySelector('[data-hint]').textContent = result.error; return; }
    owedData = { debts: result.debts }; openOwedForm = null; commit();
    showToast(`${person} paid back ${money(result.applied)}${result.extra ? `. ${money(result.extra)} was more than they owed` : ''}`, { label: 'Undo', run: () => { owedData = before; commit(); } });
  });

  // Credit messages that look like someone paying you back (Review).
  function renderSettle() {
    const items = (inboxData.settle || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    $('settle-section').classList.toggle('hidden', !items.length);
    $('settle-title').textContent = `Someone may have paid you back (${items.length})`;
    $('settle-list').innerHTML = items.map(item => {
      const options = O.matchCredit(item, owedData.debts);
      const body = options.length
        ? `<div class="field"><label for="sp-${esc(item.id)}">Who paid you back?</label><select id="sp-${esc(item.id)}" data-field="person">${options.map(o => `<option value="${esc(o.personKey)}">${esc(o.person)} · owes ${money(o.outstanding)}</option>`).join('')}</select></div>`
        : '<p class="hint">Nobody on your list matches this any more.</p>';
      return `<article class="inbox-card" data-settle-id="${esc(item.id)}">
        <div class="inbox-top"><div class="row-meta">${dayLabel(item.date)}${item.account ? ` · account ••${esc(item.account)}` : ''}</div><div class="inbox-amount pos">+${money(item.amount)}</div></div>
        <p>Received${item.counterparty ? ` from <strong>${esc(item.counterparty)}</strong>` : ''}</p>
        ${body}
        <div class="row-actions"><button class="btn" type="button" data-settle="ignore">Not them</button>${options.length ? '<button class="btn primary" type="button" data-settle="accept">Mark paid back</button>' : ''}</div>
      </article>`;
    }).join('');
  }
  $('settle-list').addEventListener('click', event => {
    const button = event.target.closest('[data-settle]'), card = event.target.closest('[data-settle-id]');
    if (!button || !card) return;
    const id = card.dataset.settleId, before = { owedData, inboxData };
    const undo = () => { owedData = before.owedData; inboxData = before.inboxData; commit(); };
    if (button.dataset.settle === 'accept') {
      const key = card.querySelector('[data-field="person"]').value;
      const person = (O.summary(owedData.debts).people.find(p => p.personKey === key) || {}).person || 'They';
      const result = I.acceptSettle(owedData.debts, inboxData, id, key, {});
      if (!result.ok) { showToast(result.error); return; }
      owedData = { debts: result.debts }; inboxData = result.data; commit();
      showToast(`${person} paid back ${money(result.applied)}${result.extra ? `. ${money(result.extra)} was more than they owed` : ''}`, { label: 'Undo', run: undo });
    } else {
      inboxData = I.ignoreSettle(inboxData, id); commit();
      showToast('Skipped. It won’t ask again.', { label: 'Undo', run: undo });
    }
  });

  // Paid for others: who owes you a share of one payment.
  const splitDialog = $('split-dialog');
  let splitting = null, splitRows = [];
  const splitExpense = () => state.expenses.find(x => x.id === splitting);
  const splitLeft = () => { const e = splitExpense(); return e ? U.round2(Number(e.amount) - O.owedTotalFor(e.id, owedData.debts)) : 0; };
  function updateSplitShare() {
    const owedNow = U.round2(splitRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)), own = U.round2(splitLeft() - owedNow);
    $('split-share').classList.toggle('neg', own < 0);
    $('split-share').textContent = own < 0 ? `That is ${money(-own)} more than you paid.` : `Your own share: ${money(own)}`;
  }
  function renderSplitRows() {
    $('split-rows').innerHTML = splitRows.map((row, i) => `<div class="split-row">
        <input data-split="person" data-i="${i}" maxlength="40" autocomplete="off" placeholder="Name" aria-label="Name of person ${i + 1}" value="${esc(row.person)}" />
        <input data-split="amount" data-i="${i}" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="₹ owed" aria-label="Amount person ${i + 1} owes" value="${esc(row.amount)}" />
        <button class="icon-btn" type="button" data-split-remove="${i}" aria-label="Remove person ${i + 1}"><span class="ico ico-x" aria-hidden="true"></span></button></div>`).join('');
    updateSplitShare();
  }
  function openSplit(id) {
    const e = state.expenses.find(x => x.id === id);
    if (!e) return;
    const already = O.owedTotalFor(id, owedData.debts);
    if (U.round2(Number(e.amount) - already) <= 0) { showToast('All of this payment is already owed to you'); return; }
    splitting = id; splitRows = [{ person: '', amount: '' }, { person: '', amount: '' }];
    $('split-intro').textContent = `You paid ${money(Number(e.amount))} for ${e.description}.${already ? ` ${money(already)} is already owed to you.` : ''} `;
    $('split-error').textContent = '';
    renderSplitRows(); splitDialog.showModal();
  }
  $('split-rows').addEventListener('input', event => {
    const field = event.target.dataset.split;
    if (!field) return;
    splitRows[Number(event.target.dataset.i)][field] = event.target.value;
    updateSplitShare();
  });
  $('split-rows').addEventListener('click', event => {
    const remove = event.target.closest('[data-split-remove]');
    if (!remove) return;
    splitRows.splice(Number(remove.dataset.splitRemove), 1);
    if (!splitRows.length) splitRows.push({ person: '', amount: '' });
    renderSplitRows();
  });
  $('split-add-row').addEventListener('click', () => {
    splitRows.push({ person: '', amount: '' }); renderSplitRows();
    const inputs = $('split-rows').querySelectorAll('input[data-split="person"]'); inputs[inputs.length - 1].focus();
  });
  $('split-equal').addEventListener('click', () => {
    const named = splitRows.filter(r => r.person.trim());
    if (!named.length) { $('split-error').textContent = 'Type the names first, then split equally.'; return; }
    $('split-error').textContent = '';
    const { share } = O.splitEqually(splitLeft(), named.length);
    splitRows = splitRows.map(r => (r.person.trim() ? { ...r, amount: String(share) } : r));
    renderSplitRows();
  });
  $('split-close').addEventListener('click', () => splitDialog.close());
  $('split-cancel').addEventListener('click', () => splitDialog.close());
  $('split-form').addEventListener('submit', event => {
    event.preventDefault();
    const expense = splitExpense();
    const result = O.addDebts(owedData.debts, expense, splitRows);
    if (!result.ok) { $('split-error').textContent = result.error; return; }
    const before = owedData;
    owedData = { debts: result.debts }; splitDialog.close(); commit();
    const mine = state.expenses.find(x => x.id === expense.id);
    showToast(`Your share of ${expense.description} is ${money(U.spendOf(mine))}`, { label: 'Undo', run: () => { owedData = before; commit(); } });
  });

  // ---------- monthly budget sheet ----------
  // You give the monthly budget, then an amount for each thing you want to keep apart (food, shopping, travel...). What is left is
  // the money for every other day, spread over the days that remain.
  let budgetFromMessage = null;   // id of the salary message the sheet was opened from
  let needRows = [];              // [{ key, id (pot id, or '' for a new one), category, fixedName (a budget with its own name or shop names), amount }]
  let needSeq = 0;
  const amountOf = row => Math.max(0, Number(row.amount) || 0);
  const needsOf = rows => U.round2(rows.reduce((sum, row) => sum + amountOf(row), 0));
  function rowsFromPots() {
    return potsData.pots.map(p => {
      const plain = p.categories.length === 1 && !(p.keywords || []).length;
      return { key: `n${needSeq++}`, id: p.id, category: p.categories[0] || 'Other', fixedName: plain ? '' : p.name, amount: p.limit };
    });
  }
  function renderNeedRows() {
    const options = row => U.CATEGORIES.map(c => `<option value="${esc(c)}"${c === row.category ? ' selected' : ''}>${esc(c)}</option>`).join('');
    $('need-list').innerHTML = needRows.map((row, i) => `<div class="need-edit" data-i="${i}">
      ${row.fixedName ? `<span class="need-name">${esc(row.fixedName)}</span>` : `<select data-need="category" aria-label="Category">${options(row)}</select>`}
      <input data-need="amount" type="number" inputmode="decimal" min="0" step="1" value="${row.amount === '' ? '' : esc(row.amount)}" aria-label="Amount (₹)" />
      <button class="icon-btn" type="button" data-need-remove aria-label="Remove this budget"><span class="ico ico-x" aria-hidden="true"></span></button></div>`).join('');
  }
  // The pots as they would be once saved, so the day-to-day figure can be shown before saving.
  function draftPots() {
    return {
      pots: needRows.filter(row => amountOf(row) > 0).map(row => {
        const old = potsData.pots.find(p => p.id === row.id);
        return old ? { ...old, limit: amountOf(row), ...(row.fixedName ? {} : { name: row.category, categories: [row.category], keywords: [] }) }
          : { id: row.key, name: row.category, limit: amountOf(row), categories: [row.category], keywords: [], createdAt: Date.now() };
      }),
      topUps: potsData.topUps,
    };
  }
  const specMode = () => ($('budget-form').elements['spec-mode'].value === 'extra' ? 'extra' : 'inside');
  function renderBudgetLines() {
    const monthly = Math.max(0, Number($('budget-input').value) || 0), cycle = cycleNow(), rows = billRows();
    const extra = specMode() === 'extra', needs = needsOf(needRows);
    const left = extra ? monthly : Math.max(0, U.round2(monthly - needs));
    $('spec-how').classList.toggle('hidden', !(needs > 0));   // the question appears once there is a specific budget
    const view = B.safeToSpend({
      cycle, today: today(), budget: left, addedFunds: monthly > 0 ? C.sumIn(state.monthlyFunds, cycle) : 0,
      goalMoves: G.goalMovesInRange(state.plans, cycle.start, cycle.end), expenses: Pt.spendingView(spendingList(), draftPots(), cycle).expenses,
      commitments: rows.filter(row => row.state !== 'paid'), billPayments: Bi.billPaymentIds(rows, state.expenses, billData.paid),
    });
    // The month as one bar: each specific budget, and what is left for every other day.
    const colours = ['#378ADD', '#D85A30', '#7F77DD', '#BA7517', '#D4537E', '#1D9E75'];
    const parts = needRows.filter(row => amountOf(row) > 0).map((row, i) => ({ name: row.fixedName || row.category, amount: amountOf(row), colour: colours[i % colours.length] }));
    $('split-bar').innerHTML = monthly > 0 ? `<div class="split-bar">${parts.map(p => `<i style="flex:${p.amount};background:${p.colour}"></i>`).join('')}<i style="flex:${left};background:var(--green)"></i></div>
      <div class="split-legend">${parts.map(p => `<span><i style="background:${p.colour}"></i>${esc(p.name)} ${money(p.amount)}${extra ? ' extra' : ''}</span>`).join('')}<span><i style="background:var(--green)"></i>Daily ${money(left)}</span></div>` : '';
    const line = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
    const dueBills = rows.filter(row => row.state !== 'paid'), dueTotal = U.round2(dueBills.reduce((sum, row) => sum + row.amount, 0));
    $('bill-lines').classList.toggle('hidden', !(monthly > 0 && dueBills.length));
    $('bill-lines-list').innerHTML = dueBills.map(row => `<div class="bill-line"><span>${esc(row.title)}<em>${esc(dueText(row))}</em></span><strong>${money(row.amount)}</strong><button class="icon-btn" type="button" data-delete-bill="${esc(row.billId)}" aria-label="Delete ${esc(row.title)}"><span class="ico ico-x" aria-hidden="true"></span></button></div>`).join('');
    $('salary-lines').innerHTML = monthly > 0 ? (extra ? line('Monthly budget', money(monthly)) + (needs > 0 ? line('Specific budgets, kept separate', money(needs)) : '') : line('Left after specific budgets', money(left))) + (dueTotal ? line('Set aside for bills', `−${money(dueTotal)}`) + line('Left for daily spending', money(Math.max(0, U.round2(left - dueTotal)))) : '') + line('You can spend about a day', rupees(view.allowanceToday || 0)) : '';
    $('budget-error').textContent = '';
  }
  function openBudget(options = {}) {
    budgetFromMessage = options.fromMessage || null;
    $('budget-input').value = options.salary || state.budget || '';
    $('budget-form').elements['spec-mode'].value = settings.specificMode === 'extra' ? 'extra' : 'inside';
    $('fund-quick').value = ''; $('fund-quick-error').textContent = '';
    needRows = state.budget > 0 ? rowsFromPots() : [];   // a new budget starts without the old specific budgets
    if (!needRows.length) needRows.push({ key: `n${needSeq++}`, id: '', category: 'Food', fixedName: '', amount: '' });   // the first one is ready to fill in
    renderNeedRows(); renderBudgetLines();
    $('budget-dialog').showModal();   // no focus here: the keyboard would cover the specific budgets
  }
  $('budget-input').addEventListener('input', renderBudgetLines);
  $('budget-form').elements['spec-mode'].forEach(radio => radio.addEventListener('change', renderBudgetLines));
  $('need-list').addEventListener('input', event => {
    const i = Number(event.target.closest('[data-i]') && event.target.closest('[data-i]').dataset.i), field = event.target.dataset.need;
    if (!needRows[i] || !field) return;
    needRows[i][field] = event.target.value;
    renderBudgetLines();
  });
  $('need-list').addEventListener('click', event => {
    const remove = event.target.closest('[data-need-remove]');
    if (!remove) return;
    needRows.splice(Number(remove.closest('[data-i]').dataset.i), 1);
    renderNeedRows(); renderBudgetLines();
  });
  $('pot-new').addEventListener('click', () => {
    const used = new Set(needRows.map(r => r.category));
    needRows.push({ key: `n${needSeq++}`, id: '', category: U.CATEGORIES.find(c => !used.has(c)) || 'Other', fixedName: '', amount: '' });
    renderNeedRows(); renderBudgetLines();
  });
  $('hero-set-budget').addEventListener('click', () => openBudget());
  // Tapping the big card ("You can spend today") opens the full budget form: the monthly budget, or the plan on Specific period.
  // Only the top of the card (the label and the big number) opens the form. The Left, Spent and Set aside figures do nothing, or their own thing.
  $('hero').addEventListener('click', event => { if (!event.target.closest('button, a, .stat-row') && state.budget > 0) openBudget(); });
  $('phero').addEventListener('click', event => { if (!event.target.closest('button, a, .stat-row')) editPlan(); });
  // Adding a bill opens a small form; the list of bills stays the first thing you see.
  $('bill-add-toggle').addEventListener('click', () => {
    const open = $('bill-form').classList.toggle('hidden') === false;
    $('bill-add-toggle').setAttribute('aria-expanded', String(open));
  });
  $('budget-form').addEventListener('submit', event => {
    event.preventDefault();
    const value = Number($('budget-input').value), fail = text => { $('budget-error').textContent = text; };
    if (!Number.isFinite(value) || value < 0) return;
    if (value > 0 && specMode() === 'inside' && needsOf(needRows) >= value) { fail('Your specific budgets leave nothing for every other day. Make the monthly budget bigger, or choose "Keep it separate".'); $('budget-error').scrollIntoView({ block: 'nearest' }); return; }
    // Save the specific budgets: change the ones that exist, add the new ones, drop the ones taken off.
    let data = potsData;
    const kept = new Set();
    for (const row of needRows) {
      const amount = U.round2(amountOf(row));
      if (!(amount > 0)) continue;
      const old = data.pots.find(p => p.id === row.id);
      const result = old
        ? Pt.updatePot(data, old.id, { name: row.fixedName ? old.name : row.category, limit: amount, categories: row.fixedName ? old.categories : [row.category], keywords: row.fixedName ? (old.keywords || []).join(', ') : '' })
        : Pt.createPot(data, { name: row.category, limit: amount, categories: [row.category], keywords: '' });
      if (!result.ok) { fail(result.error); return; }
      data = result.data; kept.add(result.pot.id);
    }
    for (const pot of potsData.pots) if (!kept.has(pot.id)) data = Pt.removePot(data, pot.id);
    potsData = data;
    settings = { ...settings, specificMode: specMode() };
    if (!(state.budget > 0) && value > 0) settings = { ...settings, budgetFrom: today() };   // the first day of this budget
    state.budget = U.round2(value);
    if (budgetFromMessage) inboxData = I.ignoreSalary(inboxData, budgetFromMessage);
    budgetFromMessage = null; $('budget-dialog').close(); commit(); showToast('Budget saved');
  });

  // ---------- Review: everything found is added on its own ----------
  // Payments become expenses and upcoming payments become bills. Only a payment that might be one you typed yourself is
  // held back, so nothing is counted twice. Returns the result (with counts) or null when there was nothing to add.
  function autoAccept() {
    const waiting = inboxData.inbox.some(item => !item.possibleDuplicateOf) || (inboxData.upcoming || []).length > 0;
    if (!waiting) return null;
    const result = I.acceptEverything(state.expenses, billData, inboxData, {});
    state.expenses = result.expenses; billData = result.billData; inboxData = result.data;
    return result;
  }

  // ---------- Review: paste and decide ----------
  $('paste-form').addEventListener('submit', event => {
    event.preventDefault();
    const { data, results, readings } = I.ingestMessages($('paste-input').value, inboxData, { expenses: state.expenses, bills: billData.bills, debts: [], settings });
    inboxData = data; accountData = Ac.applyBalances(accountData, readings);
    autoAccept();
    $('paste-result').innerHTML = results.map(r => r.status === 'added'
      ? `<li class="ok">${r.item.possibleDuplicateOf ? 'Possible duplicate' : 'Added'} ${money(r.item.amount)}${r.item.merchant ? ` · ${esc(r.item.merchant)}` : ''}</li>`
      : r.status === 'salary' || r.status === 'settle' || r.status === 'balance'
        ? `<li class="ok">${esc(r.message)}</li>`
      : r.status === 'upcoming'
        ? `<li class="ok">Bill added: ${money(r.item.amount)}${r.item.title ? ` · ${esc(r.item.title)}` : ''}, ${esc(dayLabel(r.item.dueDate))}</li>`
        : `<li>${esc(r.message)}</li>`).join('');
    if (results.some(r => r.status === 'added' || r.status === 'upcoming' || r.status === 'salary' || r.status === 'settle' || r.status === 'balance')) $('paste-input').value = '';
    commit();
  });
  // ---------- Review: reading bank messages from the phone (Android app only) ----------
  const Bridge = SmsBridge;
  let autoStatus = null;
  let autoError = '';
  let autoHelp = '';
  const RESTRICTED_HINT = 'Android holds this permission back for apps installed by hand. Open Penny’s settings, tap the ⋮ menu at the top right, choose “Allow restricted settings”, then come back and try again.';
  const monthStartMs = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
  const autoButton = (act, label, primary) => `<button class="btn${primary ? ' primary' : ''}" type="button" data-auto="${act}">${label}</button>`;

  // A step shows a tick once it is done.
  function setStep(id, done) { $(id).classList.toggle('done', Boolean(done)); }
  $('step-allow-btn').addEventListener('click', () => { $('auto-toggle').checked = true; $('auto-toggle').dispatchEvent(new Event('change')); });
  function renderAuto() {
    const card = $('auto-card');
    if (!Bridge.inApp) { card.classList.add('hidden'); return; }  // an ordinary browser: nothing to offer
    card.classList.remove('hidden');
    const s = autoStatus;
    $('auto-toggle').checked = Boolean(s && s.receive && s.enabled);
    $('auto-toggle').disabled = !Bridge.available || (!s && !autoError);
    $('auto-help').textContent = autoHelp;
    // Android asks "Allow" only the first time. After that the switch just turns on and off; the phone's own permissions can undo it.
    const allowed = Boolean(s && s.receive);
    $('auto-note').textContent = !allowed ? 'Turn this on and tap Allow when your phone asks. Penny then reads your bank messages as they arrive.'
      : s.enabled ? 'On. Penny reads your bank messages as they arrive.' : 'Off. Turn it on to read your bank messages as they arrive. Your phone already has your Allow, so it will not ask again.';
    $('auto-actions').innerHTML = autoHelp ? autoButton('settings', 'Open Penny’s settings') : allowed ? autoButton('settings', 'Phone permissions') : '';
    setStep('step-allow', allowed); $('step-allow-btn').classList.toggle('hidden', allowed);
    setStep('step-reading', allowed && Boolean(s && s.enabled));
  }
  $('auto-toggle').addEventListener('change', async () => {
    const want = $('auto-toggle').checked;
    $('auto-toggle').disabled = true;
    try {
      if (want) {
        autoStatus = await Bridge.status();   // the permission may have been changed in Android's settings since this was last read
        if (!autoStatus.receive) LockUI.hold(); autoStatus = await Bridge.requestAutoReading();
        if (autoStatus.receive) autoStatus = await Bridge.setAutoReading(true);
        if (autoStatus.receive) { autoHelp = ''; showToast('Automatic reading is on'); if (autoStatus.read) scanThisMonth(); }
        else autoHelp = `Android did not allow it. ${RESTRICTED_HINT}`;
      } else { autoStatus = await Bridge.setAutoReading(false); autoHelp = ''; }
    } catch { showToast('That did not work. Please try again.'); }
    renderAuto();
  });
  async function refreshAuto() {
    if (!Bridge.available) { renderAuto(); return; }
    try { autoStatus = await Bridge.status(); autoError = ''; }
    catch (error) { autoStatus = null; autoError = String((error && error.message) || error || 'unknown error'); autoHelp = `Details: ${autoError}`; }
    renderAuto();
  }
  // Takes whatever arrived while the app was closed, adds the payments to the review list, then clears the phone's queue.
  let draining = false;
  async function drainNow(quiet) {
    if (draining) return;
    draining = true;
    try { await drainMessages(quiet); } finally { draining = false; }
  }
  async function drainMessages(quiet) {
    if (!quiet) refreshExtras();
    await drainExtras();
    if (!Bridge.available) return;
    try {
      const { messages, fromNotification, target } = await Bridge.drain();
      if (messages.length) {
        const result = I.ingestNative(messages, inboxData, { expenses: state.expenses, bills: billData.bills, debts: [], settings });
        inboxData = result.data; accountData = Ac.applyBalances(accountData, result.readings); autoAccept(); commit();
        const found = [result.added && `${result.added} payment${result.added === 1 ? '' : 's'} added`, result.upcoming && `${result.upcoming} bill${result.upcoming === 1 ? '' : 's'} added`, result.settle && 'a pay-back to check', result.salary && 'a salary to check'].filter(Boolean);
        if (found.length) showToast(found.join(' and '));
      }
      if (fromNotification) location.hash = '#today';
      // The widget's + button: land on Today with the "just type it" box ready.
      if (target === 'add') location.hash = '#add';
    } catch { /* the phone side is not ready yet; it is tried again next time the app is shown */ }
    if (!quiet) refreshAuto();
  }
  // New messages are taken the moment Android hands them over; a short timer is the safety net while the app is on screen.
  if (Bridge.available) Bridge.onArrive(() => drainNow(true));
  Xb.onArrive(() => drainNow(true));
  if (Bridge.available || Xb.available) setInterval(() => { if (!document.hidden) drainNow(true); }, 4000);
  async function scanThisMonth() {
    if (!autoStatus.read) {
      LockUI.hold(); autoStatus = await Bridge.requestRead();
      if (!autoStatus.read) { autoHelp = `Reading existing messages was not allowed. ${RESTRICTED_HINT}`; return; }
    }
    autoHelp = '';
    const messages = await Bridge.backfill(monthStartMs());
    const result = I.ingestNative(messages, inboxData, { expenses: state.expenses, bills: billData.bills, debts: [], settings });
    inboxData = result.data; accountData = Ac.applyBalances(accountData, result.readings); autoAccept(); commit();
    if (!result.added && !result.upcoming && !result.settle && result.readings.length) { showToast(`Updated your account balance${result.duplicates ? ' (the payments were already recorded)' : ''}`); return; }
    if (result.settle && !result.added && !result.upcoming) { showToast(`Found ${result.settle} possible pay-back${result.settle === 1 ? '' : 's'} to check`); return; }
    const parts = [result.added && `${result.added} payment${result.added === 1 ? '' : 's'} added`, result.upcoming && `${result.upcoming} bill${result.upcoming === 1 ? '' : 's'} added`].filter(Boolean);
    showToast(parts.length ? parts.join(' and ') : result.duplicates ? 'Nothing new' : 'No bank payments found this month');
  }
  $('auto-actions').addEventListener('click', async event => {
    const button = event.target.closest('[data-auto]');
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.auto === 'enable') {
        LockUI.hold(); autoStatus = await Bridge.requestAutoReading();
        autoHelp = autoStatus.receive ? '' : `Android did not allow it. ${RESTRICTED_HINT}`;
        if (autoStatus.receive) showToast('Automatic reading is on');
      } else if (button.dataset.auto === 'retry') { autoHelp = ''; await refreshAuto(); }
      else if (button.dataset.auto === 'settings') { LockUI.hold(); await Bridge.openAppSettings(); }
      else if (button.dataset.auto === 'scan') await scanThisMonth();
    } catch { showToast('That did not work. Please try again.'); }
    renderAuto();
  });

  // ---------- Today: will the money last? ----------
  function renderPace(o) {
    const card = $('pace-card');
    const p = o.hasBudget && o.dayPool != null ? Pa.checkPace({ cycle: o.cycle, today: today(), dayPool: o.dayPool, daySpent: o.daySpent }) : { status: 'early' };
    card.classList.toggle('hidden', p.status !== 'warn');
    if (p.status !== 'warn') return;
    card.innerHTML = `<h2>Slow down a little</h2><p>At this pace your spending money runs out on ${esc(longDate(p.runOutDate))}, ${p.daysShort} day${p.daysShort === 1 ? '' : 's'} before ${isMonthly() ? 'the month ends' : 'payday'}.</p>`;
  }

  // ---------- Repeating payments, and bills whose price changed ----------
  const dismissedKeys = () => settings.recurringDismissed || [];
  const priceKey = c => `price-${c.bill.id}-${c.to}`;
  const recurSuggestions = () => Rec.findRecurring(state.expenses, billData.bills, { today: today(), dismissed: dismissedKeys() });
  const priceAlerts = () => Rec.priceChanges(billData.bills, state.expenses, today()).filter(c => !dismissedKeys().includes(priceKey(c)));
  function renderRecurring() {
    const found = recurSuggestions(), alerts = priceAlerts(), card = $('recur-card');
    if (alerts.length) {
      const c = alerts[0];
      card.innerHTML = `<h2>${esc(c.bill.title)} is now ${money(c.to)}</h2><p>Your bill says ${money(c.from)}</p>
        <div class="row-actions"><button class="btn" type="button" data-recur="keep" data-key="${esc(priceKey(c))}">Keep ${money(c.from)}</button><button class="btn primary" type="button" data-recur="update" data-id="${esc(c.bill.id)}" data-amount="${c.to}">Update bill</button></div>`;
    } else if (found.length) {
      const s = found[0];
      card.innerHTML = `<h2>${esc(s.title)} repeats every month</h2><p>${money(s.amount)}${s.changed ? `, was ${money(s.changed.from)}` : ''} · next ${esc(dayLabel(s.nextDate))}</p>
        <div class="row-actions"><button class="btn" type="button" data-recur="no" data-key="${esc(s.key)}">No</button><button class="btn primary" type="button" data-recur="add" data-key="${esc(s.key)}">Add as bill</button></div>`;
    }
    card.classList.toggle('hidden', !(alerts.length || found.length));
    const rows = [
      ...alerts.map(c => `<div class="row"><div class="sym" aria-hidden="true">${ICON.Bills}</div><div><div class="row-title">${esc(c.bill.title)}</div><div class="row-meta">Now ${money(c.to)}, bill says ${money(c.from)}</div></div>
        <button class="btn small" type="button" data-recur="update" data-id="${esc(c.bill.id)}" data-amount="${c.to}">Update</button><button class="btn small" type="button" data-recur="keep" data-key="${esc(priceKey(c))}">Keep</button></div>`),
      ...found.map(s => `<div class="row"><div class="sym" aria-hidden="true">${ICON.Bills}</div><div><div class="row-title">${esc(s.title)}</div><div class="row-meta">${money(s.amount)} · next ${esc(dayLabel(s.nextDate))}</div></div>
        <button class="btn small" type="button" data-recur="add" data-key="${esc(s.key)}">Add</button><button class="btn small" type="button" data-recur="no" data-key="${esc(s.key)}">No</button></div>`),
    ];
    $('recur-bills').classList.toggle('hidden', !rows.length);
    $('recur-bills-list').innerHTML = rows.join('');
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-recur]');
    if (!button) return;
    const act = button.dataset.recur;
    if (act === 'no' || act === 'keep') { settings = { ...settings, recurringDismissed: [...dismissedKeys(), button.dataset.key] }; commit(); return; }
    if (act === 'update') {
      const before = billData;
      billData = { ...billData, bills: billData.bills.map(b => (b.id === button.dataset.id ? { ...b, amount: U.round2(Number(button.dataset.amount)) } : b)) };
      commit(); showToast('Bill updated', { label: 'Undo', run: () => { billData = before; commit(); } });
      return;
    }
    const s = recurSuggestions().find(x => x.key === button.dataset.key);
    if (!s) return;
    const made = Bi.createBill({ title: s.title, amount: s.amount, dueDate: s.nextDate, repeat: 'monthly', source: 'manual' });
    if (!made.ok) { showToast(made.error); return; }
    const before = billData;
    billData = { ...billData, bills: [...billData.bills, made.bill] };
    commit(); showToast(`${s.title} added to your bills`, { label: 'Undo', run: () => { billData = before; commit(); } });
  });

  // ---------- Cash in hand ----------
  function renderCashPrompt() {
    const card = $('cash-card');
    const offer = Ca.offers(state.expenses, cashData).find(e => U.daysBetween(e.date, today()) <= 45);
    card.classList.toggle('hidden', !offer);
    if (!offer) return;
    card.innerHTML = `<h2>${money(offer.amount)} taken from an ATM</h2><p>${esc(dayLabel(offer.date))}</p>
      <div class="row-actions"><button class="btn" type="button" data-cash="no" data-id="${esc(offer.id)}">No</button><button class="btn primary" type="button" data-cash="yes" data-id="${esc(offer.id)}">Add to cash in hand</button></div>`;
  }
  $('cash-card').addEventListener('click', event => {
    const button = event.target.closest('[data-cash]');
    if (!button) return;
    const before = { expenses: state.expenses, cashData };
    if (button.dataset.cash === 'yes') {
      state.expenses = Ca.addToWallet(state.expenses, button.dataset.id); commit();
      showToast('Added to cash in hand', { label: 'Undo', run: () => { state.expenses = before.expenses; cashData = before.cashData; commit(); } });
    } else { cashData = Ca.skipOffer(cashData, button.dataset.id); commit(); }
  });
  function renderCash() {
    $('cash-total').textContent = money(Ca.balance(state.expenses, cashData).left);
    const rows = [
      ...state.expenses.filter(e => e.cashIn).map(e => ({ kind: 'atm', id: e.id, date: e.date, title: 'ATM withdrawal', amount: Number(e.amount), plus: true })),
      ...cashData.manual.map(m => ({ kind: 'manual', id: m.id, date: m.date, title: 'Cash added', amount: Number(m.amount), plus: true })),
      ...state.expenses.filter(e => e.cash && !e.cashIn).map(e => ({ kind: 'spend', id: e.id, date: e.date, title: e.description, amount: Number(e.amount), plus: false })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    $('cash-list').innerHTML = rows.length ? rows.map(r => `<div class="row"><div class="sym" aria-hidden="true">${ICON.Other}</div><div><div class="row-title">${esc(r.title)}</div><div class="row-meta">${esc(dayLabel(r.date))}</div></div>
      <div class="row-amount ${r.plus ? 'pos' : ''}">${r.plus ? '+' : '−'}${money(r.amount)}</div>
      ${r.kind === 'spend' ? '<span></span>' : `<button class="icon-btn" type="button" data-cash-remove="${r.kind}" data-id="${esc(r.id)}" aria-label="Remove"><span class="ico ico-x" aria-hidden="true"></span></button>`}</div>`).join('') : '<div class="empty">No cash yet</div>';
  }
  $('cash-list').addEventListener('click', event => {
    const button = event.target.closest('[data-cash-remove]');
    if (!button) return;
    const before = { expenses: state.expenses, cashData };
    if (button.dataset.cashRemove === 'atm') { state.expenses = Ca.removeFromWallet(state.expenses, button.dataset.id); cashData = Ca.skipOffer(cashData, button.dataset.id); }
    else cashData = Ca.removeManual(cashData, button.dataset.id);
    commit(); showToast('Removed', { label: 'Undo', run: () => { state.expenses = before.expenses; cashData = before.cashData; commit(); } });
  });
  $('cash-add-form').addEventListener('submit', event => {
    event.preventDefault();
    const result = Ca.addCash(cashData, $('cash-amount').value, $('cash-date').value);
    if (!result.ok) { $('cash-error').textContent = result.error; return; }
    cashData = result.data; $('cash-error').textContent = ''; $('cash-amount').value = ''; commit(); showToast('Cash added');
  });
  $('cash-date').value = today();

  // ---------- Your last seven days ----------
  function renderRecap() {
    const card = $('recap-card');
    card.classList.add('hidden');
    const seen = settings.recapSeen;
    if (U.daysBetween(sweeps.trackedSince || today(), today()) < 7 || (seen && U.daysBetween(seen, today()) < 7)) return;
    const r = Rc.weeklyRecap({ expenses: state.expenses, rows: state.budget > 0 ? monthRows() : [], today: today() });
    if (!r.count) return;
    const line = (label, value) => `<div><span>${label}</span><strong>${value}</strong></div>`;
    card.innerHTML = `<h2>Your last 7 days</h2><div class="recap">${line('Spent', money(r.total))}
      ${r.topCategory ? line('Most on', `${esc(r.topCategory.category)} ${money(r.topCategory.amount)}`) : ''}
      ${r.biggest ? line('Biggest', `${esc(r.biggest.description)} ${money(U.spendOf(r.biggest))}`) : ''}
      ${line('Days without spending', r.noSpendDays)}${r.streak ? line('Days under your limit', r.streak) : ''}</div>
      <button class="btn" type="button" data-recap="done">Got it</button>`;
    card.classList.remove('hidden');
  }
  $('recap-card').addEventListener('click', event => {
    if (!event.target.closest('[data-recap="done"]')) return;
    settings = { ...settings, recapSeen: today() }; commit();
  });

  // ---------- Review: UPI app notifications and the notification-bar box (Android app only) ----------
  let extrasStatus = { quick: null, upi: null };
  function renderUpi() {
    const { upi } = extrasStatus;
    $('upi-card').classList.toggle('hidden', !Xb.available);
    $('upi-toggle').checked = Boolean(upi && upi.enabled);
    setStep('upi-card', Boolean(upi && upi.enabled && upi.granted));
    let help = '', buttons = '';
    if (upi && upi.enabled && !upi.granted) { help = 'Allow Penny under Notification access, then come back.'; buttons = '<button class="btn" type="button" data-upi="settings">Open notification access</button>'; }
    $('upi-help').textContent = help; $('upi-actions').innerHTML = buttons;
  }
  function renderExtras() {
    renderUpi();
    const { quick } = extrasStatus;
    $('quick-toggle').checked = Boolean(quick && quick.enabled);
    setStep('extras-card', Boolean(quick && quick.enabled && quick.canNotify));
    let help = '', buttons = '';
    if (quick && quick.enabled && !quick.canNotify) { help = 'Allow notifications for Penny, then come back.'; buttons = '<button class="btn" type="button" data-extra="app-settings">Open Penny’s settings</button>'; }
    $('extras-help').textContent = help; $('extras-actions').innerHTML = buttons;
  }
  async function refreshExtras() {
    if (!Xb.available) { $('extras-card').classList.add('hidden'); $('voice-btn').classList.add('hidden'); return; }
    $('extras-card').classList.remove('hidden'); $('voice-btn').classList.remove('hidden');
    try { extrasStatus = { quick: await Xb.quickAddStatus(), upi: await Xb.upiStatus() }; } catch { /* the phone side is not ready yet */ }
    renderExtras();
  }
  $('upi-toggle').addEventListener('change', async () => {
    try { await Xb.upiSetEnabled($('upi-toggle').checked); } catch { showToast('That did not work. Please try again.'); }
    await refreshExtras();
    const { upi } = extrasStatus;
    if (upi && upi.enabled && !upi.granted) { try { LockUI.hold(); await Xb.upiOpenSettings(); } catch { /* the button below does the same */ } }
  });
  $('upi-actions').addEventListener('click', event => {
    if (!event.target.closest('[data-upi]')) return;
    try { LockUI.hold(); Xb.upiOpenSettings(); } catch { /* nothing to open */ }
  });
  $('quick-toggle').addEventListener('change', async () => {
    try { await Xb.quickAddSet($('quick-toggle').checked); } catch { showToast('That did not work. Please try again.'); }
    refreshExtras();
  });
  $('extras-actions').addEventListener('click', event => {
    const button = event.target.closest('[data-extra]');
    if (!button) return;
    try { if (Bridge.available) { LockUI.hold(); Bridge.openAppSettings(); } } catch { /* nothing to open */ }
  });
  // Expenses typed in the notification bar while the app was closed, and bill reminders seen in UPI app notifications.
  async function drainExtras() {
    if (!Xb.available) return;
    try {
      const bills = Upi.billMessages(await Xb.upiDrain(), SmsParser.parseBankSms);
      if (bills.length) {
        const result = I.ingestNative(bills, inboxData, { expenses: state.expenses, bills: billData.bills, debts: [], settings });
        inboxData = result.data; autoAccept(); commit();
        if (result.upcoming) showToast(`${result.upcoming} bill${result.upcoming === 1 ? '' : 's'} added from a UPI app`);
      }
    } catch { /* same */ }
    try {
      let added = 0;
      for (const item of await Xb.quickAddDrain()) {
        const typed = splitCash(String((item && item.text) || '')), r = U.parseNaturalExpense(typed.text);
        if (!r.ok) continue;
        state.expenses.push({ id: newId(), ...r.expense, ...(typed.cash ? { cash: true } : {}), createdAt: Number(item.at) || Date.now(), source: 'quick' }); added++;
      }
      if (added) { commit(); showToast(`${added} expense${added === 1 ? '' : 's'} added from the notification`); }
    } catch { /* same */ }
  }

  // ---------- Hide amounts ----------
  $('hide-btn').addEventListener('click', () => { settings = { ...settings, hideAmounts: !settings.hideAmounts }; commit(); });

  // ---------- Home-screen widget ----------
  // The widget cannot see Penny's data, so each time Today is drawn the figure from the green card is handed to it.
  const widgetPlugin = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.PocketWidget) || null;
  let lastWidgetKey = '';
  function pushWidget(o) {
    const plugin = widgetPlugin();
    if (!plugin) return;
    const hero = $('hero');
    const payload = {
      date: today(),
      tone: hero.classList.contains('over') ? 'over' : hero.classList.contains('idle') ? 'idle' : 'normal',
      label: $('hero-label').textContent, amountText: $('hero-amount').textContent,
      sub: o.hasBudget ? $('hero-sub').textContent : 'Tap to open Penny',
      tomorrowText: o.tomorrowAllowance == null ? '' : rupees(o.tomorrowAllowance),
      hide: settings.widgetAmounts === false,
      waiting: inboxData.inbox.length + (inboxData.upcoming || []).length,
      percent: Math.round(parseFloat($('hero-bar-fill').style.width) || 0),
      billText: nextBillText(),
    };
    const key = JSON.stringify(payload);
    if (key === lastWidgetKey) return;
    lastWidgetKey = key;
    plugin.update(payload).catch(() => { lastWidgetKey = ''; });
  }
  // The next unpaid bill, as one short line for the wider widget.
  function nextBillText() {
    const next = billRows().find(row => row.state !== 'paid');
    if (!next) return '';
    return `${next.title} ${rupees(next.amount)} · ${next.state === 'overdue' ? 'overdue' : next.state === 'today' ? 'due today' : `due ${shortDay(next.date)}`}`;
  }
  // ---------- App lock ----------
  // A new user sets up the fingerprint (with a backup password) the first time; after that Penny asks for it when it opens and when you
  // come back after a few seconds away. Change it from Settings.
  const PL = PocketLock;
  // The phone is told whether the lock is on, so the app opens on a black screen and hides itself in recent apps.
  LockUI.init({ storage, onUnlocked: () => { PL.setSecure(LockUI.active(), false); }, onChanged: () => { PL.setSecure(LockUI.active(), false); renderMore(); showToast('App lock changed'); } });
  let coveredByAway = false;
  $('lock-change').addEventListener('click', () => LockUI.change());

  // ---------- Backup and restore ----------
  const filesPlugin = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.PocketFiles) || null;
  $('backup-save').addEventListener('click', async () => {
    const since = $('backup-since').value;
    $('backup-error').textContent = '';
    if (since && !U.isValidDate(since)) { $('backup-error').textContent = 'Pick a valid date.'; return; }
    const now = new Date(), text = Backup.buildBackup(storage, now, { since }), name = Backup.backupFileName(now);
    try {
      const plugin = filesPlugin();
      if (plugin) {
        await plugin.saveText({ name, text });
        showToast(`Saved ${name} in Downloads`);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`Saved ${name}`);
      }
    } catch (error) { $('backup-error').textContent = `Could not save the backup. ${(error && error.message) || ''}`.trim(); }
  });
  let pendingRestore = null;
  $('backup-restore').addEventListener('click', () => { $('backup-error').textContent = ''; $('backup-file').value = ''; $('backup-file').click(); });
  $('backup-file').addEventListener('change', async () => {
    const file = $('backup-file').files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = Backup.parseBackup(text);
      if (!parsed.ok) { $('backup-error').textContent = parsed.error; return; }
      pendingRestore = text;
      const n = parsed.summary;
      $('restore-text').textContent = `${n.expenses} expense${n.expenses === 1 ? '' : 's'}, ${n.goals} goal${n.goals === 1 ? '' : 's'}, ${n.bills} bill${n.bills === 1 ? '' : 's'}. This replaces everything on this phone.`;
      $('restore-dialog').showModal();
    } catch { $('backup-error').textContent = 'Could not read that file.'; }
  });
  $('restore-cancel').addEventListener('click', () => { pendingRestore = null; $('restore-dialog').close(); });
  $('restore-confirm').addEventListener('click', () => {
    const result = Backup.restoreBackup(storage, pendingRestore);
    $('restore-dialog').close(); pendingRestore = null;
    if (!result.ok) { $('backup-error').textContent = result.error; return; }
    location.reload();   // start again from the restored data
  });

  // ---------- Goals ----------
  const goalForm = $('goal-form'), goalToggle = $('toggle-goal-form');
  let editingGoalId = '';
  // New goal and Edit goal are one page. Every field is there at once; Back returns to the goals.
  function setGoalFormOpen(open, editId = '') {
    editingGoalId = open ? editId : '';
    if (open) {
      goalForm.reset(); $('goal-error').textContent = '';
      const plan = editId ? state.plans.find(p => p.id === editId) : null;
      $('goal-heading').textContent = plan ? 'Edit goal' : 'New goal';
      $('goal-save').textContent = plan ? 'Save changes' : 'Save goal';
      if (plan) {
        $('g-title').value = plan.title; $('g-target').value = plan.target; $('g-date').value = plan.targetDate || '';
        $('g-auto').checked = Boolean(plan.autoDaily || plan.planned);
        if (plan.autoDaily && plan.dailyAmount > 0) { $('g-own').value = plan.dailyAmount; $('g-own-unit').value = 'day'; }
        goalForm.elements['g-how'].value = plan.planned && !plan.autoDaily ? 'manual' : 'limit';
      }
      renderGoalNote();
    }
    location.hash = open ? '#newgoal' : '#goals';
  }
  // What is still to save: the target, less what a goal being edited already holds.
  function goalRemaining() {
    const plan = editingGoalId ? state.plans.find(p => p.id === editingGoalId) : null;
    return Math.max(0, Number($('g-target').value) - (plan ? G.savedOf(plan) : 0));
  }
  // What you typed under "Or type what you can save", as an amount a day (200 a month is 200 / 30 a day).
  const ownPerDay = () => { const v = Number($('g-own').value), unit = $('g-own-unit').value; return v > 0 ? (unit === 'month' ? v * 12 / 365 : unit === 'year' ? v / 365 : v) : 0; };
  const ownUnitWords = { day: 'a day', month: 'a month', year: 'a year' };
  const monthYear = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  // The days of the plan being set up: from the amount you typed, the days box, or the days up to the date.
  function goalFormDays() {
    const own = ownPerDay(), reach = own > 0 ? G.reachIn(goalRemaining(), own, today()) : null;
    if (reach) return reach.days;
    const days = Number($('g-days').value), date = $('g-date').value;
    return days > 0 ? Math.ceil(days) : date ? Math.round((new Date(`${date}T12:00:00`) - new Date(`${today()}T12:00:00`)) / 86400000) : 0;
  }
  // Under the switch: how long it could take and what that costs a day, then how to take it.
  function renderGoalNote() {
    const days = goalFormDays(), on = $('g-auto').checked, remaining = goalRemaining(), own = ownPerDay();
    $('g-auto-note').textContent = on ? 'Pick how long, then how to save it' : 'Turn on to see a plan: how much to put away each day';
    $('g-plan').classList.toggle('hidden', !on);
    if (!on) return;
    $('g-plan-opts').innerHTML = remaining > 0 ? G.savingPlans(remaining, today()).map(p => `<button class="plan-opt${own > 0 && $('g-own-unit').value === 'day' && Number($('g-own').value) === p.perDay ? ' on' : ''}" type="button" data-plan-days="${p.days}" data-plan-perday="${p.perDay}"><strong>${p.months} months</strong><span>${money(p.perDay)} a day</span></button>`).join('') : '';
    const reach = own > 0 ? G.reachIn(remaining, own, today()) : null;
    const perDay = remaining > 0 && days > 0 ? Math.ceil(remaining / (days + 1)) : 0;
    const finish = days > 0 ? dayLabel(U.addDays(today(), days)) : '';
    $('g-plan-line').textContent = remaining <= 0 ? 'Enter the target amount above to see how long it takes.'
      : reach ? `Saving ${money(Number($('g-own').value))} ${ownUnitWords[$('g-own-unit').value]}, it will take ${reach.text}. You reach ${money(remaining)} around ${monthYear(reach.date)}.`
      : perDay ? `Put away about ${money(perDay)} a day (${money(Math.round(perDay * 365 / 12))} a month) and you reach it by ${finish}.` : 'Type an amount to see how long it takes.';
  }
  for (const id of ['g-target', 'g-date', 'g-days']) $(id).addEventListener('input', () => { if ($(id).value && id !== 'g-target') $('g-own').value = ''; renderGoalNote(); });
  $('g-own').addEventListener('input', () => { if ($('g-own').value) { $('g-days').value = ''; $('g-date').value = ''; } renderGoalNote(); });
  $('g-own-unit').addEventListener('change', renderGoalNote);
  $('g-auto').addEventListener('change', renderGoalNote);
  $('g-plan-opts').addEventListener('click', event => {
    const pick = event.target.closest('[data-plan-days]');
    if (!pick) return;
    // A plan fills in the amount, so it can be changed right there and the time follows.
    $('g-own').value = pick.dataset.planPerday; $('g-own-unit').value = 'day'; $('g-days').value = ''; $('g-date').value = ''; renderGoalNote();
  });
  goalToggle.addEventListener('click', () => setGoalFormOpen(true));
  $('cancel-goal').addEventListener('click', () => { goalForm.reset(); $('goal-error').textContent = ''; setGoalFormOpen(false); });
  goalForm.addEventListener('submit', event => {
    event.preventDefault();
    const on = $('g-auto').checked, how = goalForm.elements['g-how'].value;
    if (on && !(goalFormDays() > 0)) { $('goal-error').textContent = 'Type an amount you can save, tap a plan, or pick a date.'; return; }
    const input = { title: $('g-title').value, target: $('g-target').value, targetDate: $('g-date').value, days: $('g-days').value, autoDaily: on && how === 'limit', planned: on && how === 'manual' };
    if (on && ownPerDay() > 0) {   // the amount you typed decides the day it is reached
      const reach = G.reachIn(goalRemaining(), ownPerDay(), today());
      if (!reach) { $('goal-error').textContent = 'Enter the target amount first.'; return; }
      Object.assign(input, { targetDate: reach.date, days: '', dailyAmount: ownPerDay() });
    }
    if (editingGoalId) {
      const result = G.editGoal(state.plans, editingGoalId, input);
      if (!result.ok) { $('goal-error').textContent = result.error; return; }
      state.plans = result.plans;
      goalForm.reset(); $('goal-error').textContent = ''; setGoalFormOpen(false); commit(); showToast('Goal saved');
      return;
    }
    const result = G.createGoal(input);
    if (!result.ok) { $('goal-error').textContent = result.error; return; }
    state.plans = [...state.plans, result.plan];
    goalForm.reset(); $('goal-error').textContent = ''; setGoalFormOpen(false); commit(); showToast('Goal created');
  });

  $('goals-list').addEventListener('submit', event => {
    const form = event.target.closest('[data-goal-form]');
    if (!form) return;
    event.preventDefault();
    const fn = form.dataset.goalForm === 'add' ? G.addToGoal : G.withdrawFromGoal;
    const result = fn(state.plans, form.dataset.id, form.elements.amount.value, form.elements.date.value);
    if (!result.ok) { showToast(result.error); return; }
    state.plans = result.plans; openGoalForm = null; commit();
    showToast(form.dataset.goalForm === 'add' ? `Added ${money(result.contribution.amount)} to ${result.plan.title}` : `Took ${money(-result.contribution.amount)} out of ${result.plan.title}`);
  });
  $('goals-list').addEventListener('click', event => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const id = button.dataset.id, act = button.dataset.act;
    if (act === 'toggle-history') { openGoalHistory = openGoalHistory === id ? null : id; renderGoals(); }
    else if (act === 'open-add' || act === 'open-take') {
      openGoalForm = openGoalForm && openGoalForm.id === id && openGoalForm.kind === act.slice(5) ? null : { id, kind: act.slice(5) };
      renderGoals();
    } else if (act === 'close-form') { openGoalForm = null; renderGoals(); }
    else if (act === 'remove-entry') {
      const result = G.removeContribution(state.plans, id, button.dataset.entry);
      if (!result.ok) { showToast(result.error); return; }
      state.plans = result.plans; commit(); showToast('Entry removed');
    } else if (act === 'edit-goal') setGoalFormOpen(true, id);
    else if (act === 'stop-auto') { state.plans = G.stopAutoSave(state.plans, id); commit(); showToast('Daily saving stopped'); }
    else if (act === 'delete-goal') askDeleteGoal(id);
  });

  $('goals-list').addEventListener('keydown', event => {
    const head = event.target.closest('[data-act="toggle-history"]');
    if (head && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); head.click(); }
  });

  const goalDialog = $('goal-dialog'), goalBody = $('goal-dialog-body');
  function askDeleteGoal(id) {
    const plan = state.plans.find(p => p.id === id);
    if (!plan) return;
    const saved = G.savedOf(plan);
    goalBody.dataset.id = id;
    goalBody.innerHTML = saved > 0
      ? `<h2>Delete “${esc(plan.title)}”?</h2><p>You have ${money(saved)} saved in this goal. What should happen to it?</p>
         <button class="choice" type="button" data-outcome="return"><strong>Return it to my spending money</strong></button>
         <button class="choice" type="button" data-outcome="spent"><strong>I spent it on this goal</strong></button>
         <button class="btn" type="button" data-outcome="cancel">Cancel</button>`
      : `<h2>Delete “${esc(plan.title)}”?</h2>
         <div class="row-actions"><button class="btn" type="button" data-outcome="cancel">Cancel</button><button class="btn danger" type="button" data-outcome="return">Delete goal</button></div>`;
    goalDialog.showModal();
  }
  goalBody.addEventListener('click', event => {
    const button = event.target.closest('[data-outcome]');
    if (!button) return;
    goalDialog.close();
    if (button.dataset.outcome === 'cancel') return;
    const gone = state.plans.find(p => p.id === goalBody.dataset.id);
    const result = G.deleteGoal(state.plans, goalBody.dataset.id, { outcome: button.dataset.outcome });
    if (!result.ok) { showToast(result.error); return; }
    state.plans = result.plans;
    if (result.expense) state.expenses = [...state.expenses, result.expense];
    if (gone) trashData = Tr.add(trashData, { kind: 'goal', title: gone.title, data: { plan: gone, expenseId: result.expense ? result.expense.id : '' } });
    openGoalForm = null; commit();
    showToast(result.expense ? 'Goal deleted. Recorded as spent.' : result.released > 0 ? `Goal deleted. ${money(result.released)} is back in your spending money.` : 'Goal deleted');
  });

  // Dates change at midnight and the phone may have been asleep; redraw when the page is shown again.
  document.addEventListener('visibilitychange', () => {
    // Leaving the app, even for a moment, covers it in black; coming back asks for the fingerprint again. Penny's own phone
    // screens (the Allow question, sharing, speaking) hold this back so they do not lock you out in the middle of a task.
    if (document.hidden) { if (LockUI.active() && !LockUI.busy() && !LockUI.held()) { LockUI.cover(); coveredByAway = true; PL.setSecure(true, true); } return; }
    LockUI.release();
    if (coveredByAway) { coveredByAway = false; LockUI.lockNow(); }
    if (G.applyAutoSave(state.plans, today()).changed) commit(); else render();
    drainNow();
  });

  // Yesterday only counts as "unspent" if Penny was already in use, so remember the first day it ran.
  if (!sweeps.trackedSince) { sweeps.trackedSince = today(); S.saveSweeps(storage, sweeps); }

  if (storage.memoryOnly) showToast('Your browser blocked storage, so nothing will be saved after you close this page.');
  LockUI.startup();
  PL.setSecure(LockUI.active());
  const accepted = autoAccept();
  // Money once added to the month on its own now belongs to the monthly budget: there is only the one amount.
  let folded = false;
  if ((state.monthlyFunds || []).length) {
    const extra = C.sumIn(state.monthlyFunds, cycleNow());
    state.monthlyFunds = []; folded = true;
    if (extra > 0) { if (!(state.budget > 0)) settings = { ...settings, budgetFrom: today() }; state.budget = U.round2((state.budget || 0) + extra); }
  }
  const stamped = state.budget > 0 && !settings.budgetFrom;   // a budget from before the day list knew its first day starts today
  if (stamped) settings = { ...settings, budgetFrom: today() };
  if (accepted || stamped || folded || G.applyAutoSave(state.plans, today()).changed) commit();
  route();
  render();
  refreshAuto();
  drainNow();
})();
