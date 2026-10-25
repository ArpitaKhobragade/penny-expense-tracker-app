const assert = require('node:assert/strict');
const L = require('./applock.js');
const S = require('./store.js');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`✓ ${name}`); }

(async () => {
  await test('a PIN and a pattern are checked for shape before they are used', () => {
    assert.equal(L.isPin('1234'), true); assert.equal(L.isPin('12345678'), true);
    assert.equal(L.isPin('123'), false); assert.equal(L.isPin('123456789'), false); assert.equal(L.isPin('12a4'), false); assert.equal(L.isPin(''), false);
    assert.equal(L.isPattern([0, 1, 2, 5]), true);
    assert.equal(L.isPattern([0, 1, 2]), false);          // too short
    assert.equal(L.isPattern([0, 1, 1, 2]), false);       // a dot twice
    assert.equal(L.isPattern([0, 1, 2, 9]), false);       // not on the grid
  });

  await test('the secret is never stored as typed, each credential has its own salt, and only the right one verifies', async () => {
    const a = await L.createCredential('4821'), b = await L.createCredential('4821');
    assert.ok(!JSON.stringify(a).includes('4821'));
    assert.notEqual(a.salt, b.salt); assert.notEqual(a.hash, b.hash);
    assert.equal(await L.verifyCredential(a, '4821'), true);
    assert.equal(await L.verifyCredential(a, '4822'), false);
    assert.equal(await L.verifyCredential(null, '4821'), false);
    assert.equal(await L.verifyCredential({ salt: a.salt, iterations: a.iterations, hash: '00' }, '4821'), false);
  });

  await test('a lock is built for each method, and a bad secret is refused', async () => {
    const pin = await L.buildLock('pin', { pin: '2468' });
    assert.equal(pin.method, 'pin'); assert.ok(pin.pin); assert.equal(pin.pattern, null); assert.equal(L.isSetUp(pin), true);
    const pattern = await L.buildLock('pattern', { pattern: [0, 3, 6, 7, 8] });
    assert.ok(pattern.pattern); assert.equal(pattern.pin, null); assert.equal(L.isSetUp(pattern), true);
    const finger = await L.buildLock('fingerprint', { pin: '1357' });                      // fingerprint keeps a backup PIN
    assert.ok(finger.pin); assert.equal(L.isSetUp(finger), true);
    await assert.rejects(() => L.buildLock('pin', { pin: '12' }), /4 to 8 digits/);
    await assert.rejects(() => L.buildLock('pattern', { pattern: [1, 2] }), /4 dots/);
    await assert.rejects(() => L.buildLock('face', { pin: '1234' }), /Choose/);
    assert.equal(L.isSetUp({ method: '' }), false); assert.equal(L.isSetUp(null), false); assert.equal(L.isOff({ method: 'none' }), true);
  });

  await test('the right PIN or pattern unlocks, a wrong one counts, and tries are slowed after four', async () => {
    let lock = await L.buildLock('pin', { pin: '2468' });
    let r = await L.check(lock, { pin: '0000' }, 1000); assert.equal(r.ok, false); assert.equal(r.lock.failures, 1); assert.equal(r.waitSeconds, 0);
    lock = r.lock;
    for (let i = 0; i < 3; i++) lock = (await L.check(lock, { pin: '0000' }, 2000)).lock;   // fourth wrong try: still no wait
    assert.equal(lock.failures, 4); assert.equal(lock.until, 0);
    r = await L.check(lock, { pin: '0000' }, 3000); assert.equal(r.lock.failures, 5); assert.equal(r.waitSeconds, 30); lock = r.lock;
    r = await L.check(lock, { pin: '2468' }, 10000);                                       // right PIN, but too soon
    assert.equal(r.ok, false); assert.ok(r.waitSeconds > 0 && r.waitSeconds <= 30);
    r = await L.check(lock, { pin: '2468' }, 40000);                                       // after the wait
    assert.equal(r.ok, true); assert.equal(r.lock.failures, 0); assert.equal(r.lock.until, 0);
    const pat = await L.buildLock('pattern', { pattern: [0, 4, 8, 5] });
    assert.equal((await L.check(pat, { pattern: [0, 4, 8, 5] }, 1)).ok, true);
    assert.equal((await L.check(pat, { pattern: [0, 4, 8, 7] }, 1)).ok, false);
    assert.equal((await L.check(pat, { pattern: [0, 4] }, 1)).ok, false);                    // too short is simply wrong
    assert.equal((await L.check(pat, { pin: '0448' }, 1)).ok, false);                        // a PIN is not a pattern
  });

  await test('the wait grows with repeated failures', () => {
    assert.deepEqual([0, 4, 5, 7, 8, 9, 10, 20].map(L.waitSeconds), [0, 0, 30, 30, 120, 120, 300, 300]);
  });

  await test('the lock is saved on its own, never inside the backup, and bad data reads as not set up', async () => {
    const mem = {};
    const storage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    assert.deepEqual(S.loadLock(storage), { method: '', pin: null, pattern: null, failures: 0, until: 0 });
    const lock = await L.buildLock('pin', { pin: '2468' });
    assert.equal(S.saveLock(storage, lock), true);
    const back = S.loadLock(storage);
    assert.equal(back.method, 'pin'); assert.equal(await L.verifyCredential(back.pin, '2468'), true);
    assert.ok(!S.KEY.includes('lock') && !require('./backup.js').KEYS.includes(S.LOCK_KEY));
    storage.setItem(S.LOCK_KEY, '{oops'); assert.equal(S.loadLock(storage).method, '');
    storage.setItem(S.LOCK_KEY, JSON.stringify({ method: 'weird', pin: 5 })); assert.equal(S.loadLock(storage).method, '');
  });

  console.log(`\n${passed} app lock tests passed.`);
})().catch(error => { console.error(error); process.exit(1); });
