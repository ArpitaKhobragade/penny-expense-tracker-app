const assert = require('node:assert/strict');
const T = require('./trash.js');
const S = require('./store.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-25T10:00:00').getTime();
let seq = 0;
const newId = () => `t${++seq}`;

test('a deleted goal, plan or budget is kept with its data, newest first', () => {
  let items = [];
  items = T.add(items, { kind: 'goal', title: 'New phone', data: { plan: { id: 'g1', title: 'New phone', saved: 500 } } }, { now: now - 2 * DAY, newId });
  items = T.add(items, { kind: 'plan', title: 'Goa trip', data: { plan: { id: 'p1', amount: 10000 } } }, { now, newId });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(e => e.kind), ['plan', 'goal']);
  assert.equal(T.find(items, items[1].id).data.plan.saved, 500);
});

test('an entry older than 30 days is dropped, and so is anything that is not a valid entry', () => {
  const old = { id: 'a', kind: 'goal', title: 'Old', deletedAt: now - 31 * DAY, data: {} };
  const fresh = { id: 'b', kind: 'budget', title: 'Monthly budget', deletedAt: now - 29 * DAY, data: { budget: 31000 } };
  const junk = [null, 5, { id: 'c', kind: 'nonsense', deletedAt: now, data: {} }, { id: 'd', kind: 'goal', deletedAt: now }, { kind: 'goal', deletedAt: now, data: {} }];
  assert.deepEqual(T.clean([old, fresh, ...junk], now).map(e => e.id), ['b']);
  assert.deepEqual(T.clean('nope', now), []);
});

test('at most 50 entries are kept, the newest', () => {
  let items = [];
  for (let i = 0; i < 60; i++) items = T.add(items, { kind: 'goal', title: `Goal ${i}`, data: {} }, { now: now - i * 1000, newId });
  assert.equal(items.length, T.MAX);
  assert.equal(items[0].title, 'Goal 0');
});

test('removing an entry takes only that one', () => {
  let items = T.add([], { kind: 'goal', title: 'A', data: {} }, { now, newId });
  items = T.add(items, { kind: 'goal', title: 'B', data: {} }, { now: now + 1, newId });
  const gone = items[0].id;
  assert.deepEqual(T.remove(items, gone).map(e => e.title), ['A']);
});

test('how long ago and how many days are left are said in plain words', () => {
  const e = { deletedAt: now - 3 * DAY };
  assert.equal(T.ago({ deletedAt: now - 1000 }, now), 'today');
  assert.equal(T.ago({ deletedAt: now - DAY - 1000 }, now), 'yesterday');
  assert.equal(T.ago(e, now), '3 days ago');
  assert.equal(T.daysLeft(e, now), 27);
  assert.equal(T.daysLeft({ deletedAt: now - 40 * DAY }, now), 0);
});

test('recently deleted items are saved on the phone and read back, and a restored backup brings them back too', () => {
  const mem = {}, storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(S.loadTrash(storage, now), []);
  const items = T.add([], { kind: 'goal', title: 'Bike', data: { plan: { id: 'g9', title: 'Bike', saved: 40 } } }, { now, newId });
  assert.equal(S.saveTrash(storage, items), true);
  const back = S.loadTrash(storage, now);
  assert.equal(back.length, 1); assert.equal(back[0].data.plan.saved, 40);
  mem[S.TRASH_KEY] = '{"broken":';
  assert.deepEqual(S.loadTrash(storage, now), []);
  const Backup = require('./backup.js');
  assert.ok(Backup.KEYS.includes(S.TRASH_KEY));
});

console.log(`\n${passed} recently deleted tests passed.`);
