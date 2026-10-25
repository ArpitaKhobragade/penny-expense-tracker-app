// Saving all of Penny's data to one file and putting it back. Penny keeps everything on the phone only, so this file is
// the only copy you control: it can move your data to a new phone or recover it after a reinstall.
// The file is plain JSON. Only Penny's own records are read from it, and anything else in it is ignored.
(function (root) {
  const S = typeof require === 'function' ? require('./store.js') : root.Store;

  const KEYS = [S.KEY, S.INBOX_KEY, S.SWEEP_KEY, S.BILLS_KEY, S.OWED_KEY, S.ACCOUNTS_KEY, S.POTS_KEY, S.CASH_KEY, S.SETTINGS_KEY, S.TRASH_KEY];
  const FORMAT = 'pocket-backup';
  const VERSION = 1;

  const pad = n => String(n).padStart(2, '0');
  const backupFileName = now => `pocket-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;

  function readKey(storage, key) {
    try {
      const value = JSON.parse(storage.getItem(key));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch { return null; }
  }

  // Everything Penny has saved, as one JSON text. With options.since ('YYYY-MM-DD'), only expenses on or after that day
  // are included; everything else (goals, bills, settings and so on) is always included.
  function buildBackup(storage, now = new Date(), options = {}) {
    const data = {};
    for (const key of KEYS) {
      const value = readKey(storage, key);
      if (value) data[key] = value;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(options.since || '') && data[S.KEY] && Array.isArray(data[S.KEY].expenses)) {
      data[S.KEY] = { ...data[S.KEY], expenses: data[S.KEY].expenses.filter(e => e && e.date && e.date >= options.since) };
    }
    return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: now.toISOString(), data }, null, 2);
  }

  const count = (data, key, field) => (data[key] && Array.isArray(data[key][field]) ? data[key][field].length : 0);

  // Checks a backup file's text. Returns { ok, data, summary } or { ok:false, error }. Nothing is written here.
  function parseBackup(text) {
    let file;
    try { file = JSON.parse(text); } catch { return { ok: false, error: 'That file is not a Penny backup.' }; }
    if (!file || file.format !== FORMAT || typeof file.data !== 'object' || file.data === null || Array.isArray(file.data)) return { ok: false, error: 'That file is not a Penny backup.' };
    if (!(file.version >= 1) || file.version > VERSION) return { ok: false, error: 'That backup was made by a newer version of Penny. Update Penny and try again.' };

    const data = {};
    for (const key of KEYS) {
      const value = file.data[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) data[key] = value;
    }
    if (!data[S.KEY]) return { ok: false, error: 'That backup does not contain any of your budget or expenses.' };
    const main = data[S.KEY];
    for (const field of ['expenses', 'plans']) {
      if (main[field] !== undefined && !Array.isArray(main[field])) return { ok: false, error: 'That backup file looks damaged.' };
    }
    return {
      ok: true, data, exportedAt: file.exportedAt || '',
      summary: { expenses: count(data, S.KEY, 'expenses'), goals: count(data, S.KEY, 'plans'), bills: count(data, S.BILLS_KEY, 'bills'), owed: count(data, S.OWED_KEY, 'debts'), accounts: count(data, S.ACCOUNTS_KEY, 'accounts'), pots: count(data, S.POTS_KEY, 'pots') },
    };
  }

  // Replaces everything Penny has saved with the backup. Keys the backup does not have are cleared, so the result
  // is exactly what was backed up.
  function restoreBackup(storage, text) {
    const parsed = parseBackup(text);
    if (!parsed.ok) return parsed;
    try {
      for (const key of KEYS) {
        if (parsed.data[key]) storage.setItem(key, JSON.stringify(parsed.data[key]));
        else if (typeof storage.removeItem === 'function') storage.removeItem(key);
      }
    } catch { return { ok: false, error: 'Could not save the restored data. Check your storage settings.' }; }
    return { ok: true, summary: parsed.summary };
  }

  const api = { KEYS, buildBackup, parseBackup, restoreBackup, backupFileName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Backup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
