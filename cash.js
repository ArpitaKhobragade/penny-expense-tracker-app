// Cash in hand. An ATM withdrawal moves money from the bank to your pocket, so once you add it to the cash wallet it stops
// counting as spending; what you then spend in cash counts when you record it. Pure functions over plain data.
// cashData = { manual: [{ id, amount, date }], dismissed: [expenseId] }
(function (root) {
  const U = typeof require === 'function' ? require('./expense-utils.js') : root.ExpenseUtils;

  const empty = () => ({ manual: [], dismissed: [] });
  const isAtm = e => Boolean(e) && !e.cashIn && /\batm\b|cash withdrawal/i.test(String(e.description || '')) && !e.cash;
  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Cash put in (added ATM withdrawals and cash you added by hand) minus cash you spent.
  function balance(expenses, cashData) {
    const data = cashData || empty();
    const put = (expenses || []).filter(e => e.cashIn).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
      + (data.manual || []).reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    const spent = (expenses || []).filter(e => e.cash && !e.cashIn).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return { in: U.round2(put), spent: U.round2(spent), left: U.round2(put - spent) };
  }

  // ATM withdrawals not yet added to the wallet and not turned down, newest first.
  function offers(expenses, cashData) {
    const skipped = new Set((cashData && cashData.dismissed) || []);
    return (expenses || []).filter(e => isAtm(e) && !skipped.has(e.id)).sort((a, b) => b.date.localeCompare(a.date));
  }

  const addToWallet = (expenses, id) => expenses.map(e => (e.id === id ? { ...e, cashIn: true } : e));
  const removeFromWallet = (expenses, id) => expenses.map(e => { if (e.id !== id) return e; const { cashIn, ...rest } = e; return rest; });
  const skipOffer = (cashData, id) => ({ ...(cashData || empty()), dismissed: [...((cashData && cashData.dismissed) || []), id] });

  function addCash(cashData, amount, date, options = {}) {
    const value = U.round2(Number(amount));
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: 'Enter an amount above zero.' };
    if (!U.isValidDate(date)) return { ok: false, error: 'Pick a date.' };
    const data = cashData || empty();
    return { ok: true, data: { ...data, manual: [...(data.manual || []), { id: ((options && options.newId) || defaultId)(), amount: value, date }] } };
  }
  const removeManual = (cashData, id) => ({ ...(cashData || empty()), manual: ((cashData && cashData.manual) || []).filter(m => m.id !== id) });

  const api = { empty, isAtm, balance, offers, addToWallet, removeFromWallet, skipOffer, addCash, removeManual };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Cash = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
