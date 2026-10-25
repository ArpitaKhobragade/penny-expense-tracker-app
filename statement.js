// Reads a bank statement saved as a CSV (or tab or semicolon separated) file: every payment on it, and the balance on its
// last day. This is how Pocket gets expenses and a balance that no bank message ever carried.
// Pure functions: text in, plain data out. Nothing is stored here.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;
  const P = typeof require === 'function' ? require('./sms-parser.js') : root.SmsParser;

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  // One line split into cells, with "quoted, values" kept whole.
  function splitLine(line, delimiter) {
    const cells = [];
    let current = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') quoted = false;
        else current += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { cells.push(current.trim()); current = ''; }
      else current += ch;
    }
    cells.push(current.trim());
    return cells;
  }

  function detectDelimiter(lines) {
    let best = ',', bestScore = -1;
    for (const d of [',', '\t', ';', '|']) {
      const score = lines.slice(0, 40).reduce((sum, l) => sum + Math.min(l.split(d).length - 1, 12), 0);
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  // "1,234.50", "₹ 1234", "1,234.50 Cr" -> a number; empty or "-" -> null.
  function toNumber(raw) {
    const s = String(raw == null ? '' : raw).replace(/₹|rs\.?|inr|,|\s/gi, '').replace(/(?:cr|dr)\.?$/i, '');
    if (!s || s === '-') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // 22/10/2026, 22-10-26, 22 Oct 2026, 22-Oct-26, 2026-10-22 -> 'YYYY-MM-DD' (day first, as Indian banks write it).
  function toDate(raw) {
    const s = String(raw || '').trim();
    let m, year, month, day;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { year = Number(m[1]); month = Number(m[2]); day = Number(m[3]); }
    else if ((m = /^(\d{1,2})[\/.\-\s](\d{1,2})[\/.\-\s](\d{2,4})/.exec(s))) { day = Number(m[1]); month = Number(m[2]); year = Number(m[3]); }
    else if ((m = /^(\d{1,2})[\/.\-\s]([A-Za-z]{3,9})[\/.\-\s,]*(\d{2,4})/.exec(s))) { day = Number(m[1]); month = MONTHS[m[2].slice(0, 3).toLowerCase()]; year = Number(m[3]); }
    else return null;
    if (year < 100) year += 2000;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return month && U.isValidDate(iso) ? iso : null;
  }

  function findColumns(cells) {
    const find = re => cells.findIndex(c => re.test(c));
    const dateCol = (() => { const own = find(/^(?:txn|transaction|trans|posting|post)\.?\s*date$/i); return own >= 0 ? own : (find(/^date$/i) >= 0 ? find(/^date$/i) : find(/value\s*date/i)); })();
    return {
      date: dateCol,
      description: find(/description|narration|particulars|details|remarks/i),
      debit: find(/debit|withdraw|paid\s*out|money\s*out|^dr\.?$/i),
      credit: find(/credit|deposit|paid\s*in|money\s*in|^cr\.?$/i),
      balance: find(/balance|closing/i),
      amount: find(/^(?:txn\s*|transaction\s*)?amount/i),
      type: find(/^(?:dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn\s*type)$/i),
    };
  }

  // The payee out of a bank narration. UPI lines look like "UPI/DR/629456767814/RAVI KUMAR/okaxis/Payment"; anything else
  // is cleaned and shortened.
  function describe(narration) {
    const text = String(narration || '').replace(/\s+/g, ' ').trim();
    if (/\batm\b|cash\s*withdrawal/i.test(text)) return 'ATM withdrawal';
    let payee = text;
    const parts = text.split('/').map(p => p.trim()).filter(Boolean);
    if (/^upi$/i.test(parts[0] || '') && parts.length >= 3) payee = parts.slice(2).find(p => !/^\d+$/.test(p) && !/^(?:dr|cr|upi)$/i.test(p)) || text;
    payee = payee.replace(/^(?:pos|ecom|ach|nach|imps|neft|atm wdl|atm)\s*[-:\/]?\s*/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 50);
    if (payee && (payee === payee.toUpperCase() || payee === payee.toLowerCase())) payee = payee.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
    return payee || 'Bank payment';
  }

  // text -> { ok, rows: [{ date, description, narration, debit, credit, balance, ref }], account, balance: { value, date } | null }
  //      or { ok:false, error }
  function parseStatement(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { ok: false, error: 'That file is empty.' };
    const delimiter = detectDelimiter(lines);
    const table = lines.map(l => splitLine(l, delimiter));
    let headerIndex = -1, columns = null;
    for (let i = 0; i < Math.min(table.length, 60); i++) {
      const c = findColumns(table[i]);
      if (c.date >= 0 && (c.debit >= 0 || c.amount >= 0) && (c.description >= 0 || c.balance >= 0)) { headerIndex = i; columns = c; break; }
    }
    if (headerIndex < 0) return { ok: false, error: 'I could not find the columns. Save the statement as CSV with Date, Description, Debit, Credit and Balance.' };

    const rows = [];
    for (const cells of table.slice(headerIndex + 1)) {
      const date = toDate(cells[columns.date]);
      if (!date) continue;
      let debit = columns.debit >= 0 ? toNumber(cells[columns.debit]) : null;
      let credit = columns.credit >= 0 ? toNumber(cells[columns.credit]) : null;
      if (columns.amount >= 0 && debit === null && credit === null) {
        const amount = toNumber(cells[columns.amount]), kind = columns.type >= 0 ? String(cells[columns.type]) : String(cells[columns.amount]);
        if (amount !== null) { if (/\bdr\b|debit|withdraw/i.test(kind)) debit = amount; else credit = amount; }
      }
      if (!(debit > 0) && !(credit > 0)) continue;
      const narration = columns.description >= 0 ? cells[columns.description] || '' : '';
      const ref = (/\b\d{12}\b/.exec(narration) || [])[0] || '';
      rows.push({ date, narration, description: describe(narration), debit: debit > 0 ? U.round2(debit) : 0, credit: credit > 0 ? U.round2(credit) : 0, balance: columns.balance >= 0 ? toNumber(cells[columns.balance]) : null, ref });
    }
    if (!rows.length) return { ok: false, error: 'I found the columns but no payments in that file.' };

    // The account's last digits, if the lines above the table name the account.
    const preamble = table.slice(0, headerIndex).map(c => c.join(' ')).join(' ');
    const acct = /(?:a\/?c|account)\s*(?:no\.?|number|#)?\s*[:\-]?\s*[xX*\d]{6,}/i.exec(preamble);
    const account = acct ? (acct[0].match(/\d+/g) || []).join('').slice(-4) : '';

    // The balance on the latest day, whichever way round the file is sorted.
    const withBalance = rows.filter(r => r.balance !== null);
    let balance = null;
    if (withBalance.length) {
      const latest = withBalance.reduce((max, r) => (r.date > max ? r.date : max), '');
      const sameDay = withBalance.filter(r => r.date === latest);
      const oldestFirst = rows[0].date <= rows[rows.length - 1].date;
      const row = oldestFirst ? sameDay[sameDay.length - 1] : sameDay[0];
      balance = { value: U.round2(row.balance), date: latest };
    }
    return { ok: true, rows, account, balance };
  }

  // What importing would do: the payments not already recorded (as new expense records), how many were skipped, and the balance.
  // existing: the expenses already in Pocket. options: { now (Date), newId }.
  function importPlan(statement, existing, options = {}) {
    const stamp = (options.now || new Date()).getTime();
    const newId = options.newId || (() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const expenses = [];
    let duplicates = 0, credits = 0;
    for (const row of statement.rows) {
      if (!(row.debit > 0)) { credits++; continue; }
      const candidate = { amount: row.debit, date: row.date, description: row.description, category: U.detectCategory(`${row.description} ${row.narration}`), merchantKey: P.merchantKey(row.description), ref: row.ref, account: statement.account };
      if (P.findDuplicate(candidate, existing || [])) { duplicates++; continue; }
      expenses.push({ id: newId(), ...candidate, createdAt: stamp, source: 'statement' });
    }
    const reading = statement.balance && statement.account
      ? { account: statement.account, balance: statement.balance.value, date: statement.balance.date, stamp: new Date(`${statement.balance.date}T23:59:00`).getTime() } : null;
    return { expenses, duplicates, credits, balance: statement.balance, account: statement.account, reading };
  }

  const api = { parseStatement, importPlan, toDate, toNumber, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Statement = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
