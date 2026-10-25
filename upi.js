// Payments seen in the notifications of UPI apps (Google Pay, PhonePe, Paytm, BHIM...) that no bank message may ever cover.
// A notification is turned into a short bank-style message, and from there it goes through exactly the same checks as a bank
// SMS: duplicates are recognised, and the bank's own message for the same payment later joins this one instead of adding a second.
(function (root) {
  const AMT = '(?:₹|rs\\.?|inr)\\s*([\\d,]+(?:\\.\\d{1,2})?)';
  const SKIP_RE = /\b(?:failed|declined|unsuccessful|pending|requested|requests?|reminder|cashback|reward|offer|scratch|coupon|due|autopay|mandate|expires?|refund)\b/i;
  const DEBIT_RES = [
    new RegExp(`\\b(?:you\\s+)?(?:paid|sent|payment\\s+of|transferred)\\s*(?:successfully\\s*)?${AMT}\\s*(?:successfully\\s*)?(?:to|at|for)\\s+(.+)`, 'i'),
    new RegExp(`${AMT}\\s*(?:was\\s*)?(?:paid|sent|debited)\\s*(?:successfully\\s*)?(?:to|at)\\s+(.+)`, 'i'),
  ];
  const CREDIT_RES = [
    new RegExp(`\\b(?:received|credited|got)\\s*${AMT}\\s*(?:from|by)\\s+(.+)`, 'i'),
    new RegExp(`^(.+?)\\s+(?:sent|paid)\\s+you\\s*${AMT}`, 'i'),
  ];

  // "Swiggy Payment successful via UPI Ref 1234" -> "Swiggy"; "swiggy@ybl" -> "swiggy"
  function cleanName(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\b(?:payment\s+(?:successful|completed)|successful(?:ly)?|completed|via\s+\w+.*|using\s+.*|from\s+(?:your\s+)?(?:a\/c|account|bank).*|ref(?:erence)?\.?\s*(?:no\.?|id)?[:\s#-]*\d+.*|upi\s*(?:id|ref).*|on\s+\d.*)$/i, '').trim();
    s = s.replace(/@[a-z0-9.\-]+/ig, '').replace(/[.!,\-–—:]+$/g, '').trim();
    return s.slice(0, 40);
  }

  // item: { pkg, app, title, text, postedAt } -> { ok, kind: 'debit' | 'credit', amount, counterparty, app, postedAt } | { ok: false }
  function parseNotification(item) {
    const text = [item && item.title, item && item.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!text || SKIP_RE.test(text)) return { ok: false };
    const base = { ok: true, app: (item && item.app) || '', postedAt: Number(item && item.postedAt) || 0 };
    for (const re of DEBIT_RES) {
      const m = re.exec(text);
      if (m) { const amount = Number(m[1].replace(/,/g, '')); const name = cleanName(m[2]); if (amount > 0) return { ...base, kind: 'debit', amount, counterparty: name }; }
    }
    for (const [i, re] of CREDIT_RES.entries()) {
      const m = re.exec(text);
      if (!m) continue;
      const amount = Number((i === 0 ? m[1] : m[2]).replace(/,/g, '')), name = cleanName(i === 0 ? m[2] : m[1]);
      if (amount > 0) return { ...base, kind: 'credit', amount, counterparty: name };
    }
    return { ok: false };
  }

  // The message the bank-message checks will read, with the same sender for every app.
  function toMessage(parsed) {
    if (!parsed || !parsed.ok) return null;
    const amount = parsed.amount.toFixed(2);
    const body = parsed.kind === 'debit'
      ? `Rs.${amount} debited via UPI to ${parsed.counterparty || 'UPI payment'}`
      : `Rs.${amount} credited via UPI from ${parsed.counterparty || 'someone'}`;
    return { sender: 'UPIAPP', body, receivedAt: parsed.postedAt || Date.now() };
  }

  // Notifications from the phone -> messages for Inbox.ingestNative. Failed, pending and promotional ones are left out.
  const toMessages = items => (items || []).map(item => toMessage(parseNotification(item))).filter(Boolean);

  // Bill reminders only: a notification that reads like "Electricity bill due. Pay ₹1,240 by 27 Oct" becomes a message for the
  // bill checks (`parse` is SmsParser.parseBankSms). Payments, offers and everything else in a notification are left out.
  function billMessages(items, parse) {
    const out = [];
    for (const item of items || []) {
      const body = [item && item.title, item && item.text].filter(Boolean).join('. ').replace(/\s+/g, ' ').trim();
      if (!body) continue;
      const receivedAt = Number(item.postedAt) || Date.now();
      const parsed = parse(body, { sender: 'UPIAPP', receivedAt });
      if (parsed && parsed.ok && parsed.kind === 'upcoming') out.push({ sender: 'UPIAPP', body, receivedAt });
    }
    return out;
  }

  const api = { parseNotification, toMessage, toMessages, cleanName, billMessages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Upi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
