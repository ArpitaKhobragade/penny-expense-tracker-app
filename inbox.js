// The review inbox: bank messages that were detected as spending wait here until you confirm them.
// Nothing counts as an expense until then. All functions are pure: they take the current data and return
// the new data, so the screen only has to save what comes back.
// inboxData = { inbox: [item], upcoming: [suggested bill], salary: [salary credit to offer a payday for], settle: [credit that may be someone paying you back], memory: { merchantKey: category }, dismissed: [smsId] }
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;
  const P = typeof require === 'function' ? require('./sms-parser.js') : root.SmsParser;
  const Bi = typeof require === 'function' ? require('./bills.js') : root.Bills;
  const C = typeof require === 'function' ? require('./cycle.js') : root.Cycle;
  const O = typeof require === 'function' ? require('./owed.js') : root.Owed;

  const SALARY_MAX_AGE_DAYS = 35; // an older salary message (say from a scan of past messages) says nothing about your payday now

  const REASONS = {
    empty: 'Paste a bank message first.',
    'not-bank-sender': 'That message did not come from a bank, so it was skipped.',
    otp: 'That is a one-time password message, not a payment.',
    upcoming: 'That is a reminder about a future payment, not money that has left your account yet.',
    request: 'That is a payment request. It will show up here once you actually pay.',
    failed: 'That payment did not go through, so nothing was added.',
    promotional: 'That looks like an offer, not a payment.',
    'not-transaction': 'I could not find a payment in that message.',
    'no-amount': 'I could not find an amount in that message.',
  };

  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextId = options => ((options && options.newId) || defaultId)();

  // Several pasted messages are separated by a blank line.
  function splitMessages(text) {
    return String(text || '').split(/\r?\n\s*\r?\n/).map(part => part.trim()).filter(Boolean);
  }

  // options: { expenses, debts (what others owe you), sender, receivedAt (ms, for messages read from the phone), now (Date), newId }
  // results: one per message, { status:'added'|'upcoming'|'salary'|'settle'|'balance'|'duplicate'|'credit'|'ignored', ... }
  // readings: the account balances the messages reported, [{ account, balance, date, stamp }], for accounts.js to apply.
  function ingestMessages(text, inboxData, options = {}) {
    const now = options.now || new Date();
    let data = { inbox: [...inboxData.inbox], upcoming: [...(inboxData.upcoming || [])], salary: [...(inboxData.salary || [])], settle: [...(inboxData.settle || [])], memory: inboxData.memory, dismissed: [...inboxData.dismissed] };
    const results = [], readings = [];
    // A message read from the phone is already one message, so it is never split on blank lines.
    const messages = options.single ? [String(text || '').trim()].filter(Boolean) : splitMessages(text);
    if (!messages.length) return { data, readings, results: [{ status: 'ignored', reason: 'empty', message: REASONS.empty }] };

    for (const message of messages) {
      // Pasted text has no arrival time, so its id stays the same if you paste it twice.
      const parsed = P.parseBankSms(message, { sender: options.sender, receivedAt: options.receivedAt, now, memory: data.memory });
      if (!parsed.ok) { results.push({ status: 'ignored', reason: parsed.reason, message: REASONS[parsed.reason] || REASONS['not-transaction'] }); continue; }
      if (parsed.balance != null && parsed.account) {
        // Pasted text has no arrival time, so it counts as midday on the day it names: an old paste cannot overwrite a newer balance.
        const stamp = options.receivedAt ? parsed.receivedAt : new Date(`${parsed.date}T12:00:00`).getTime();
        readings.push({ account: parsed.account, balance: parsed.balance, date: parsed.date, stamp });
      }
      if (parsed.kind === 'balance') { results.push({ status: 'balance', message: `Noted the balance for account ••${parsed.account}.` }); continue; }
      if (parsed.kind === 'upcoming') {
        // A payment announced for later (an autopay or mandate notice) is offered as a bill, never counted as spending.
        const bill = P.toBillSuggestion(parsed);
        const seen = data.dismissed.includes(bill.smsId) || data.upcoming.some(u => u.smsId === bill.smsId || (bill.ref && u.ref === bill.ref));
        if (seen) { results.push({ status: 'duplicate', amount: bill.amount, message: 'You already have this upcoming payment.' }); continue; }
        if ((options.bills || []).some(existing => Bi.isSameBill(existing, bill))) { results.push({ status: 'duplicate', amount: bill.amount, message: 'You already have a bill like this.' }); continue; }
        const item = { ...bill, id: nextId(options), addedAt: now.getTime() };
        data.upcoming.push(item);
        results.push({ status: 'upcoming', item, message: 'Found an upcoming payment. It is in the list for you to add as a bill.' });
        continue;
      }
      if (parsed.kind === 'credit' && parsed.salary) {
        // Money in that mentions salary: offered as a payday suggestion (never as spending), once, and only when it would change something.
        const salary = P.toSalarySuggestion(parsed);
        const seen = data.dismissed.includes(salary.smsId) || data.salary.some(s => s.smsId === salary.smsId || (salary.ref && s.ref === salary.ref));
        if (seen) { results.push({ status: 'duplicate', amount: salary.amount, message: 'You already have this salary message.' }); continue; }
        const age = U.daysBetween(salary.date, U.formatDate(now));
        if (age > SALARY_MAX_AGE_DAYS) { results.push({ status: 'credit', amount: salary.amount, message: 'That salary message is too old to say anything about your payday now.' }); continue; }
        if (options.settings && !C.suggestPayday(options.settings, salary.date)) { results.push({ status: 'credit', amount: salary.amount, message: 'That looks like your salary. Your payday setting already matches, so nothing to change.' }); continue; }
        const item = { ...salary, id: nextId(options), addedAt: now.getTime() };
        data.salary.push(item);
        results.push({ status: 'salary', item, message: 'That looks like your salary. A suggestion for your payday is on the Today screen.' });
        continue;
      }
      if (parsed.kind === 'credit') {
        // Money in is not spending. But when it could be someone paying you back, Penny offers to tick that off.
        const open = O.openDebts(options.debts || []);
        if (open.length && O.matchCredit(parsed, open).length) {
          const seen = data.dismissed.includes(parsed.smsId) || data.settle.some(s => s.smsId === parsed.smsId || (parsed.ref && s.ref === parsed.ref))
            || open.some(d => (d.payments || []).some(p => p.smsId === parsed.smsId));
          if (seen) { results.push({ status: 'duplicate', amount: parsed.amount, message: 'You already have this message.' }); continue; }
          const item = { id: nextId(options), smsId: parsed.smsId, ref: parsed.ref || '', amount: parsed.amount, date: parsed.date, counterparty: parsed.counterparty || '', account: parsed.account || '', addedAt: now.getTime() };
          data.settle.push(item);
          results.push({ status: 'settle', item, message: 'That could be someone paying you back. Confirm it in Who owes me.' });
          continue;
        }
        results.push({ status: 'credit', amount: parsed.amount, message: 'That is money coming in, not an expense, so it was skipped.' });
        continue;
      }

      const candidate = P.toExpense(parsed);
      if (data.dismissed.includes(candidate.smsId)) { results.push({ status: 'duplicate', amount: candidate.amount, message: 'You already dealt with this message.' }); continue; }

      const duplicate = P.findDuplicate(candidate, [...(options.expenses || []), ...data.inbox]);
      if (duplicate && duplicate.level === 'certain') { results.push({ status: 'duplicate', amount: candidate.amount, message: 'This payment is already recorded.' }); continue; }

      const item = { ...candidate, id: nextId(options), addedAt: now.getTime() };
      if (duplicate) item.possibleDuplicateOf = { id: duplicate.item.id, description: duplicate.item.description || 'an expense you added' };
      data.inbox.push(item);
      results.push({ status: 'added', item });
    }
    return { data, results, readings };
  }

  // Messages handed over by the phone: [{ sender, body, receivedAt (ms) }]. Each goes through the same checks as
  // a pasted message. Only the payments found are kept; the message text itself is not stored anywhere.
  // Returns { data, added, duplicates, skipped }.
  function ingestNative(messages, inboxData, options = {}) {
    let data = inboxData, added = 0, upcoming = 0, salary = 0, settle = 0, duplicates = 0, skipped = 0;
    const readings = [];
    for (const message of messages || []) {
      const run = ingestMessages(message && message.body, data, { ...options, single: true, sender: message && message.sender, receivedAt: Number(message && message.receivedAt) || undefined });
      data = run.data; readings.push(...run.readings);
      const status = run.results[0].status;
      if (status === 'added') added++; else if (status === 'upcoming') upcoming++; else if (status === 'salary') salary++; else if (status === 'settle') settle++; else if (status === 'duplicate') duplicates++; else if (status !== 'balance') skipped++;
    }
    return { data, added, upcoming, salary, settle, duplicates, skipped, readings };
  }

  function without(data, id, extraDismissed) {
    return { ...data, inbox: data.inbox.filter(item => item.id !== id), dismissed: extraDismissed ? [...data.dismissed, extraDismissed] : data.dismissed };
  }

  // edits: { category, description, amount, date } — anything left out keeps the detected value.
  // Returns { ok, expenses, data } or { ok:false, error }.
  function confirmItem(expenses, data, id, edits = {}, options = {}) {
    const item = data.inbox.find(entry => entry.id === id);
    if (!item) return { ok: false, error: 'That message is no longer in your review list.' };

    const amount = edits.amount == null ? item.amount : Number(edits.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    const date = edits.date || item.date;
    if (!U.isValidDate(date)) return { ok: false, error: 'Enter a valid date.' };
    const category = U.CATEGORIES.includes(edits.category) ? edits.category : item.category;

    const expense = {
      id: nextId(options),
      amount: U.round2(amount),
      description: String(edits.description == null ? item.description : edits.description).trim().slice(0, 100) || 'Expense',
      category, date,
      createdAt: (options.now || new Date()).getTime(),
      source: 'sms', smsId: item.smsId, ref: item.ref || '', account: item.account || '',
      merchantKey: item.merchantKey || '', receivedAt: item.receivedAt,
    };
    // Remember the shop's category so next time it arrives already sorted. 'Other' is not worth remembering.
    const memory = item.merchantKey && category !== 'Other' ? P.learnCategory(data.memory, item.merchantKey, category) : data.memory;
    return { ok: true, expense, expenses: [...expenses, expense], data: { ...without(data, id, item.smsId), memory } };
  }

  // Confirms everything whose category is already known (suggested by keyword or remembered).
  function confirmAllKnown(expenses, data, options = {}) {
    let current = { expenses, data };
    let count = 0;
    for (const item of data.inbox) {
      if (item.categoryConfidence === 'unknown' || item.possibleDuplicateOf) continue;
      const result = confirmItem(current.expenses, current.data, item.id, {}, options);
      if (result.ok) { current = { expenses: result.expenses, data: result.data }; count++; }
    }
    return { ...current, count };
  }

  // "Not an expense": removed, and remembered so it never comes back from a rescan or a second paste.
  function dismissItem(data, id) {
    const item = data.inbox.find(entry => entry.id === id);
    return item ? without(data, id, item.smsId) : data;
  }

  // "It is the same as the one I typed": the bank message is attached to that expense (so later copies
  // are recognised as duplicates) and removed from the inbox.
  function mergeIntoExisting(expenses, data, id) {
    const item = data.inbox.find(entry => entry.id === id);
    if (!item || !item.possibleDuplicateOf) return { ok: false, error: 'There is nothing to merge this with.' };
    const targetId = item.possibleDuplicateOf.id;
    if (!expenses.some(expense => expense.id === targetId)) return { ok: false, error: 'The expense you typed was deleted. You can confirm this one instead.' };
    const merged = expenses.map(expense => (expense.id === targetId
      ? { ...expense, smsId: item.smsId, ref: item.ref || expense.ref || '', account: item.account || expense.account || '', receivedAt: item.receivedAt }
      : expense));
    return { ok: true, expenses: merged, data: without(data, id, item.smsId) };
  }

  // Turns a suggested upcoming payment into a bill. edits: { title, amount, dueDate, repeat }, all optional.
  // Returns { ok, bill, billData, data } or { ok:false, error }.
  function acceptUpcoming(billData, data, id, edits = {}, options = {}) {
    const item = (data.upcoming || []).find(u => u.id === id);
    if (!item) return { ok: false, error: 'That suggestion is no longer in your list.' };
    const made = Bi.createBill({
      title: edits.title == null ? item.title : edits.title, amount: edits.amount == null ? item.amount : edits.amount,
      dueDate: edits.dueDate || item.dueDate, repeat: edits.repeat || item.repeat, source: 'sms',
    }, options);
    if (!made.ok) return made;
    return {
      ok: true, bill: made.bill,
      billData: { ...billData, bills: [...(billData.bills || []), made.bill] },
      data: { ...data, upcoming: data.upcoming.filter(u => u.id !== id), dismissed: [...data.dismissed, item.smsId] },
    };
  }

  // Adds everything the messages found without asking: each payment becomes an expense in the category Penny worked out
  // (or Other), and each upcoming payment becomes a bill. A payment that looks like one you typed in yourself (same amount,
  // same day, similar name) is attached to that entry instead, so nothing is counted twice.
  // Returns { expenses, billData, data, added, merged, billsAdded }.
  function acceptEverything(expenses, billData, data, options = {}) {
    let current = { expenses, billData, data }, added = 0, merged = 0, billsAdded = 0;
    for (const item of data.inbox) {
      if (item.possibleDuplicateOf) {
        const same = mergeIntoExisting(current.expenses, current.data, item.id);
        if (same.ok) { current = { ...current, expenses: same.expenses, data: same.data }; merged++; continue; }
      }
      const result = confirmItem(current.expenses, current.data, item.id, {}, options);
      if (result.ok) { current = { ...current, expenses: result.expenses, data: result.data }; added++; }
    }
    for (const item of data.upcoming || []) {
      const result = acceptUpcoming(current.billData, current.data, item.id, {}, options);
      if (result.ok) { current = { ...current, billData: result.billData, data: result.data }; billsAdded++; }
    }
    return { ...current, added, merged, billsAdded };
  }

  // Use the day the salary arrived as your payday. Returns { ok, settings, day, data } or { ok:false, error }.
  function acceptSalary(data, id) {
    const item = (data.salary || []).find(s => s.id === id);
    if (!item) return { ok: false, error: 'That suggestion is no longer in your list.' };
    const day = Number(item.date.slice(8, 10));
    return { ok: true, day, settings: { mode: 'payday', paydayDay: day }, data: { ...data, salary: [], dismissed: [...data.dismissed, ...data.salary.map(s => s.smsId)] } };
  }

  // "Not now": removed, and remembered so the same message never asks again.
  function ignoreSalary(data, id) {
    const item = (data.salary || []).find(s => s.id === id);
    return item ? { ...data, salary: [], dismissed: [...data.dismissed, ...data.salary.map(s => s.smsId)] } : data;
  }

  // "Yes, that was them": the money is counted against what that person owes, oldest first.
  // Returns { ok, debts, applied, extra, data } or { ok:false, error }.
  function acceptSettle(debts, data, id, personKey, options = {}) {
    const item = (data.settle || []).find(s => s.id === id);
    if (!item) return { ok: false, error: 'That suggestion is no longer in your list.' };
    const run = O.settleFor(debts, personKey, { amount: item.amount, date: item.date, smsId: item.smsId, ref: item.ref }, options);
    if (!run.ok) return run;
    return { ok: true, debts: run.debts, applied: run.applied, extra: run.extra, data: { ...data, settle: data.settle.filter(s => s.id !== id), dismissed: [...data.dismissed, item.smsId] } };
  }

  // "Not from them": removed, and remembered so the same message never asks again.
  function ignoreSettle(data, id) {
    const item = (data.settle || []).find(s => s.id === id);
    return item ? { ...data, settle: data.settle.filter(s => s.id !== id), dismissed: [...data.dismissed, item.smsId] } : data;
  }

  // "Not a bill": removed, and remembered so the same message never comes back.
  function ignoreUpcoming(data, id) {
    const item = (data.upcoming || []).find(u => u.id === id);
    return item ? { ...data, upcoming: data.upcoming.filter(u => u.id !== id), dismissed: [...data.dismissed, item.smsId] } : data;
  }

  // "It is a different payment": the warning goes away and the item can be confirmed as its own expense.
  function keepBoth(data, id) {
    return { ...data, inbox: data.inbox.map(item => {
      if (item.id !== id || !item.possibleDuplicateOf) return item;
      const { possibleDuplicateOf, ...rest } = item;
      return rest;
    }) };
  }

  const api = { splitMessages, ingestMessages, ingestNative, acceptUpcoming, acceptEverything, ignoreUpcoming, acceptSalary, ignoreSalary, acceptSettle, ignoreSettle, confirmItem, confirmAllKnown, dismissItem, mergeIntoExisting, keepBoth, REASONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Inbox = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
