// Parses Indian bank / UPI / card SMS text into expense records. Pure functions only: no storage,
// no DOM, no network, so the same code runs in the browser, in the Android app and under Node tests.
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const NUM = '(\\d[\\d,]*(?:\\.\\d{1,2})?)';
  const CURRENCY_RE = new RegExp('(?:\\brs\\.?|\\binr|₹|\\brupees?\\b)\\s*' + NUM, 'gi');
  const BALANCE_BEFORE_RE = /\b(?:bal(?:ance)?|avl|avail(?:able)?|limit|outstanding|due)\b[^0-9]*$/i;
  const BARE_DEBIT_AMOUNT_RE = new RegExp('\\b(?:debited|debit|spent|paid|sent|withdrawn)\\s+(?:by|for|of|with)?\\s*(?:rs\\.?|inr|₹)?\\s*' + NUM + '\\b', 'i');

  const OTP_RE = /\botp\b|one[- ]?time password|verification code|\bcvv\b/i;
  const UPCOMING_RE = /\b(?:will be|to be|shall be|would be|is going to be)\s+(?:auto[- ]?)?(?:debited|deducted|charged|paid)\b|\b(?:due (?:on|by|date)|payment due|amount due|bill due|minimum due|e-?mandate|scheduled)\b/i;
  const REQUEST_RE = /\b(?:collect request|payment request|has requested|requested (?:money|rs)|approve (?:the )?request)\b/i;
  const FAILED_RE = /\b(?:failed|declined|unsuccessful|not successful|could not be (?:processed|completed)|unable to process|insufficient (?:funds|balance)|reversed)\b/i;
  const PROMO_RE = /\b(?:apply now|pre-?approved|congratulations|offer valid|use code|t&c apply|click (?:here|on)|download the app)\b/i;

  // A credit that mentions salary. The wording here is the common Indian pattern ("... SALARY", "NEFT-...-SAL-...", payroll),
  // written without a real salary message to check it against, so Pocket only ever SUGGESTS a payday from it.
  // Offers and account promotions that merely contain the word are excluded.
  const SALARY_RE = /\b(?:salary|sal|payroll|wages?|stipend)\b/i;
  const SALARY_EXCLUDE_RE = /\bsalary[- ](?:account|advance|loan|overdraft|linked|plan)\b|\b(?:loan|offer|apply|bonus|cashback|reward)\b/i;
  const isSalaryText = text => SALARY_RE.test(text) && !SALARY_EXCLUDE_RE.test(text) && !PROMO_RE.test(text);

  const STRONG_DEBIT_RE = /\b(?:debited|debit (?:alert|of|for|txn|transaction)|spent|withdrawn|withdrawal)\b/i;
  const WEAK_DEBIT_RE = /\b(?:paid|sent|transferred|payment of|purchase of|txn of|transaction of)\b/i;
  const CREDIT_RE = /\b(?:credited|received|deposited|refund(?:ed)?)\b/i;

  const PAYEE_TERMINATOR_RE = /\s+(?:on|ref|refno|ref\.|upi|txn|via|if|not|dt|date|avl|bal|call|thru|through|using|from|with|for)\b|\.\s|\.$|\s+-\s|\s+\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/i;
  const PAYEE_REJECT_RE = /^(?:a\/?c|acct?|account|your|ur|bank|us|the|card|self|upi|vpa)\b/i;

  function normalize(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }

  // Real sender IDs look like "VM-HDFCBK-S", "AX-SBIUPI" or "HDFCBK": upper-case letters/digits.
  // Phone numbers and saved contacts ("Mom") are rejected so a friend's text never becomes an expense.
  // An empty sender means the text was pasted by hand, so it is not filtered.
  function isBankSender(sender) {
    const s = String(sender || '').trim();
    if (!s) return true;
    return /^(?:[A-Z]{2}-)?[A-Z][A-Z0-9]{2,10}(?:-[A-Z])?$/.test(s);
  }

  function parseAmount(raw) {
    const n = Number(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? U.round2(n) : NaN;
  }

  function extractAmount(text) {
    CURRENCY_RE.lastIndex = 0;
    let match;
    while ((match = CURRENCY_RE.exec(text))) {
      const before = text.slice(Math.max(0, match.index - 20), match.index);
      if (BALANCE_BEFORE_RE.test(before)) continue;
      const amount = parseAmount(match[1]);
      if (amount > 0) return amount;
    }
    const bare = BARE_DEBIT_AMOUNT_RE.exec(text);
    return bare ? parseAmount(bare[1]) : NaN;
  }

  // fallback === null means "tell me if the text has no date" (returns null); allowFuture is for upcoming payments.
  function extractDate(text, fallback, allowFuture) {
    const today = U.formatDate(new Date());
    const candidates = [];
    let m;
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text))) candidates.push([m[1], m[2], m[3]]);
    if ((m = /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})\b/.exec(text))) candidates.push([m[3], m[2], m[1]]);
    if ((m = /\b(\d{1,2})[-\s]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s,]*(\d{4}|\d{2})\b/i.exec(text))) {
      candidates.push([m[3], String(MONTHS[m[2].toLowerCase()]), m[1]]);
    }
    if (allowFuture && !candidates.length && (m = /\b(\d{1,2})(?:st|nd|rd|th)?[-\s]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(text))) {
      const month = MONTHS[m[2].toLowerCase()], thisYear = Number(today.slice(0, 4));
      const pad = n => String(n).padStart(2, '0');
      const soon = `${thisYear}-${pad(month)}-${pad(m[1])}`;
      candidates.push([String(U.isValidDate(soon) && U.daysBetween(soon, today) > 30 ? thisYear + 1 : thisYear), String(month), m[1]]);
    }
    for (const [y, mo, d] of candidates) {
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const iso = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!U.isValidDate(iso)) continue;
      // A date more than a day ahead of the fallback is a parse accident (reference numbers etc.).
      if (!allowFuture && U.daysBetween(fallback || today, iso) > 1) continue;
      return iso;
    }
    return fallback === null ? null : (fallback || today);
  }

  function extractRef(text) {
    const labelled = /\b(?:upi\s*)?(?:ref(?:erence)?(?:\s*(?:no|number|id))?\.?|refno|rrn|txn\s*(?:id|no)|utr|upi)\s*[:#.\-]?\s*(\d{9,18})\b/i.exec(text);
    if (labelled) return labelled[1];
    const bare = /\b(\d{12})\b/.exec(text);
    if (bare) return bare[1];
    // mandate and autopay references mix letters and digits ("Ref- YJP9b955...")
    const mixed = /\bref(?:erence)?(?:\s*(?:no|id))?\s*[-:.#]?\s*([A-Za-z0-9]{12,40})\b/i.exec(text);
    return mixed && /\d/.test(mixed[1]) && /[A-Za-z]/.test(mixed[1]) ? mixed[1] : '';
  }

  // The balance a message reports after the transaction: "Avl Bal Rs 5,000.00", "Bal: INR 1,234.56",
  // "Available balance in a/c XX1234 is Rs 500". Card limits and dues are not balances. An overdrawn (Dr) balance is ignored.
  const BALANCE_DIRECT_RE = /\b(?:avl\.?|avail(?:able)?|clear|closing|ledger|total)?\s*bal(?:ance)?\.?\s*(?:after\s+(?:txn|transaction)\s*)?(?:is|of)?\s*[:\-=]?\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)(\s*(?:dr|cr)\b)?/i;
  const BALANCE_GAP_RE = /\b(?:avl\.?|avail(?:able)?)\s*bal(?:ance)?\b[^₹\n]{0,45}?(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)(\s*(?:dr|cr)\b)?/i;
  function extractBalance(text) {
    for (const re of [BALANCE_DIRECT_RE, BALANCE_GAP_RE]) {
      const m = re.exec(text);
      if (!m) continue;
      if (/\b(?:min(?:imum)?|insufficient|low|required)\s*$/i.test(text.slice(Math.max(0, m.index - 14), m.index + m[0].search(/bal/i)))) continue;
      if (m[2] && /dr/i.test(m[2])) return null;
      const amount = parseAmount(m[1]);
      if (Number.isFinite(amount)) return amount;
    }
    return null;
  }

  function extractAccount(text) {
    const m = /\b(?:a\/c|acct?|account|card)\b[^0-9]{0,15}?\d*?(\d{3,4})\b/i.exec(text);
    return m ? m[1] : '';
  }

  function cleanPayee(raw) {
    let s = raw.split(PAYEE_TERMINATOR_RE)[0];
    s = s.replace(/^vpa\s+/i, '').replace(/^[\s:.\-*]+|[\s:.\-*]+$/g, '').replace(/\s+/g, ' ');
    if (s.length < 2 || PAYEE_REJECT_RE.test(s)) return '';
    if (/^\d+$/.test(s)) return '';
    if (/^\d/.test(s) && !s.includes('@')) return '';
    return s;
  }

  function extractPayee(text) {
    const patterns = [
      /\b(?:to|towards)\s+(?:vpa\s+)?([^;,(\n]{2,60})/gi,
      /\bat\s+([^;,(\n]{2,50})/gi,
      /;\s*([A-Za-z][^;,(\n]{1,40}?)\s+credited/gi,
      /\bfor\s+(?!rs\b|inr\b|₹|\d)([^;,(\n]{2,40})/gi,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text))) {
        const payee = cleanPayee(m[1]);
        if (payee) return payee;
      }
    }
    return '';
  }

  // Who a credit came from: "from Rahul", "by VPA rahul@okaxis (RAHUL K)". Titles and stray digits are dropped, and a
  // bare phone-number address is not kept at all.
  function extractSender(text) {
    let name = '';
    const named = /\b(?:from|by)\s+(?:vpa\s+)?[\w.\-]+@\w+\s*\(([^)]{2,40})\)/i.exec(text);
    if (named) name = cleanPayee(named[1]);
    if (!name) {
      const re = /\b(?:from|by\s+vpa)\s+([^;,(\n]{2,60})/gi;
      let m;
      while ((m = re.exec(text))) {
        const payee = cleanPayee(m[1]);
        if (payee && !/^\d+@/.test(payee)) { name = payee; break; }
      }
    }
    if (!name) return '';
    name = name.replace(/^(?:mr|mrs|ms|miss|shri|smt|dr)\.?\s+/i, '').replace(/(\p{L})\d+\b/gu, '$1').trim();
    return name ? prettyName(name) : '';
  }

  function prettyName(raw) {
    let s = raw.trim();
    if (s.includes('@')) {
      const local = s.split('@')[0];
      if (/^\d+$/.test(local)) return s;
      s = local.replace(/[._\-]+/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!s) return raw;
    }
    if (s === s.toUpperCase() || s === s.toLowerCase()) s = s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
    return s.slice(0, 60);
  }

  // Stable identity for "the same shop" so a category you pick once is remembered next time.
  function merchantKey(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (!s) return '';
    const base = s.includes('@') ? s.split('@')[0] : s;
    return base.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  function suggestCategory(payee, memory) {
    const key = merchantKey(payee);
    if (key && memory && Object.prototype.hasOwnProperty.call(memory, key) && U.CATEGORIES.includes(memory[key])) {
      return { category: memory[key], confidence: 'learned' };
    }
    const category = U.detectCategory(payee);
    return { category, confidence: category === 'Other' ? 'unknown' : 'keyword' };
  }

  // Returns a new memory object; the caller persists it. Passing 'Other' forgets the merchant.
  function learnCategory(memory, payee, category) {
    const key = merchantKey(payee);
    const next = { ...(memory || {}) };
    if (!key || !U.CATEGORIES.includes(category)) return next;
    if (category === 'Other') delete next[key]; else next[key] = category;
    return next;
  }

  // Wording that announces a payment that has NOT happened yet: autopay and mandate notices, "will be debited".
  const UPCOMING_MARKER_RE = /\bupcoming\b|\bwill be (?:auto[- ]?)?(?:debited|deducted|charged)\b|\bwill be dr\b|\bmandate (?:is )?(?:set|scheduled|created|registered)\b|\bstanding instruction\b|\bauto-?pay\b/i;
  const RECURRING_RE = /\bmandate\b|\bstanding instruction\b|\bauto-?pay\b|\brecurring\b/i;

  // An upcoming payment is only worth suggesting as a bill when the message gives both an amount and a date.
  function parseUpcoming(text, options, receivedAt) {
    if (!UPCOMING_MARKER_RE.test(text) || REQUEST_RE.test(text) || FAILED_RE.test(text)) return null;
    if (/\b(?:has|have|was|were) been\b[^.]{0,25}\b(?:debited|spent|paid)\b/i.test(text)) return null; // it already happened
    const amount = extractAmount(text);
    const date = extractDate(text, null, true);
    if (!(amount > 0) || !date) return null;
    const payee = extractPayee(text);
    const suggestion = payee ? suggestCategory(payee, options.memory) : { category: 'Other', confidence: 'unknown' };
    return {
      ok: true, kind: 'upcoming', amount, date, receivedAt,
      description: payee ? prettyName(payee) : 'Upcoming payment',
      merchant: payee ? prettyName(payee) : '', merchantKey: merchantKey(payee),
      category: suggestion.category, categoryConfidence: suggestion.confidence,
      ref: extractRef(text), account: extractAccount(text),
      repeat: RECURRING_RE.test(text) ? 'monthly' : 'once',
      smsId: hash(`${options.sender || ''}|${options.receivedAt || ''}|${text}`),
    };
  }

  // A bill reminder: "Your Airtel postpaid bill of Rs 499 is due on 25-10-2026", "Total amount due Rs 5,432 by 28-Oct-26",
  // "EMI of Rs 3,200 is due on 05 Nov". It becomes a bill, never spending: the money is set aside until you pay it.
  const BILL_WORD_RE = /\b(?:bill|emi|premium|postpaid|statement|instal?lment|outstanding|minimum (?:amount )?due|total (?:amount )?due|amount due|payment due|recharge|rent)\b/i;
  const DUE_WORD_RE = /\bdue\b|\bpay(?:ment)?\b[^.]{0,24}\b(?:by|before|on)\b|\blast date\b|\bpayable (?:by|before|on)\b/i;
  const BILL_PAID_RE = /\b(?:payment (?:of .{0,25})?(?:received|successful|successfully)|thank(?:s| you) for (?:your |the )?payment|successfully (?:paid|received|processed)|has been (?:received|paid|debited|credited)|we have received|received your payment)\b/i;
  const BILL_REPEAT_RE = /\b(?:emi|postpaid|credit card|premium|rent|subscription|broadband|instal?lment|loan)\b/i;
  function billAmount(text) {
    CURRENCY_RE.lastIndex = 0;
    let match;
    while ((match = CURRENCY_RE.exec(text))) {
      if (/\b(?:bal(?:ance)?|avl|avail(?:able)?|limit)\b[^0-9]*$/i.test(text.slice(Math.max(0, match.index - 24), match.index))) continue;
      const amount = parseAmount(match[1]);
      if (amount > 0) return amount;
    }
    return NaN;
  }
  function billTitle(text, sender) {
    // "Your Airtel postpaid bill ..." or, in an app notification, "Airtel bill due. Pay ..." (the name comes first)
    const named = /\b(?:your|ur)\s+([A-Za-z][A-Za-z0-9&.\- ]{1,26}?)\s+(postpaid|prepaid|bill|emi|premium|statement|credit card|loan|instal?lment|recharge)\b/i.exec(text)
      || /^\s*([A-Za-z][A-Za-z0-9&.\- ]{1,26}?)\s+(postpaid|prepaid|bill|emi|premium|statement|recharge)\b/i.exec(text);
    if (named && !/^(?:the|a|an|credit|credit card|bank|monthly|total|outstanding|next|latest|last)$/i.test(named[1].trim())) {
      const kind = named[2].toLowerCase();
      return `${prettyName(named[1].trim())} ${kind === 'postpaid' || kind === 'prepaid' || kind === 'statement' ? 'bill' : kind === 'emi' ? 'EMI' : kind}`.replace(/\bbill bill\b/i, 'bill');
    }
    if (/\bemi\b/i.test(text)) return 'EMI';
    if (/\bcredit card\b/i.test(text)) return 'Credit card bill';
    if (/\bpremium\b/i.test(text)) return 'Insurance premium';
    if (/\b(?:electricity|power|bses|discom)\b/i.test(text)) return 'Electricity bill';
    if (/\bwater\b/i.test(text)) return 'Water bill';
    if (/\bgas\b/i.test(text)) return 'Gas bill';
    if (/\b(?:broadband|wifi|wi-fi|internet|fib(?:re|er))\b/i.test(text)) return 'Internet bill';
    if (/\b(?:postpaid|mobile|recharge)\b/i.test(text)) return 'Mobile bill';
    if (/\brent\b/i.test(text)) return 'Rent';
    const from = String(sender || '').replace(/^[A-Z]{2}-/, '').replace(/-[A-Z]$/, '');
    return from && from !== 'UPIAPP' ? `${prettyName(from)} bill` : 'Bill';
  }
  function parseBillDue(text, options, receivedAt) {
    if (!BILL_WORD_RE.test(text) || !DUE_WORD_RE.test(text)) return null;
    if (BILL_PAID_RE.test(text) || PROMO_RE.test(text) || REQUEST_RE.test(text) || FAILED_RE.test(text)) return null;
    const amount = billAmount(text), date = extractDate(text, null, true);
    if (!(amount > 0) || !date) return null;
    const title = billTitle(text, options.sender);
    return {
      ok: true, kind: 'upcoming', amount, date, receivedAt, billDue: true,
      description: title, merchant: '', merchantKey: merchantKey(title),
      category: 'Bills', categoryConfidence: 'high',
      ref: extractRef(text), account: extractAccount(text),
      repeat: BILL_REPEAT_RE.test(text) ? 'monthly' : 'once',
      smsId: hash(`${options.sender || ''}|${options.receivedAt || ''}|${text}`),
    };
  }

  // parseBankSms(text, { sender, receivedAt (ms), now (Date), memory })
  //   -> { ok:false, reason } | { ok:true, kind:'debit'|'credit', amount, date, ... }
  function parseBankSms(raw, options = {}) {
    const text = normalize(raw);
    if (!text) return { ok: false, reason: 'empty' };
    if (!isBankSender(options.sender)) return { ok: false, reason: 'not-bank-sender' };
    if (OTP_RE.test(text)) return { ok: false, reason: 'otp' };
    const arrived = Number(options.receivedAt) || (options.now || new Date()).getTime();
    const upcoming = parseUpcoming(text, options, arrived) || parseBillDue(text, options, arrived);
    if (upcoming) return upcoming;
    if (UPCOMING_RE.test(text)) return { ok: false, reason: 'upcoming' };
    if (REQUEST_RE.test(text)) return { ok: false, reason: 'request' };
    if (FAILED_RE.test(text)) return { ok: false, reason: 'failed' };

    const strong = STRONG_DEBIT_RE.exec(text);
    const weak = WEAK_DEBIT_RE.exec(text);
    const credit = CREDIT_RE.exec(text);
    let kind = '';
    if (strong && (!credit || strong.index < credit.index)) kind = 'debit';
    else if (credit) kind = 'credit';
    else if (weak) kind = 'debit';
    if (!kind) {
      // A message that only reports a balance for an account ("Available balance in a/c XX1234 is Rs 500").
      const onlyBalance = extractBalance(text), onlyAccount = extractAccount(text);
      if (onlyBalance !== null && onlyAccount && !PROMO_RE.test(text) && !/\b(?:loan|offers?|apply|click|download|reward|cashback|emi)\b/i.test(text)) {
        const at = Number(options.receivedAt) || (options.now || new Date()).getTime();
        return { ok: true, kind: 'balance', amount: 0, balance: onlyBalance, account: onlyAccount, date: extractDate(text, U.formatDate(new Date(at))), receivedAt: at, smsId: hash(`${options.sender || ''}|${options.receivedAt || ''}|${text}`) };
      }
      return { ok: false, reason: 'not-transaction' };
    }
    if (kind === 'debit' && !strong && PROMO_RE.test(text)) return { ok: false, reason: 'promotional' };

    const amount = extractAmount(text);
    if (!(amount > 0)) return { ok: false, reason: 'no-amount' };

    const receivedAt = Number(options.receivedAt) || (options.now || new Date()).getTime();
    const date = extractDate(text, U.formatDate(new Date(receivedAt)));
    const payee = kind === 'debit' ? extractPayee(text) : '';
    const merchant = payee ? prettyName(payee) : '';
    const isAtm = !payee && /\batm\b|cash withdrawal/i.test(text);
    const description = merchant || (isAtm ? 'ATM withdrawal' : kind === 'debit' ? 'Bank debit' : 'Money received');
    const suggestion = payee ? suggestCategory(payee, options.memory) : { category: 'Other', confidence: 'unknown' };

    return {
      ok: true,
      kind,
      amount,
      date,
      description,
      merchant,
      merchantKey: merchantKey(payee),
      category: suggestion.category,
      categoryConfidence: suggestion.confidence,
      ref: extractRef(text),
      account: extractAccount(text),
      salary: kind === 'credit' && isSalaryText(text),
      counterparty: kind === 'credit' ? extractSender(text) : '',
      balance: extractBalance(text),
      receivedAt,
      smsId: hash(`${options.sender || ''}|${options.receivedAt || ''}|${text}`),
    };
  }

  // The expense record to put in the review inbox; null for anything that is not money going out.
  function toExpense(parsed) {
    if (!parsed || !parsed.ok || parsed.kind !== 'debit') return null;
    return {
      amount: parsed.amount,
      description: parsed.description,
      category: parsed.category,
      date: parsed.date,
      merchant: parsed.merchant,
      merchantKey: parsed.merchantKey,
      ref: parsed.ref,
      account: parsed.account,
      source: 'sms',
      smsId: parsed.smsId,
      receivedAt: parsed.receivedAt,
      needsReview: true,
      categoryConfidence: parsed.categoryConfidence,
    };
  }

  // The bill to offer for an upcoming payment; null for anything else.
  function toBillSuggestion(parsed) {
    if (!parsed || !parsed.ok || parsed.kind !== 'upcoming') return null;
    return {
      title: parsed.description, amount: parsed.amount, dueDate: parsed.date, repeat: parsed.repeat,
      ref: parsed.ref || '', smsId: parsed.smsId, receivedAt: parsed.receivedAt, source: 'sms',
    };
  }

  // The salary to offer a payday for; null for any other message.
  function toSalarySuggestion(parsed) {
    if (!parsed || !parsed.ok || parsed.kind !== 'credit' || !parsed.salary) return null;
    return { amount: parsed.amount, date: parsed.date, ref: parsed.ref || '', account: parsed.account || '', smsId: parsed.smsId, receivedAt: parsed.receivedAt, source: 'sms' };
  }

  // The same payment often arrives twice (bank SMS plus UPI-app notification) and a backfill scan can
  // re-read old messages. 'certain' duplicates should be dropped; 'possible' ones (same amount and day
  // as something typed by hand) should be shown to the user instead of silently dropped.
  function findDuplicate(candidate, existing, options = {}) {
    const windowMs = options.windowMs == null ? 120000 : options.windowMs;
    let possible = null;
    for (const item of existing || []) {
      if (candidate.smsId && item.smsId === candidate.smsId) return { level: 'certain', item };
      if (Math.abs(Number(item.amount) - candidate.amount) >= 0.005) continue;
      if (candidate.ref && item.ref) {
        if (candidate.ref === item.ref) return { level: 'certain', item };
        continue;
      }
      if (item.date !== candidate.date) continue;
      if (item.source === 'sms' || item.smsId) {
        const sameAccount = !candidate.account || !item.account || candidate.account === item.account;
        const sameMerchant = !candidate.merchantKey || !item.merchantKey || candidate.merchantKey === item.merchantKey;
        const gap = Math.abs((Number(item.receivedAt) || Number(item.createdAt) || 0) - (candidate.receivedAt || 0));
        if (sameAccount && sameMerchant && gap <= windowMs) return { level: 'certain', item };
        // Same amount, day, account and shop but too far apart in time to be sure (a message pasted by hand and
        // later read from the phone has different times): ask instead of guessing.
        if (sameAccount && sameMerchant && !possible) possible = { level: 'possible', item };
      } else if (!possible) {
        possible = { level: 'possible', item };
      }
    }
    return possible;
  }

  const api = { isBankSender, extractBalance, parseBankSms, toExpense, toBillSuggestion, toSalarySuggestion, findDuplicate, suggestCategory, learnCategory, merchantKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SmsParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
