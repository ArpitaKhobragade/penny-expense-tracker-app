const assert = require('node:assert/strict');
const B = require('./backup.js');
const S = require('./store.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const fake = (initial = {}) => { const mem = { ...initial }; return { mem, getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } }; };
const populated = () => fake({
  [S.KEY]: JSON.stringify({ budget: 22000, expenses: [{ id: 'a', amount: 5 }, { id: 'b', amount: 6 }], plans: [{ id: 'g', title: 'Laptop' }] }),
  [S.INBOX_KEY]: JSON.stringify({ inbox: [], memory: { swiggy: 'Food' }, dismissed: ['x'] }),
  [S.BILLS_KEY]: JSON.stringify({ bills: [{ id: 'r', title: 'Rent' }], paid: {} }),
  [S.OWED_KEY]: JSON.stringify({ debts: [{ id: 'd1', person: 'Friend', amount: 500, payments: [] }] }),
  [S.SETTINGS_KEY]: JSON.stringify({ mode: 'payday', paydayDay: 25, theme: 'dark' }),
  'something-else': 'not pocket data',
});

test('a backup holds Pocket\'s records and nothing else', () => {
  const file = JSON.parse(B.buildBackup(populated(), new Date(2026, 9, 22, 10)));
  assert.equal(file.format, 'pocket-backup'); assert.equal(file.version, 1); assert.ok(file.exportedAt);
  assert.deepEqual(Object.keys(file.data).sort(), [S.BILLS_KEY, S.INBOX_KEY, S.KEY, S.OWED_KEY, S.SETTINGS_KEY].sort());
  assert.ok(!JSON.stringify(file).includes('not pocket data'));
});

test('restoring on an empty phone gives back exactly what was saved', () => {
  const original = populated();
  const target = fake();
  const r = B.restoreBackup(target, B.buildBackup(original));
  assert.equal(r.ok, true); assert.deepEqual(r.summary, { expenses: 2, goals: 1, bills: 1, owed: 1, accounts: 0, pots: 0 });
  for (const key of B.KEYS) assert.deepEqual(JSON.parse(target.mem[key] || 'null'), JSON.parse(original.mem[key] || 'null'));
  assert.ok(!('something-else' in target.mem));                                 // only Pocket's own records are written
});

test('restoring replaces what is there, and clears records the backup did not have', () => {
  const target = fake({ [S.KEY]: JSON.stringify({ budget: 1, expenses: [{ id: 'old' }] }), [S.BILLS_KEY]: JSON.stringify({ bills: [{ id: 'old' }], paid: {} }) });
  const backup = JSON.stringify({ format: 'pocket-backup', version: 1, data: { [S.KEY]: { budget: 500, expenses: [{ id: 'new' }], plans: [] } } });
  const r = B.restoreBackup(target, backup);
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(target.mem[S.KEY]).expenses[0].id, 'new');
  assert.ok(!(S.BILLS_KEY in target.mem));                                       // the old bill is gone
});

test('files that are not a Pocket backup are refused and nothing is written', () => {
  const target = fake({ [S.KEY]: JSON.stringify({ budget: 7, expenses: [] }) });
  const before = JSON.stringify(target.mem);
  for (const text of ['not json', '{}', '[]', 'null', '{"format":"other","version":1,"data":{}}',
    JSON.stringify({ format: 'pocket-backup', version: 1, data: {} }),
    JSON.stringify({ format: 'pocket-backup', version: 1, data: { [S.KEY]: { expenses: 'nope' } } }),
    JSON.stringify({ format: 'pocket-backup', version: 1, data: [] }),
    JSON.stringify({ format: 'pocket-backup', version: 99, data: { [S.KEY]: {} } })]) {
    const r = B.restoreBackup(target, text);
    assert.equal(r.ok, false, text); assert.ok(r.error);
  }
  assert.equal(JSON.stringify(target.mem), before);
});

test('unknown keys inside a backup are ignored, not written', () => {
  const target = fake();
  const text = JSON.stringify({ format: 'pocket-backup', version: 1, data: { [S.KEY]: { budget: 5, expenses: [], plans: [] }, 'evil-key': { x: 1 }, localStorage: {} } });
  assert.equal(B.restoreBackup(target, text).ok, true);
  assert.deepEqual(Object.keys(target.mem), [S.KEY]);
});

test('a storage that refuses to save is reported, and a missing backup of nothing still works', () => {
  const full = { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} };
  assert.equal(B.restoreBackup(full, JSON.stringify({ format: 'pocket-backup', version: 1, data: { [S.KEY]: { expenses: [] } } })).ok, false);
  const empty = JSON.parse(B.buildBackup(fake(), new Date(2026, 0, 5)));
  assert.deepEqual(empty.data, {});
});

test('backup file names carry the date', () => {
  assert.equal(B.backupFileName(new Date(2026, 9, 2)), 'pocket-backup-2026-10-02.json');
  assert.equal(B.backupFileName(new Date(2026, 11, 25)), 'pocket-backup-2026-12-25.json');
});

console.log(`\n${passed} backup tests passed.`);
