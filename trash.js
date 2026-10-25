// Recently deleted. A goal, a Specific period plan or the monthly budget that is deleted is kept here for 30 days, so it can be
// put back exactly as it was. Pure functions: they take the list and return a new one.
// An entry is { id, kind: 'goal' | 'plan' | 'budget', title, deletedAt (ms), data }; `data` holds what is needed to restore it.
(function (root) {
  const DAYS = 30;
  const MAX = 50;
  const KINDS = ['goal', 'plan', 'budget'];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const defaultId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Keeps valid entries that are younger than 30 days, newest first, at most 50.
  function clean(items, now) {
    const limit = (Number.isFinite(now) ? now : Date.now()) - DAYS * DAY_MS;
    return (Array.isArray(items) ? items : [])
      .filter(e => e && typeof e === 'object' && typeof e.id === 'string' && KINDS.includes(e.kind) && e.data && typeof e.data === 'object' && Number(e.deletedAt) > limit)
      .map(e => ({ id: e.id, kind: e.kind, title: String(e.title || '').slice(0, 80), deletedAt: Number(e.deletedAt), data: e.data }))
      .sort((a, b) => b.deletedAt - a.deletedAt)
      .slice(0, MAX);
  }

  // entry: { kind, title, data }. options: { now (ms), newId }.
  function add(items, entry, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const made = { id: (options.newId || defaultId)(), kind: entry.kind, title: String(entry.title || '').slice(0, 80), deletedAt: now, data: entry.data };
    return clean([made, ...(items || [])], now);
  }

  const remove = (items, id) => (items || []).filter(e => e.id !== id);
  const find = (items, id) => (items || []).find(e => e.id === id) || null;

  // "today", "yesterday", "3 days ago"
  function ago(entry, now) {
    const days = Math.floor(((Number.isFinite(now) ? now : Date.now()) - entry.deletedAt) / DAY_MS);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  }
  // Days left before it is removed for good.
  const daysLeft = (entry, now) => Math.max(0, DAYS - Math.floor(((Number.isFinite(now) ? now : Date.now()) - entry.deletedAt) / DAY_MS));

  const api = { DAYS, MAX, KINDS, clean, add, remove, find, ago, daysLeft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Trash = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
