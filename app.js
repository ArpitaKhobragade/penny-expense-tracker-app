(() => {
  const U = window.ExpenseUtils;
  const STORAGE_KEY = 'pocket-expense-tracker-v1';
  const CATEGORY_META = { Food:['☕','#e6f2e9'],Travel:['↗','#e8f0fb'],Shopping:['◇','#f7eee7'],Bills:['▤','#f1edfa'],Health:['＋','#fceeed'],Education:['▧','#edf3fa'],Entertainment:['♫','#f9eff7'],Other:['•','#f1f3f1'] };
  const $ = id => document.getElementById(id);
  const monthPicker = $('month-picker');
  const today = new Date();
  let state = loadState();
  let toastTimer;
  let contributionFormPlanId = null;
  monthPicker.value = U.formatDate(today).slice(0, 7);
  $('expense-date').value = U.formatDate(today);
  $('today-label').textContent = today.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long' }).toUpperCase();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        budget: Number(saved.budget) || 0,
        expenses: Array.isArray(saved.expenses) ? saved.expenses.filter(x => x && typeof x === 'object') : [],
        plans: Array.isArray(saved.plans) ? saved.plans.filter(x => x && typeof x === 'object').map((plan, planIndex) => ({ ...plan, contributions: Array.isArray(plan.contributions) ? plan.contributions.map((item, itemIndex) => ({ ...item, id: item.id || `legacy-${plan.id || planIndex}-${item.createdAt || itemIndex}` })) : [] })) : [],
        otherMoney: Array.isArray(saved.otherMoney) ? saved.otherMoney.filter(x => x && typeof x === 'object') : [],
        monthlyFunds: Array.isArray(saved.monthlyFunds) ? saved.monthlyFunds.filter(x => x && typeof x === 'object') : [],
        dailyTargets: Array.isArray(saved.dailyTargets) ? saved.dailyTargets.filter(x => x && typeof x === 'object') : []
      };
    } catch { return { budget: 0, expenses: [], plans: [], otherMoney: [], monthlyFunds: [], dailyTargets: [] }; }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch { showToast('Could not save. Check your browser storage settings.'); return false; }
  }
  function money(value) { return new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:2, minimumFractionDigits: value % 1 ? 2 : 0 }).format(value); }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fundsForMonth(month) { return (state.monthlyFunds || []).filter(item => String(item.date || '').slice(0,7) === month); }
  function monthlyFundsTotal(month) { return fundsForMonth(month).reduce((sum, item) => sum + (Number(item.amount) || 0), 0); }
  function currentSummary() { return U.calculateSummary(state.expenses, Math.max(0, Number(state.budget) || 0) + monthlyFundsTotal(monthPicker.value), monthPicker.value); }
  function render() {
    const summary = currentSummary();
    $('budget-value').textContent = money(summary.budget);
    $('spent-value').textContent = money(summary.spent);
    $('spent-foot').textContent = `Across ${summary.count} transaction${summary.count === 1 ? '' : 's'}`;
    $('remaining-value').textContent = money(summary.remaining);
    $('remaining-value').style.color = summary.remaining < 0 ? 'var(--coral)' : 'var(--green)';
    $('remaining-foot').textContent = summary.remaining < 0 ? `${money(Math.abs(summary.remaining))} over budget` : summary.budget ? 'Available for the rest of the month' : 'Set a budget to get started';
    const pct = summary.budget ? summary.spent / summary.budget * 100 : 0;
    $('progress-percent').textContent = `${Math.round(pct)}%`;
    $('progress-caption').textContent = !summary.budget ? 'Set a budget to track your progress.' : pct > 100 ? 'You have gone over your monthly budget.' : `${money(summary.spent)} of ${money(summary.budget)} used`;
    $('progress-fill').style.width = `${Math.min(100, Math.max(0, pct))}%`;
    $('progress-fill').classList.toggle('over-budget', pct > 100);
    $('budget-remaining-caption').textContent = summary.budget ? `${money(summary.remaining)} ${summary.remaining < 0 ? 'over budget' : 'left to spend'}` : 'No budget set';
    renderCategories(summary.expenses, summary.spent);
    renderTransactions(summary.expenses);
    renderPlans();
    renderOtherMoney();
    renderMonthlyFunds();
    renderDailyTargets();
  }
  function renderCategories(expenses, total) {
    const sums = {};
    expenses.forEach(item => sums[item.category] = (sums[item.category] || 0) + Number(item.amount || 0));
    const entries = Object.entries(sums).sort((a,b) => b[1] - a[1]);
    if (!entries.length) { $('category-breakdown').innerHTML = '<div class="empty-state small-empty"><span>◌</span><p>Your spending categories will show up here.</p></div>'; return; }
    $('category-breakdown').innerHTML = entries.map(([name, amount]) => {
      const meta = CATEGORY_META[name] || CATEGORY_META.Other;
      const width = total ? amount / total * 100 : 0;
      return `<div class="category-row"><div class="category-name"><span class="category-symbol" style="background:${meta[1]}">${meta[0]}</span>${escapeHTML(name)}</div><div class="category-track"><div class="category-fill" style="width:${width}%"></div></div><div class="category-amount">${money(amount)}</div></div>`;
    }).join('');
  }
  function renderTransactions(expenses) {
    const filter = $('category-filter').value;
    const items = expenses.filter(item => filter === 'All' || item.category === filter).sort((a,b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    $('transaction-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      $('transaction-list').innerHTML = `<div class="empty-state"><div class="empty-illustration">↗</div><h3>${filter === 'All' ? 'No expenses yet' : 'No matching expenses'}</h3><p>${filter === 'All' ? 'Add your first expense and your monthly picture will appear here.' : 'Try another category filter.'}</p></div>`; return;
    }
    $('transaction-list').innerHTML = items.map(item => {
      const meta = CATEGORY_META[item.category] || CATEGORY_META.Other;
      const date = new Date(`${item.date}T12:00:00`).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
      return `<div class="transaction-row"><div class="transaction-symbol" style="background:${meta[1]}">${meta[0]}</div><div class="transaction-info"><div class="transaction-title">${escapeHTML(item.description)}</div><div class="transaction-meta">${escapeHTML(item.category)} · ${date}</div></div><div class="transaction-amount">−${money(Number(item.amount))}</div><button class="delete-button" type="button" data-delete="${escapeHTML(item.id)}" aria-label="Delete ${escapeHTML(item.description)}" title="Delete expense">×</button></div>`;
    }).join('');
  }
  function showToast(message) {
    const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function addExpense(expense) {
    const amount = Number(expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    state.expenses.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, amount: Math.round(amount * 100) / 100, description: String(expense.description || 'Expense').trim().slice(0,100) || 'Expense', category: U.CATEGORIES.includes(expense.category) ? expense.category : 'Other', date: /^\d{4}-\d{2}-\d{2}$/.test(expense.date) ? expense.date : U.formatDate(new Date()), createdAt: Date.now() });
    saveState(); render(); return true;
  }
  function setEntryMode(mode) {
    const formMode = mode === 'form';
    $('expense-form').classList.toggle('hidden', !formMode); $('natural-form').classList.toggle('hidden', formMode);
    $('form-tab').classList.toggle('active', formMode); $('text-tab').classList.toggle('active', !formMode);
    $('form-tab').setAttribute('aria-selected', String(formMode)); $('text-tab').setAttribute('aria-selected', String(!formMode));
  }
  $('expense-form').addEventListener('submit', event => {
    event.preventDefault();
    const amount = Number($('amount').value);
    if (!Number.isFinite(amount) || amount <= 0) { $('form-message').textContent = 'Please enter an amount greater than zero.'; return; }
    addExpense({ amount, description:$('description').value, category:$('category').value, date:$('expense-date').value });
    $('expense-form').reset(); $('expense-date').value = U.formatDate(new Date()); $('form-message').textContent = 'Expense added successfully.'; showToast('Expense added'); $('description').focus();
  });
  $('form-tab').addEventListener('click', () => setEntryMode('form'));
  $('text-tab').addEventListener('click', () => setEntryMode('text'));
  $('natural-input').addEventListener('input', () => {
    const result = U.parseNaturalExpense($('natural-input').value);
    const preview = $('parsed-preview');
    if (result.ok) { preview.classList.remove('hidden'); preview.textContent = `Detected: ${money(result.expense.amount)} · ${result.expense.description} · ${result.expense.category} · ${result.expense.date}`; $('natural-message').textContent = ''; }
    else { preview.classList.add('hidden'); $('natural-message').textContent = $('natural-input').value.trim() ? result.error : ''; }
  });
  $('natural-form').addEventListener('submit', event => {
    event.preventDefault(); const result = U.parseNaturalExpense($('natural-input').value);
    if (!result.ok) { $('natural-message').textContent = result.error; return; }
    addExpense(result.expense); $('natural-input').value = ''; $('parsed-preview').classList.add('hidden'); $('natural-message').textContent = 'Expense added successfully.'; showToast('Expense added');
  });
  $('edit-budget-btn').addEventListener('click', () => { $('budget-input').value = state.budget || ''; $('budget-dialog').showModal(); $('budget-input').focus(); });
  function closeBudget() { $('budget-dialog').close(); }
  $('close-budget').addEventListener('click', closeBudget); $('cancel-budget').addEventListener('click', closeBudget);
  $('budget-form').addEventListener('submit', event => {
    event.preventDefault(); const value = Number($('budget-input').value);
    if (!Number.isFinite(value) || value < 0) return;
    state.budget = Math.round(value * 100) / 100; saveState(); render(); closeBudget(); showToast('Monthly budget saved');
  });
  $('budget-dialog').addEventListener('click', event => { if (event.target === $('budget-dialog')) closeBudget(); });
  monthPicker.addEventListener('change', render); $('category-filter').addEventListener('change', () => renderTransactions(currentSummary().expenses));
  $('transaction-list').addEventListener('click', event => {
    const button = event.target.closest('[data-delete]'); if (!button) return;
    const item = state.expenses.find(x => x.id === button.dataset.delete); if (!item) return;
    state.expenses = state.expenses.filter(x => x.id !== item.id); saveState(); render(); showToast('Expense deleted');
  });
  $('export-btn').addEventListener('click', () => {
    const summary = currentSummary();
    const rows = [['Date','Description','Category','Amount (INR)'], ...summary.expenses.map(x => [x.date, x.description, x.category, Number(x.amount).toFixed(2)])];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `pocket-expenses-${monthPicker.value}.csv`; a.click(); URL.revokeObjectURL(url); showToast('CSV export ready');
  });
  $('clear-btn').addEventListener('click', () => {
    const footer = document.querySelector('.page-footer');
    let confirmation = $('clear-confirmation');
    if (confirmation) { confirmation.remove(); return; }
    confirmation = document.createElement('div');
    confirmation.id = 'clear-confirmation';
    confirmation.className = 'inline-confirmation';
    confirmation.innerHTML = '<span>This permanently clears all saved data in this browser. Export a CSV first if needed.</span><button type="button" class="secondary-button" data-cancel-clear>Cancel</button><button type="button" class="primary-button" data-confirm-clear>Clear data</button>';
    footer.insertAdjacentElement('beforebegin', confirmation);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-cancel-clear]')) { $('clear-confirmation')?.remove(); return; }
    if (!event.target.closest('[data-confirm-clear]')) return;
    state = { budget:0, expenses:[], plans:[], otherMoney:[], monthlyFunds:[], dailyTargets:[] };
    contributionFormPlanId = null; saveState(); $('clear-confirmation')?.remove(); render(); showToast('Local data cleared');
  });


  function renderMonthlyFunds() {
    const month = monthPicker.value;
    const records = fundsForMonth(month).slice().sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    const total = monthlyFundsTotal(month);
    $('monthly-added-total').textContent = `${money(total)} added`;
    const host = $('monthly-fund-history');
    if (!records.length) {
      host.innerHTML = '<p class="monthly-fund-empty">No extra funds added for this month yet.</p>';
      return;
    }
    host.innerHTML = records.map(item => {
      const date = item.date ? new Date(`${item.date}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : 'Date not recorded';
      return `<div class="monthly-fund-row"><div><strong>${escapeHTML(item.note || 'Extra monthly funds')}</strong><span>${escapeHTML(date)}</span></div><b>+${money(Number(item.amount)||0)}</b><button type="button" class="record-delete" data-delete-monthly-fund="${escapeHTML(item.id)}" aria-label="Delete monthly fund">×</button></div>`;
    }).join('');
  }
  $('monthly-fund-date').value = U.formatDate(new Date());
  $('monthly-fund-form').addEventListener('submit', event => {
    event.preventDefault();
    const amount = Number($('monthly-fund-amount').value);
    const note = $('monthly-fund-note').value.trim();
    const date = $('monthly-fund-date').value || U.formatDate(new Date());
    if (!Number.isFinite(amount) || amount <= 0) { showToast('Enter an amount greater than zero'); return; }
    state.monthlyFunds = Array.isArray(state.monthlyFunds) ? state.monthlyFunds : [];
    state.monthlyFunds.push({ id:newId(), amount:Math.round(amount*100)/100, note:note.slice(0,100), date, createdAt:Date.now() });
    saveState(); render(); $('monthly-fund-form').reset(); $('monthly-fund-date').value = U.formatDate(new Date());
    showToast('Funds added to this month’s budget');
  });
  $('monthly-fund-history').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-monthly-fund]');
    if (!button) return;
    const record = state.monthlyFunds.find(item => item.id === button.dataset.deleteMonthlyFund);
    if (!record) return;
    state.monthlyFunds = state.monthlyFunds.filter(item => item.id !== record.id);
    saveState(); render(); showToast('Monthly fund entry removed');
  });


  function localToday() { return U.formatDate(new Date()); }
  function dateRange(start, end) {
    const dates = [];
    const cursor = new Date(`${start}T12:00:00`);
    const last = new Date(`${end}T12:00:00`);
    if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(last.getTime()) || last < cursor) return dates;
    while (cursor <= last && dates.length < 370) {
      dates.push(localDateString(cursor));
      cursor.setDate(cursor.getDate()+1);
    }
    return dates;
  }
  function spentOnDate(date) {
    return (state.expenses || []).filter(item => item.date === date).reduce((sum,item) => sum + (Number(item.amount)||0),0);
  }
  function renderDailyTargets() {
    const today = localToday();
    const todaySpent = spentOnDate(today);
    const page = document.body.dataset.page || 'monthly';
    const allTargets = Array.isArray(state.dailyTargets) ? state.dailyTargets : [];
    const targets = allTargets.filter(t => page === 'period' ? t.mode === 'period' : page === 'monthly' ? t.mode === 'today' : false);
    const todayTarget = page === 'period'
      ? targets.filter(t => t.startDate <= today && t.endDate >= today).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0]
      : targets.find(t => t.mode === 'today' && t.startDate === today);
    let limit = todayTarget ? Number(todayTarget.amount)||0 : 0;
    if (todayTarget && page === 'period') {
      const dates = dateRange(todayTarget.startDate, todayTarget.endDate);
      const spentBeforeToday = dates.filter(date => date < today).reduce((sum,date)=>sum+spentOnDate(date),0);
      const remainingDays = Math.max(1, dates.filter(date => date >= today).length);
      limit = Math.max(0, (Number(todayTarget.amount)||0) - spentBeforeToday) / remainingDays;
    }
    const left = limit - todaySpent;
    $('daily-limit-value').textContent = todayTarget ? money(limit) : 'Not set';
    $('daily-spent-value').textContent = money(todaySpent);
    $('daily-left-value').textContent = todayTarget ? money(left) : '—';
    $('daily-left-value').style.color = todayTarget && left < 0 ? 'var(--coral)' : 'var(--green)';
    $('daily-remaining-badge').textContent = todayTarget ? (left < 0 ? `${money(Math.abs(left))} over limit` : `${money(left)} left today`) : 'Set a daily limit';
    $('daily-remaining-badge').classList.toggle('over-limit', Boolean(todayTarget && left < 0));
    $('daily-progress-fill').style.width = `${todayTarget ? Math.min(100, limit ? todaySpent/limit*100 : 0) : 0}%`;
    $('daily-progress-fill').style.background = todayTarget && left < 0 ? 'var(--coral)' : '#4c9b70';

    const host = $('daily-target-history');
    if (!targets.length) {
      host.innerHTML = '<p class="monthly-fund-empty">No target saved on this page yet. Add one above to begin tracking day by day.</p>';
      return;
    }
    host.innerHTML = targets.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(target => {
      const dates = target.mode === 'today' ? [target.startDate] : dateRange(target.startDate,target.endDate);
      const totalSpent = dates.reduce((sum,date)=>sum+spentOnDate(date),0);
      const targetTotal = Number(target.amount)||0;
      const dailyAllowance = target.mode === 'today' ? targetTotal : targetTotal / Math.max(1, dates.length);
      const remaining = targetTotal-totalSpent;
      const pct = targetTotal ? totalSpent/targetTotal*100 : 0;
      const startLabel = target.startDate ? new Date(`${target.startDate}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '';
      const endLabel = target.endDate ? new Date(`${target.endDate}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : startLabel;
      const label = target.note || (target.mode === 'today' ? 'Daily spending limit' : 'Period daily target');
      const periodLength = dates.length;
      const daysHtml = target.mode === 'period' ? `<div class="daily-day-list">${dates.map(date=>{
        const amount = spentOnDate(date);
        const spentBeforeDate = dates.filter(d => d < date).reduce((sum,d)=>sum+spentOnDate(d),0);
        const remainingDays = Math.max(1, dates.filter(d => d >= date).length);
        const dayAllowance = Math.max(0, (targetTotal - spentBeforeDate) / remainingDays);
        const dayLeft = dayAllowance - amount;
        const dateText = new Date(`${date}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
        const isToday = date === today;
        return `<div class="daily-day-item ${dayLeft<0?'over-limit':''} ${isToday?'is-today':''}">
          <span>${escapeHTML(dateText)}${isToday?' · Today':''}</span><strong>${money(amount)} spent</strong>
          <small>${dayLeft<0?money(Math.abs(dayLeft))+' over today’s guide':money(dayLeft)+' left for this day'}</small>
          <form class="period-day-form" data-period-day-form="${escapeHTML(target.id)}" data-spend-date="${escapeHTML(date)}">
            <input name="dayAmount" type="number" min="0.01" step="0.01" placeholder="Amount spent (₹)" aria-label="Amount spent on ${escapeHTML(dateText)}" required />
            <input name="dayNote" type="text" maxlength="80" placeholder="What was it for? (optional)" aria-label="Description for ${escapeHTML(dateText)}" />
            <button type="submit" class="secondary-button">Add spending</button>
          </form>
        </div>`;
      }).join('')}</div>` : '';
      return `<article class="daily-target-card">
        <div class="daily-target-card-top"><div><div class="daily-target-card-title">${escapeHTML(label)}</div><div class="daily-target-card-dates">${escapeHTML(startLabel)}${target.mode==='period'?' – '+escapeHTML(endLabel):''}${target.mode==='period'?' · '+periodLength+' days · '+money(dailyAllowance)+'/day guide':''}</div></div><span class="deadline-chip ${remaining<0?'overdue':''}">${Math.round(pct)}% used</span></div>
        <div class="daily-target-card-values"><div><span>${target.mode==='today'?'Daily limit':'Total period target'}</span><strong>${money(targetTotal)}</strong></div><div><span>Spent in period</span><strong>${money(totalSpent)}</strong></div><div><span>${remaining<0?'Over target':'Remaining'}</span><strong style="color:${remaining<0?'var(--coral)':'var(--green)'}">${money(Math.abs(remaining))}</strong></div></div>
        <div class="daily-progress-track"><div class="daily-progress-fill" style="width:${Math.min(100,pct)}%;background:${remaining<0?'var(--coral)':'#4c9b70'}"></div></div>
        ${daysHtml}
        <div class="daily-target-actions"><button type="button" data-delete-daily-target="${escapeHTML(target.id)}">Delete target</button></div>
      </article>`;
    }).join('');
  }
  $('daily-target-start').value = localToday();
  $('daily-target-end').value = localToday();
  $('daily-target-mode').addEventListener('change', () => {
    const isPeriod = $('daily-target-mode').value === 'period';
    $('daily-target-end').closest('.field').classList.toggle('hidden', !isPeriod);
    $('daily-target-end').required = isPeriod;
  });
  $('daily-target-form').addEventListener('submit', event => {
    event.preventDefault();
    const mode = $('daily-target-mode').value;
    const amount = Number($('daily-target-amount').value);
    const startDate = $('daily-target-start').value;
    const endDate = mode === 'period' ? $('daily-target-end').value : startDate;
    const note = $('daily-target-note').value.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !startDate || (mode==='period' && (!endDate || endDate < startDate))) {
      showToast('Enter a valid target amount and date range'); return;
    }
    state.dailyTargets = Array.isArray(state.dailyTargets) ? state.dailyTargets : [];
    if (mode === 'today') state.dailyTargets = state.dailyTargets.filter(t => !(t.mode==='today' && t.startDate===startDate));
    state.dailyTargets.push({ id:newId(), mode, amount:Math.round(amount*100)/100, startDate, endDate, note:note.slice(0,80), createdAt:Date.now() });
    saveState(); renderDailyTargets(); $('daily-target-form').reset();
    $('daily-target-mode').value='today'; $('daily-target-start').value=localToday(); $('daily-target-end').value=localToday(); $('daily-target-end').required=false; $('daily-target-end').closest('.field').classList.add('hidden');
    showToast(mode==='today'?'Daily limit saved':'Period target saved');
  });
  $('daily-target-history').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-daily-target]');
    if (!button) return;
    const target = state.dailyTargets.find(item=>item.id===button.dataset.deleteDailyTarget);
    if (!target) return;
    state.dailyTargets = state.dailyTargets.filter(item=>item.id!==target.id);
    saveState(); renderDailyTargets(); showToast('Daily target deleted');
  });
  $('daily-target-history').addEventListener('submit', event => {
    const form = event.target.closest('[data-period-day-form]');
    if (!form) return;
    event.preventDefault();
    const amount = Number(form.elements.dayAmount.value);
    const date = form.dataset.spendDate;
    const target = state.dailyTargets.find(item => item.id === form.dataset.periodDayForm);
    if (!target || !Number.isFinite(amount) || amount <= 0 || !date) { showToast('Enter a valid spending amount'); return; }
    const note = form.elements.dayNote.value.trim();
    const label = note || (target.note ? `Period · ${target.note}` : 'Specific period spending');
    state.expenses.push({ id:newId(), amount:Math.round(amount*100)/100, description:label.slice(0,100), category:'Other', date, createdAt:Date.now(), sourceTargetId:target.id });
    saveState(); render(); showToast(`Spending added for ${new Date(`${date}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}`);
  });

  const PLAN_COLORS = ['#4c9b70', '#6b91c8', '#c08a59', '#9b83c6'];
  const OTHER_MONEY_LABELS = {
    received: { label:'Extra money received', sign:'+', flow:'inflow' },
    given: { label:'Given / lent to someone', sign:'−', flow:'outflow' },
    'set-aside': { label:'Set aside / allocated', sign:'−', flow:'outflow' },
    returned: { label:'Money returned to me', sign:'+', flow:'inflow' }
  };
  function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

  function localDateString(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function resolveDeadline(dateValue, daysValue, createdAt) {
    if (dateValue) return dateValue;
    const days = Number(daysValue);
    if (Number.isFinite(days) && days > 0) {
      const start = new Date(createdAt || Date.now());
      start.setHours(12,0,0,0);
      start.setDate(start.getDate() + Math.ceil(days));
      return localDateString(start);
    }
    return '';
  }
  function deadlineInfo(dateValue) {
    if (!dateValue) return { label:'No target date set', className:'' };
    const now = new Date(); now.setHours(0,0,0,0);
    const target = new Date(`${dateValue}T00:00:00`);
    const days = Math.ceil((target.getTime()-now.getTime())/86400000);
    const formatted = target.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
    if (days < 0) return { label:`Target date ${formatted} · ${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`, className:'overdue' };
    if (days === 0) return { label:`Target date ${formatted} · Due today`, className:'' };
    return { label:`Target date ${formatted} · ${days} day${days===1?'':'s'} remaining`, className:'' };
  }

  function renderPlans() {
    const host = $('plans-list');
    if (!state.plans.length) {
      host.innerHTML = '<div class="empty-state small-empty"><span>◎</span><p>Add a future goal to see how much you have saved and how much is left.</p></div>';
      return;
    }
    host.innerHTML = state.plans.slice().sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0)).map((plan, index) => {
      const target = Math.max(0, Number(plan.target) || 0);
      const saved = Math.max(0, Number(plan.saved) || 0);
      const remaining = Math.max(0, target - saved);
      const pct = target ? Math.min(100, saved / target * 100) : 0;
      const deadline = plan.targetDate || '';
      const deadlineStatus = deadlineInfo(deadline);
      const contributions = Array.isArray(plan.contributions) ? plan.contributions.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
      const contributionHistory = contributions.length
        ? `<details class="plan-history"><summary>View money added history (${contributions.length})</summary>${contributions.map(item => {
            const contributionDate = item.date ? new Date(`${item.date}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : 'Date not recorded';
            return `<div class="contribution-row"><div>Money added<span class="contribution-date">${escapeHTML(contributionDate)}</span></div><strong>+${money(Number(item.amount)||0)}</strong><button type="button" class="record-delete contribution-delete" data-delete-contribution="${escapeHTML(plan.id)}" data-contribution-id="${escapeHTML(item.id)}" aria-label="Remove this contribution">×</button></div>`;
          }).join('')}</details>`
        : `<details class="plan-history"><summary>View money added history (0)</summary><div class="contribution-row">No contributions recorded yet.</div></details>`;
      const color = PLAN_COLORS[index % PLAN_COLORS.length];
      return `<article class="plan-card">
        <div class="plan-top"><div><div class="plan-title">${escapeHTML(plan.title || 'Untitled plan')}</div><div class="plan-date">${deadline ? 'Deadline set' : 'No target date set'}</div></div><div class="plan-target">Goal ${money(target)}</div></div>
        <div class="deadline-line"><span class="deadline-chip ${deadlineStatus.className}">${escapeHTML(deadlineStatus.label)}</span></div>
        <div class="plan-values"><div><span>Saved so far</span><strong>${money(saved)}</strong></div><div class="left-value"><span>${remaining ? 'Still needed' : 'Goal achieved'}</span><strong style="color:${remaining ? 'var(--coral)' : 'var(--green)'}">${money(remaining)}</strong></div></div>
        <div class="plan-progress"><div class="plan-progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="plan-actions"><button type="button" data-contribute="${escapeHTML(plan.id)}">＋ Add money</button><button type="button" class="delete-plan" data-delete-plan="${escapeHTML(plan.id)}">Delete plan</button><span class="plan-target">${Math.round(pct)}% achieved</span></div>
        ${contributionFormPlanId === plan.id ? `<form class="contribution-entry-form" data-contribution-form="${escapeHTML(plan.id)}"><div class="field"><label>Amount to add (₹)</label><input name="contributionAmount" type="number" min="0.01" step="0.01" placeholder="e.g. 500" required /></div><div class="field"><label>Date added</label><input name="contributionDate" type="date" value="${localToday()}" required /></div><div class="contribution-form-actions"><button type="submit" class="primary-button">Save amount</button><button type="button" class="secondary-button" data-cancel-contribution>Cancel</button></div></form>` : ''}
        ${contributionHistory}
      </article>`;
    }).join('');
  }
  function renderOtherMoney() {
    const records = state.otherMoney.slice().sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    let received = 0, allocated = 0;
    state.otherMoney.forEach(item => {
      const amount = Number(item.amount) || 0;
      if (item.type === 'received' || item.type === 'returned') received += amount;
      else allocated += amount;
    });
    const balance = received - allocated;
    $('extra-received-total').textContent = money(received);
    $('extra-allocated-total').textContent = money(allocated);
    $('extra-balance-total').textContent = money(balance);
    $('extra-balance-total').style.color = balance < 0 ? 'var(--coral)' : 'var(--green)';
    const host = $('other-money-list');
    if (!records.length) {
      host.innerHTML = '<div class="empty-state small-empty"><span>↔</span><p>Records you add here will appear separately from monthly expenses.</p></div>';
      return;
    }
    host.innerHTML = records.map(item => {
      const meta = OTHER_MONEY_LABELS[item.type] || OTHER_MONEY_LABELS.received;
      const date = item.date ? new Date(`${item.date}T12:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '';
      const amount = Number(item.amount) || 0;
      const hasTarget = Number(item.targetAmount) > 0;
      const targetAmount = Number(item.targetAmount) || 0;
      const remaining = Math.max(0, targetAmount - amount);
      const targetPct = targetAmount ? Math.min(100, amount/targetAmount*100) : 0;
      const deadline = item.targetDate || '';
      const deadlineStatus = deadlineInfo(deadline);
      const progress = hasTarget ? `<div class="other-goal-progress"><div class="plan-values"><div><span>Tracked amount</span><strong>${money(amount)}</strong></div><div class="left-value"><span>${remaining ? 'Still needed' : 'Target achieved'}</span><strong style="color:${remaining ? 'var(--coral)' : 'var(--green)'}">${money(remaining)}</strong></div></div><div class="plan-progress"><div class="plan-progress-fill" style="width:${targetPct}%"></div></div><div class="deadline-line"><span>${Math.round(targetPct)}% of ${money(targetAmount)}</span>${deadline ? `<span class="deadline-chip ${deadlineStatus.className}">${escapeHTML(deadlineStatus.label)}</span>` : ''}</div></div>` : (deadline ? `<div class="deadline-line"><span class="deadline-chip ${deadlineStatus.className}">${escapeHTML(deadlineStatus.label)}</span></div>` : '');
      return `<div class="money-record"><div><div class="money-record-title">${escapeHTML(item.title || meta.label)}</div><div class="money-record-meta">${escapeHTML(meta.label)} · ${escapeHTML(date)}</div>${progress}</div><div class="money-record-amount ${meta.flow}">${meta.sign}${money(amount)}</div><button type="button" class="record-delete" data-delete-money="${escapeHTML(item.id)}" aria-label="Delete money record">×</button></div>`;
    }).join('');
  }
  $('plan-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('plan-title').value.trim();
    const target = Number($('plan-target').value);
    if (!title || !Number.isFinite(target) || target <= 0) { showToast('Enter a plan name and target above zero'); return; }
    const createdAt = Date.now();
    const targetDate = resolveDeadline($('plan-date').value, $('plan-days').value, createdAt);
    state.plans.push({ id:newId(), title:title.slice(0,80), target:Math.round(target*100)/100, saved:0, targetDate, contributions:[], createdAt });
    saveState(); renderPlans(); $('plan-form').reset(); showToast('Future plan created');
  });
  $('plans-list').addEventListener('click', event => {
    const contributeButton = event.target.closest('[data-contribute]');
    const deleteButton = event.target.closest('[data-delete-plan]');
    const deleteContribution = event.target.closest('[data-delete-contribution]');
    const cancelContribution = event.target.closest('[data-cancel-contribution]');
    if (contributeButton) {
      contributionFormPlanId = contributionFormPlanId === contributeButton.dataset.contribute ? null : contributeButton.dataset.contribute;
      renderPlans();
      const amountInput = $('plans-list').querySelector('[data-contribution-form] input[name="contributionAmount"]');
      if (amountInput) amountInput.focus();
    } else if (cancelContribution) {
      contributionFormPlanId = null; renderPlans();
    } else if (deleteContribution) {
      const plan = state.plans.find(item => item.id === deleteContribution.dataset.deleteContribution);
      const contributionId = deleteContribution.dataset.contributionId;
      if (!plan) return;
      const contributions = Array.isArray(plan.contributions) ? plan.contributions : [];
      const contribution = contributions.find(item => item.id === contributionId);
      if (!contribution) return;
      plan.contributions = contributions.filter(item => item.id !== contributionId);
      plan.saved = Math.max(0, Math.round((Number(plan.saved || 0) - Number(contribution.amount || 0))*100)/100);
      saveState(); renderPlans(); showToast('Money removed from this goal');
    } else if (deleteButton) {
      const plan = state.plans.find(item => item.id === deleteButton.dataset.deletePlan);
      if (!plan) return;
      state.plans = state.plans.filter(item => item.id !== plan.id);
      if (contributionFormPlanId === plan.id) contributionFormPlanId = null;
      saveState(); renderPlans(); showToast('Plan deleted');
    }
  });
  $('plans-list').addEventListener('submit', event => {
    const form = event.target.closest('[data-contribution-form]');
    if (!form) return;
    event.preventDefault();
    const plan = state.plans.find(item => item.id === form.dataset.contributionForm);
    const amount = Number(form.elements.contributionAmount.value);
    const date = form.elements.contributionDate.value || localToday();
    if (!plan || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('Enter a valid amount and date'); return; }
    plan.saved = Math.round((Number(plan.saved || 0) + amount)*100)/100;
    plan.contributions = Array.isArray(plan.contributions) ? plan.contributions : [];
    plan.contributions.push({ id:newId(), amount:Math.round(amount*100)/100, date, createdAt:Date.now() });
    contributionFormPlanId = null;
    saveState(); renderPlans(); showToast('Goal contribution added');
  });
  $('other-money-date').value = U.formatDate(new Date());
  $('other-money-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('other-money-title').value.trim();
    const amount = Number($('other-money-amount').value);
    const type = $('other-money-type').value;
    const date = $('other-money-date').value || U.formatDate(new Date());
    if (!title || !Number.isFinite(amount) || amount <= 0) { showToast('Enter a description and amount above zero'); return; }
    const createdAt = Date.now();
    const targetAmount = Number($('other-money-target').value) > 0 ? Number($('other-money-target').value) : 0;
    const targetDate = resolveDeadline($('other-money-deadline').value, $('other-money-days').value, createdAt);
    state.otherMoney.push({ id:newId(), title:title.slice(0,100), amount:Math.round(amount*100)/100, targetAmount:Math.round(targetAmount*100)/100, targetDate, type:Object.prototype.hasOwnProperty.call(OTHER_MONEY_LABELS,type) ? type : 'received', date, createdAt });
    saveState(); renderOtherMoney(); $('other-money-form').reset(); $('other-money-date').value = U.formatDate(new Date()); showToast('Separate money record added');
  });
  $('other-money-list').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-money]');
    if (!button) return;
    const item = state.otherMoney.find(record => record.id === button.dataset.deleteMoney);
    if (!item) return;
    state.otherMoney = state.otherMoney.filter(record => record.id !== item.id);
    saveState(); renderOtherMoney(); showToast('Money record deleted');
  });

  if (!state.budget && (document.body.dataset.page || 'monthly') === 'monthly') setTimeout(() => { if (!state.budget && !$('budget-dialog').open) $('budget-dialog').showModal(); }, 350);
  render();
})();
