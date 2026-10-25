// A read-only self-check for test builds: walks through every screen and checks that it really works on this phone's
// web view (screens show, nothing scrolls sideways, the tab bar is on screen, fonts and date inputs work) and that the
// calculation modules give the right answers here. It changes none of your data: it only moves between screens and reads.
(function (root) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const VIEWS = ['today', 'add', 'review', 'goals', 'history', 'bills', 'accounts', 'cash', 'settings', 'more'];

  async function run() {
    const results = [];
    const add = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: detail || '' });
    const errors = [];
    const onError = event => errors.push(String(event.message || event.error || 'error'));
    root.addEventListener('error', onError);
    const startHash = root.location.hash;

    // --- every module loaded (a script that fails while loading never defines itself) ---
    const modules = ['ExpenseUtils', 'SmsParser', 'BudgetMath', 'Goals', 'Cycle', 'Bills', 'Owed', 'Accounts', 'Pots', 'Statement', 'Pace', 'Recap', 'Recurring', 'Cash', 'Upi', 'Salary', 'ExtrasBridge', 'AppLock', 'LockUI', 'Sweep', 'Afford', 'Expenses', 'Insights', 'Backup', 'Inbox', 'SmsBridge', 'Store', 'PocketLock'];
    const missing = modules.filter(name => typeof root[name] !== 'object');
    add('All modules loaded', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${modules.length} modules`);

    // --- the phone's web view ---
    const chrome = /Chrome\/([\d.]+)/.exec(root.navigator.userAgent);
    add('Web view', Boolean(chrome), `Chrome ${chrome ? chrome[1] : '?'}, screen ${root.innerWidth}×${root.innerHeight} at ${root.devicePixelRatio}x`);
    add('Dialogs (used by Budget and Goals)', typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function');
    const probe = document.createElement('input'); probe.type = 'date';
    add('Date pickers', probe.type === 'date');
    add('Safe-area spacing (CSS env)', Boolean(root.CSS && CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)')));
    add('Indian number format', new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(1234567).includes('12,34,567'));
    try { localStorage.setItem('__pocket_selfcheck', '1'); const ok = localStorage.getItem('__pocket_selfcheck') === '1'; localStorage.removeItem('__pocket_selfcheck'); add('Saving on the phone', ok); }
    catch (error) { add('Saving on the phone', false, String(error.message || error)); }
    try { await document.fonts.ready; add('Bundled fonts', document.fonts.check('700 16px Manrope') && document.fonts.check('400 16px "DM Sans"')); }
    catch (error) { add('Bundled fonts', false, String(error.message || error)); }

    // --- every screen ---
    for (const view of VIEWS) {
      root.location.hash = `#${view}`;
      await wait(350);
      const section = document.getElementById(`view-${view}`);
      const rect = section ? section.getBoundingClientRect() : { height: 0 };
      const heading = document.getElementById(`h-${view}`);
      const tabbar = document.querySelector('.tabbar').getBoundingClientRect();
      add(`Screen: ${view}`, section && !section.classList.contains('hidden') && rect.height > 80 && heading && heading.textContent.trim().length > 0, `${Math.round(rect.height)}px tall`);
      add(`No sideways scrolling: ${view}`, document.documentElement.scrollWidth <= root.innerWidth + 1, `${document.documentElement.scrollWidth} wide in a ${root.innerWidth} screen`);
      add(`Tab bar on screen: ${view}`, tabbar.height > 40 && tabbar.bottom <= root.innerHeight + 1 && tabbar.top > 0, `bottom edge at ${Math.round(tabbar.bottom)} of ${root.innerHeight}`);
    }
    root.location.hash = startHash || '#today';
    await wait(250);

    // --- the calculation modules, on this phone's JavaScript engine ---
    const check = (name, fn) => { try { const out = fn(); add(name, out === true, out === true ? '' : String(out)); } catch (error) { add(name, false, String(error.message || error)); } };
    check('Daily amount maths', () => { const r = BudgetMath.safeToSpend({ month: '2026-10', today: '2026-10-22', budget: 22000, expenses: [] }); return r.allowanceToday === 2200 || r.allowanceToday; });
    check('Payday cycle', () => { const c = Cycle.cycleFor('2026-10-22', { mode: 'payday', paydayDay: 25 }); return (c.start === '2026-09-25' && c.end === '2026-10-24') || `${c.start} to ${c.end}`; });
    check('Reads a bank debit message', () => { const r = SmsParser.parseBankSms('Dear UPI user A/C X1234 debited by 24.00 on date 21Oct26 trf to Test Shop Refno 111111111111', { receivedAt: new Date(2026, 9, 22).getTime() }); return (r.kind === 'debit' && r.amount === 24 && r.date === '2026-10-21') || JSON.stringify(r); });
    check('Reads an upcoming-bill message', () => { const r = SmsParser.parseBankSms('Ur upcoming mandate is set 19-10-2026 and ur A/c will be DR with Rs. 123.00 towards Flipkart Ref- YJP9b955757a31a46dcbe94e7b7d4912050', { receivedAt: new Date(2026, 9, 12).getTime() }); return (r.kind === 'upcoming' && r.amount === 123) || JSON.stringify(r); });
    check('Spots a salary credit', () => { const r = SmsParser.parseBankSms('Your A/c XXXXXX1234 has been credited with INR 45,000.00 on 20-10-26 towards SALARY OCT 2026', { receivedAt: new Date(2026, 9, 22).getTime() }); return (r.kind === 'credit' && r.salary === true) || JSON.stringify(r); });
    check('Who owes me', () => { const e = { id: 'e', amount: 100, date: '2026-10-01' }; const r = Owed.addDebts([], e, [{ person: 'A', amount: 40 }], {}); const share = ExpenseUtils.spendOf(Owed.annotate([e], r.debts)[0]); return (r.ok && share === 60) || `share ${share}`; });
    check('Account balances', () => { const o = Accounts.outlook({ accounts: [{ key: '1', balance: 100, include: true, asOf: '2026-10-22' }] }, [{ amount: 150, date: '2026-10-25' }], {}); const bal = SmsParser.extractBalance('Debited Rs 5 on 22-10-26. Avl Bal Rs 1,234.50'); return (o.status === 'short' && o.shortBy === 50 && bal === 1234.5) || `${o.status} ${bal}`; });
    check('Budgets', () => { const d = Pots.createPot({ pots: [], topUps: [] }, { name: 'Shopping', limit: 100, categories: ['Shopping'] }).data; const v = Pots.spendingView([{ id: 'x', amount: 130, category: 'Shopping', date: '2026-10-05', description: 'Bag' }], d, { start: '2026-10-01', end: '2026-10-31' }); return (v.expenses[0].amount === 30 && v.pots[0].over === 30) || `${v.expenses[0].amount}`; });
    check('Bills matching', () => { const bill = Bills.createBill({ title: 'Rent', amount: 1000, dueDate: '2026-10-25', repeat: 'once' }).bill; const rows = Bills.billOccurrences({ bills: [bill], paid: {}, expenses: [{ id: 'x', date: '2026-10-24', amount: 1000, description: 'Rent' }], start: '2026-10-01', end: '2026-10-31', today: '2026-10-26' }); return rows[0].state === 'paid' || rows[0].state; });

    check('Editing an expense', () => { const r = Expenses.editExpense([{ id: 'a', amount: 10, description: 'x', category: 'Food', date: '2026-10-20' }], 'a', { amount: 12 }); return (r.ok && r.expense.amount === 12) || JSON.stringify(r); });
    check('History summary', () => { const s = Insights.summarize([{ id: 'a', amount: 100, category: 'Food', date: '2026-10-05' }, { id: 'b', amount: 300, category: 'Travel', date: '2026-10-06' }], Cycle.cycleFor('2026-10-15', {}), {}, '2026-10-20'); return (s.total === 400 && s.byCategory[0].category === 'Travel') || JSON.stringify(s.byCategory); });
    check('Backup and restore round trip', () => {
      const mem = {}; const fake = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
      fake.setItem(Store.KEY, JSON.stringify({ budget: 5, expenses: [{ id: 'a', amount: 1 }], plans: [] }));
      const file = Backup.buildBackup(fake); delete mem[Store.KEY];
      const r = Backup.restoreBackup(fake, file);
      return (r.ok && JSON.parse(mem[Store.KEY]).budget === 5) || JSON.stringify(r);
    });
    check('Hinglish quick entry', () => { const r = ExpenseUtils.parseNaturalExpense('sabzi 150 kal', new Date(2026, 9, 22)); return (r.ok && r.expense.amount === 150 && r.expense.category === 'Food' && r.expense.date === '2026-10-21') || JSON.stringify(r); });

    add('No script errors during the check', errors.length === 0, errors.slice(0, 3).join(' | '));
    root.removeEventListener('error', onError);
    return results;
  }

  root.SelfCheck = { run };
})(typeof globalThis !== 'undefined' ? globalThis : this);
