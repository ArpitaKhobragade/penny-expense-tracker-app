(function (root) {
  const CATEGORIES = ['Food', 'Travel', 'Shopping', 'Bills', 'Health', 'Education', 'Entertainment', 'Other'];
  const CATEGORY_KEYWORDS = {
    Food: ['food','lunch','dinner','breakfast','snack','coffee','tea','restaurant','pizza','groceries','grocery','meal','chai','swiggy','zomato','dominos','mcdonalds','kfc','starbucks','blinkit','zepto','bigbasket','instamart','dmart','jiomart','cafe','bakery','biryani','sabzi','sabji','kirana','doodh','dudh','milk','khana','nashta','tiffin','dabba','roti','paratha','samosa','vada','pav','thali','chaat','fruits','atta','dal','chawal','panipuri'],
    Travel: ['travel','cab','taxi','uber','ola','bus','train','metro','fuel','petrol','auto','rickshaw','irctc','redbus','rapido','makemytrip','indigo','fastag','parking','rikshaw','diesel','cng','toll'],
    Shopping: ['shopping','clothes','shirt','shoes','amazon','flipkart','purchase','myntra','ajio','meesho','nykaa','kapde','kapda','joote','chappal','mall','gift'],
    Bills: ['bill','electricity','recharge','internet','wifi','rent','water','jio','airtel','vodafone','bsnl','bescom','dth','insurance','bijli','kiraya','paani','cylinder','maintenance','emi','premium'],
    Health: ['health','medicine','doctor','pharmacy','medical','hospital','apollo','pharmeasy','1mg','netmeds','practo','clinic','dawai','dawa','davakhana','dentist'],
    Education: ['education','book','course','college','stationery','exam','udemy','byjus','unacademy','coursera','tuition','fees','fee','school','kitab','copy','pen'],
    Entertainment: ['movie','cinema','game','concert','netflix','spotify','entertainment','hotstar','bookmyshow','pvr','inox','youtube','film','party','picnic','mela'],
  };
  // Banks cut long payee names short ("Roop Sagar Foodw"), so these only have to match the start of a word.
  const CATEGORY_STEMS = {
    Food: ['food', 'restaur', 'kirana', 'bakery', 'sweets', 'dhaba', 'tiffin', 'dairy'],
    Health: ['pharma', 'medic', 'hospital'],
  };
  function detectCategory(text) {
    const lower = String(text || '').toLowerCase();
    for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
      if (words.some(word => new RegExp('(^|\\W)' + word.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '($|\\W)', 'i').test(lower))) return category;
      if ((CATEGORY_STEMS[category] || []).some(stem => new RegExp('(^|\\W)' + stem, 'i').test(lower))) return category;
    }
    return 'Other';
  }
  // A date written out in the text: "on 15 oct", "oct 15 2025", "15/10", "15-10-2026", "3 days ago", "last friday".
  // Returns { date: 'YYYY-MM-DD', match } (match is the text it came from, so it can be taken out) or null. A date with no
  // year is this year, unless that would be more than a month ahead, then it is last year's.
  const MONTH_NUMBERS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_PATTERN = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const WEEKDAY_NUMBERS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  function explicitDate(text, now) {
    const todayIso = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const pad = n => String(n).padStart(2, '0');
    const make = (year, month, day) => { const v = `${year}-${pad(month)}-${pad(day)}`; return isValidDate(v) ? v : null; };
    const dated = (day, month, yearText) => {
      const year = yearText ? (yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)) : now.getFullYear();
      let v = make(year, month, day);
      if (v && !yearText && daysBetween(todayIso, v) > 31) v = make(year - 1, month, day);
      return v;
    };
    let m;
    if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text))) { const v = make(Number(m[1]), Number(m[2]), Number(m[3])); if (v) return { date: v, match: m[0] }; }
    if ((m = /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/.exec(text)) || (m = /\b(\d{1,2})\/(\d{1,2})()\b/.exec(text))) {
      const v = dated(Number(m[1]), Number(m[2]), m[3]); if (v) return { date: v, match: m[0] };
    }
    if ((m = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MONTH_PATTERN + '\\b\\.?(?:,?\\s+(\\d{4}))?', 'i').exec(text))) {
      const v = dated(Number(m[1]), MONTH_NUMBERS[m[2].slice(0, 3).toLowerCase()], m[3] || ''); if (v) return { date: v, match: m[0] };
    }
    if ((m = new RegExp('\\b' + MONTH_PATTERN + '\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?', 'i').exec(text))) {
      const v = dated(Number(m[2]), MONTH_NUMBERS[m[1].slice(0, 3).toLowerCase()], m[3] || ''); if (v) return { date: v, match: m[0] };
    }
    if ((m = /\b(\d{1,2})\s+days?\s+ago\b/i.exec(text))) return { date: addDays(todayIso, -Number(m[1])), match: m[0] };
    if ((m = /\b(?:last\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text))) {
      const target = WEEKDAY_NUMBERS[m[1].toLowerCase()], todayDow = new Date(`${todayIso}T12:00:00`).getDay();
      const back = ((todayDow - target + 7) % 7) || 7;           // the most recent one before today
      return { date: addDays(todayIso, -back), match: m[0] };
    }
    return null;
  }

  function parseNaturalExpense(raw, now = new Date()) {
    const original = String(raw || '').trim();
    if (!original) return { ok: false, error: 'Type an expense first.' };
    const written = explicitDate(original, now);
    const text = written ? original.replace(written.match, ' ').replace(/\s+/g, ' ').trim() : original;
    const amountMatch = text.match(/(?:₹|rs\.?\s*)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?|\.\d{1,2})/i) || text.match(/(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:rupaye|rupay|rupaiye|rupiya|rupees?|rs\b|\/-)/i) || text.match(/(?:spent|paid|cost|costs|bought|for|expense|of)\s+(\d+(?:,\d{3})*(?:\.\d{1,2})?|\.\d{1,2})\b/i) || text.match(/\b(\d+(?:,\d{3})*(?:\.\d{1,2})?)\b/);
    if (!amountMatch) return { ok: false, error: 'I could not find an amount. Try “chai 20 today”.' };
    const amount = Number(amountMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };
    let date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (written) { const [y, mo, d] = written.date.split('-').map(Number); date = new Date(y, mo - 1, d); }
    else if (/\b(?:day before yesterday|parso|parson)\b/i.test(text)) date.setDate(date.getDate() - 2);
    else if (/\b(?:yesterday|kal)\b/i.test(text)) date.setDate(date.getDate() - 1);
    const description = text
      .replace(/(?:₹|rs\.?\s*)\s*\d+(?:,\d{3})*(?:\.\d{1,2})?/ig, ' ')
      .replace(/\b(?:spent|spend|paid|pay|expense|costs?|bought|for|on|today|yesterday|ago|last|day before yesterday|rupees?|aaj|kal|parso|parson|ki|ka|ke|ko|me|mein|se|par|pe|liye|kharcha|kharch|kharche|kiya|kiye|diya|diye|gaya|gayi|hai|tha|maine|humne|rupaye|rupay|rupaiye|rupiya|rs)\b/ig, ' ')
      .replace(/\b\d+(?:,\d{3})*(?:\.\d{1,2})?\b/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim();
    const cleanedDescription = description ? description.charAt(0).toUpperCase() + description.slice(1) : 'Expense';
    return { ok: true, expense: { amount: Math.round(amount * 100) / 100, description: cleanedDescription, category: detectCategory(text), date: formatDate(date) } };
  }
  function formatDate(date) {
    const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function calculateSummary(expenses, budget, month) {
    const inMonth = expenses.filter(item => item.date && item.date.slice(0, 7) === month);
    const spent = Math.round(inMonth.reduce((sum, item) => sum + spendOf(item), 0) * 100) / 100;
    const safeBudget = Math.max(0, Number(budget) || 0);
    return { expenses: inMonth, spent, budget: safeBudget, remaining: Math.round((safeBudget - spent) * 100) / 100, count: inMonth.length, percent: safeBudget ? spent / safeBudget * 100 : 0 };
  }
  // Calendar helpers work on 'YYYY-MM-DD' strings in UTC so DST and time zones never shift a day.
  function parseDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(ms);
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? ms : null;
  }
  function isValidDate(value) { return parseDate(value) !== null; }
  function addDays(value, days) {
    const ms = parseDate(value);
    if (ms === null) return null;
    const d = new Date(ms + days * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function daysBetween(from, to) {
    const a = parseDate(from), b = parseDate(to);
    return a === null || b === null ? NaN : Math.round((b - a) / 86400000);
  }
  function daysInMonth(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() : NaN;
  }
  // 'YYYY-MM' moved by n months (n may be negative).
  function shiftMonth(month, n) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  // The given day of a month, or the month's last day when it has no such day (the 31st in April is the 30th).
  function dateInMonth(month, day) {
    const dim = daysInMonth(month);
    return Number.isFinite(dim) ? `${month}-${String(Math.min(Math.max(1, day), dim)).padStart(2, '0')}` : null;
  }
  const round2 = n => Math.round(n * 100) / 100;
  // What an expense really cost YOU. When you paid for others and they owe you back (`owedTotal`), only your own share
  // counts as spending, however much left your account.
  const spendOf = e => Math.max(0, (Number(e && e.amount) || 0) - (Number(e && e.owedTotal) || 0));
  const api = { CATEGORIES, detectCategory, parseNaturalExpense, formatDate, calculateSummary, parseDate, isValidDate, addDays, daysBetween, daysInMonth, shiftMonth, dateInMonth, round2, spendOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ExpenseUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
