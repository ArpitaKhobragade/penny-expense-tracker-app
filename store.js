// Loading and saving. The budget, expenses, plans and targets stay under the key the original pages use, so
// both versions of the app share one set of data. Anything new (the review inbox, remembered categories)
// lives under its own key, because the original pages rewrite the main record from a fixed list of fields
// and would erase unknown ones.
(function (root) {
  const KEY = 'pocket-expense-tracker-v1';
  const INBOX_KEY = 'pocket-expense-tracker-inbox-v1';
  const SWEEP_KEY = 'pocket-expense-tracker-sweeps-v1';
  const BILLS_KEY = 'pocket-expense-tracker-bills-v1';
  const OWED_KEY = 'pocket-expense-tracker-owed-v1';
  const ACCOUNTS_KEY = 'pocket-expense-tracker-accounts-v1';
  const POTS_KEY = 'pocket-expense-tracker-pots-v1';
  const CASH_KEY = 'pocket-expense-tracker-cash-v1';
  const LOCK_KEY = 'pocket-expense-tracker-lock-v1';   // not part of backups: a restored backup never brings an old PIN with it
  const SETTINGS_KEY = 'pocket-expense-tracker-settings-v1';
  const TRASH_KEY = 'pocket-expense-tracker-trash-v1';   // recently deleted goals, plans and budgets (30 days)
  const MAX_DISMISSED = 500;
  const MAX_DECIDED = 60;

  const objects = value => (Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : []);

  function readJson(storage, key) {
    try {
      const parsed = JSON.parse(storage.getItem(key) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function loadState(storage) {
    const saved = readJson(storage, KEY);
    return {
      budget: Number(saved.budget) || 0,
      expenses: objects(saved.expenses),
      plans: objects(saved.plans).map((plan, planIndex) => ({
        ...plan,
        contributions: objects(plan.contributions).map((item, itemIndex) => ({ ...item, id: item.id || `legacy-${plan.id || planIndex}-${item.createdAt || itemIndex}` })),
      })),
      otherMoney: objects(saved.otherMoney),
      monthlyFunds: objects(saved.monthlyFunds),
      dailyTargets: objects(saved.dailyTargets),
    };
  }

  // Merges into the stored record so fields this version does not know about are kept, not dropped.
  function saveState(storage, state) {
    try {
      const existing = readJson(storage, KEY);
      storage.setItem(KEY, JSON.stringify({ ...existing, ...state }));
      return true;
    } catch { return false; }
  }

  function loadInbox(storage) {
    const saved = readJson(storage, INBOX_KEY);
    const memory = saved.memory && typeof saved.memory === 'object' && !Array.isArray(saved.memory) ? saved.memory : {};
    return {
      inbox: objects(saved.inbox),
      upcoming: objects(saved.upcoming),
      salary: objects(saved.salary),
      settle: objects(saved.settle),
      memory,
      dismissed: Array.isArray(saved.dismissed) ? saved.dismissed.filter(x => typeof x === 'string').slice(-MAX_DISMISSED) : [],
    };
  }

  function saveInbox(storage, data) {
    try {
      storage.setItem(INBOX_KEY, JSON.stringify({ ...data, dismissed: (data.dismissed || []).slice(-MAX_DISMISSED) }));
      return true;
    } catch { return false; }
  }

  // Your answers to "move yesterday's leftover to a goal?", and the day Pocket first started tracking.
  function loadSweeps(storage) {
    const saved = readJson(storage, SWEEP_KEY);
    const decided = saved.decided && typeof saved.decided === 'object' && !Array.isArray(saved.decided) ? saved.decided : {};
    return { decided, trackedSince: /^\d{4}-\d{2}-\d{2}$/.test(saved.trackedSince || '') ? saved.trackedSince : '' };
  }

  function saveSweeps(storage, data) {
    try {
      const recent = Object.keys(data.decided || {}).sort().slice(-MAX_DECIDED);
      storage.setItem(SWEEP_KEY, JSON.stringify({ trackedSince: data.trackedSince || '', decided: Object.fromEntries(recent.map(day => [day, data.decided[day]])) }));
      return true;
    } catch { return false; }
  }

  // Scheduled bills and which occurrences are paid: { bills: [...], paid: { 'billId|date': 'date paid' } }
  function loadBills(storage) {
    const saved = readJson(storage, BILLS_KEY);
    const paid = saved.paid && typeof saved.paid === 'object' && !Array.isArray(saved.paid) ? saved.paid : {};
    return { bills: objects(saved.bills), paid };
  }
  function saveBills(storage, data) {
    try { storage.setItem(BILLS_KEY, JSON.stringify({ bills: data.bills || [], paid: data.paid || {} })); return true; }
    catch { return false; }
  }

  // What other people owe you: { debts: [...] } (see owed.js)
  function loadOwed(storage) {
    const saved = readJson(storage, OWED_KEY);
    return { debts: objects(saved.debts).map(d => ({ ...d, payments: objects(d.payments) })) };
  }
  function saveOwed(storage, data) {
    try { storage.setItem(OWED_KEY, JSON.stringify({ debts: data.debts || [] })); return true; }
    catch { return false; }
  }

  // The app lock: which method, and the hashed PIN or pattern (see applock.js). method '' means it has not been set up yet.
  const credential = value => (value && typeof value === 'object' && typeof value.hash === 'string' && typeof value.salt === 'string' ? { salt: value.salt, iterations: Number(value.iterations) || 100000, hash: value.hash } : null);
  function loadLock(storage) {
    const saved = readJson(storage, LOCK_KEY);
    const method = ['pin', 'pattern', 'fingerprint', 'none'].includes(saved.method) ? saved.method : '';
    return { method, pin: credential(saved.pin), pattern: credential(saved.pattern), failures: Math.max(0, Math.floor(Number(saved.failures) || 0)), until: Math.max(0, Number(saved.until) || 0) };
  }
  function saveLock(storage, lock) {
    try { storage.setItem(LOCK_KEY, JSON.stringify({ method: lock.method, pin: lock.pin || null, pattern: lock.pattern || null, failures: lock.failures || 0, until: lock.until || 0 })); return true; }
    catch { return false; }
  }

  // Budgets with their own money, and the money added to them: { pots: [...], topUps: [...] } (see pots.js)
  function loadPots(storage) {
    const saved = readJson(storage, POTS_KEY);
    return { pots: objects(saved.pots), topUps: objects(saved.topUps) };
  }
  function savePots(storage, data) {
    try { storage.setItem(POTS_KEY, JSON.stringify({ pots: data.pots || [], topUps: data.topUps || [] })); return true; }
    catch { return false; }
  }

  // Cash in hand: { manual: [{ id, amount, date }], dismissed: [expenseId] } (see cash.js)
  function loadCash(storage) {
    const saved = readJson(storage, CASH_KEY);
    return { manual: objects(saved.manual), dismissed: Array.isArray(saved.dismissed) ? saved.dismissed.filter(x => typeof x === 'string').slice(-MAX_DISMISSED) : [] };
  }
  function saveCash(storage, data) {
    try { storage.setItem(CASH_KEY, JSON.stringify({ manual: data.manual || [], dismissed: (data.dismissed || []).slice(-MAX_DISMISSED) })); return true; }
    catch { return false; }
  }

  // Bank accounts and their last known balance: { accounts: [...], hidden: ['1234'] } (see accounts.js)
  function loadAccounts(storage) {
    const saved = readJson(storage, ACCOUNTS_KEY);
    return { accounts: objects(saved.accounts), hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(x => typeof x === 'string') : [] };
  }
  function saveAccounts(storage, data) {
    try { storage.setItem(ACCOUNTS_KEY, JSON.stringify({ accounts: data.accounts || [], hidden: data.hidden || [] })); return true; }
    catch { return false; }
  }

  // How the budgeting period is counted and how the app looks: { mode: 'month' | 'payday', paydayDay: 1..31, theme: 'auto' | 'light' | 'dark', lock: true | false, widgetAmounts: true | false, lowBalance: rupees to keep after bills (0 = only warn when short), todayMode: 'month' | 'period', planId: the plan shown in 'period', profile: { name, phone, email }, hideAmounts: true | false, budgetFrom: the day the monthly budget was first set, recapSeen: the day the weekly card was last put away, recurringDismissed: [keys of repeating payments you said no to], specificMode: 'inside' (specific budgets are cut from the monthly budget) | 'extra' (kept apart, on top of it) }
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const cleanProfile = value => { const p = value && typeof value === 'object' ? value : {}; return { name: text(p.name, 40), phone: text(p.phone, 15), email: text(p.email, 80) }; };
  function loadSettings(storage) {
    const saved = readJson(storage, SETTINGS_KEY);
    const day = Math.round(Number(saved.paydayDay));
    return { mode: saved.mode === 'payday' ? 'payday' : 'month', paydayDay: day >= 1 && day <= 31 ? day : 1, theme: ['light', 'dark'].includes(saved.theme) ? saved.theme : 'auto', lock: saved.lock === true, widgetAmounts: saved.widgetAmounts !== false, lowBalance: Math.max(0, Number(saved.lowBalance) || 0), todayMode: saved.todayMode === 'period' ? 'period' : 'month', planId: typeof saved.planId === 'string' ? saved.planId : '', profile: cleanProfile(saved.profile), hideAmounts: saved.hideAmounts === true, budgetFrom: /^\d{4}-\d{2}-\d{2}$/.test(saved.budgetFrom || '') ? saved.budgetFrom : '', recapSeen: typeof saved.recapSeen === 'string' ? saved.recapSeen : '', recurringDismissed: Array.isArray(saved.recurringDismissed) ? saved.recurringDismissed.filter(x => typeof x === 'string').slice(-100) : [], specificMode: saved.specificMode === 'extra' ? 'extra' : 'inside' };
  }
  function saveSettings(storage, settings) {
    try { storage.setItem(SETTINGS_KEY, JSON.stringify({ mode: settings.mode === 'payday' ? 'payday' : 'month', paydayDay: Number(settings.paydayDay) || 1, theme: ['light', 'dark'].includes(settings.theme) ? settings.theme : 'auto', lock: settings.lock === true, widgetAmounts: settings.widgetAmounts !== false, lowBalance: Math.max(0, Number(settings.lowBalance) || 0), todayMode: settings.todayMode === 'period' ? 'period' : 'month', planId: typeof settings.planId === 'string' ? settings.planId : '', profile: cleanProfile(settings.profile), hideAmounts: settings.hideAmounts === true, budgetFrom: /^\d{4}-\d{2}-\d{2}$/.test(settings.budgetFrom || '') ? settings.budgetFrom : '', recapSeen: typeof settings.recapSeen === 'string' ? settings.recapSeen : '', recurringDismissed: Array.isArray(settings.recurringDismissed) ? settings.recurringDismissed.filter(x => typeof x === 'string').slice(-100) : [], specificMode: settings.specificMode === 'extra' ? 'extra' : 'inside' })); return true; }
    catch { return false; }
  }

  // Recently deleted: [{ id, kind: 'goal' | 'plan' | 'budget', title, deletedAt, data }], newest first, nothing older than 30 days.
  const TRASH_DAYS = 30, TRASH_MAX = 50;
  function loadTrash(storage, now = Date.now()) {
    const saved = readJson(storage, TRASH_KEY), limit = now - TRASH_DAYS * 86400000;
    return (Array.isArray(saved.items) ? saved.items : [])
      .filter(e => e && typeof e === 'object' && typeof e.id === 'string' && ['goal', 'plan', 'budget'].includes(e.kind) && e.data && typeof e.data === 'object' && Number(e.deletedAt) > limit)
      .sort((a, b) => b.deletedAt - a.deletedAt).slice(0, TRASH_MAX);
  }
  function saveTrash(storage, items) {
    try { storage.setItem(TRASH_KEY, JSON.stringify({ items: (items || []).slice(0, TRASH_MAX) })); return true; }
    catch { return false; }
  }

  const api = { KEY, INBOX_KEY, SWEEP_KEY, BILLS_KEY, OWED_KEY, ACCOUNTS_KEY, POTS_KEY, CASH_KEY, LOCK_KEY, SETTINGS_KEY, TRASH_KEY, loadTrash, saveTrash, loadLock, saveLock, loadPots, savePots, loadCash, saveCash, loadAccounts, saveAccounts, loadBills, saveBills, loadOwed, saveOwed, loadSettings, saveSettings, loadState, saveState, loadInbox, saveInbox, loadSweeps, saveSweeps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
