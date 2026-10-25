// The secrets behind the app lock: a PIN or a pattern. Neither is ever stored as typed. Each is turned into a salted
// PBKDF2 hash, and wrong tries are slowed down. Fingerprint is handled by the phone itself (see lock.js); choosing it still
// needs a backup PIN here, so a fingerprint that stops working never locks you out.
// Pure functions over plain data, plus Web Crypto, which the browser and Node both provide.
(function (root) {
  const ITERATIONS = 100000;
  const subtle = () => (root.crypto && root.crypto.subtle) || null;
  const toHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = hex => new Uint8Array((hex.match(/../g) || []).map(h => parseInt(h, 16)));

  const isPin = value => /^\d{4,8}$/.test(String(value || ''));
  // A pattern is the dots touched, in order, numbered 0-8 across the 3 x 3 grid. At least four different dots.
  const isPattern = dots => Array.isArray(dots) && dots.length >= 4 && dots.every(d => Number.isInteger(d) && d >= 0 && d <= 8) && new Set(dots).size === dots.length;
  const patternSecret = dots => `pattern:${dots.join('-')}`;

  async function derive(secret, saltHex, iterations) {
    const crypto = subtle();
    if (!crypto) throw new Error('Secure storage is not available here.');
    const key = await crypto.importKey('raw', new TextEncoder().encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
    return toHex(await crypto.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256));
  }

  // -> { salt, iterations, hash }
  async function createCredential(secret) {
    const salt = toHex(root.crypto.getRandomValues(new Uint8Array(16)));
    return { salt, iterations: ITERATIONS, hash: await derive(secret, salt, ITERATIONS) };
  }

  async function verifyCredential(credential, secret) {
    if (!credential || !credential.hash) return false;
    const attempt = await derive(secret, credential.salt, credential.iterations || ITERATIONS);
    let diff = attempt.length ^ credential.hash.length;                   // compare every character, whatever the first difference
    for (let i = 0; i < attempt.length; i++) diff |= attempt.charCodeAt(i) ^ (credential.hash.charCodeAt(i) || 0);
    return diff === 0;
  }

  // Seconds to wait after this many wrong tries in a row: none for the first four, then longer and longer.
  const waitSeconds = failures => (failures < 5 ? 0 : failures < 8 ? 30 : failures < 10 ? 120 : 300);

  const METHODS = ['pin', 'pattern', 'fingerprint'];

  // lock = { method: 'pin' | 'pattern' | 'fingerprint' | 'none' | '', pin, pattern, failures, until }
  // 'none' is only a development switch (the screens never offer it); '' means nothing has been set yet.
  const isSetUp = lock => Boolean(lock && ((lock.method === 'pin' && lock.pin) || (lock.method === 'pattern' && lock.pattern) || (lock.method === 'fingerprint' && lock.pin)));
  const isOff = lock => Boolean(lock && lock.method === 'none');

  // Builds a complete lock record for a method and its secrets. For fingerprint, `pin` is the backup.
  async function buildLock(method, secrets) {
    if (!METHODS.includes(method)) throw new Error('Choose PIN, pattern or fingerprint.');
    const lock = { method, pin: null, pattern: null, failures: 0, until: 0 };
    if (method === 'pattern') {
      if (!isPattern(secrets.pattern)) throw new Error('Connect at least 4 dots.');
      lock.pattern = await createCredential(patternSecret(secrets.pattern));
    } else {
      if (!isPin(secrets.pin)) throw new Error('Use 4 to 8 digits.');
      lock.pin = await createCredential(secrets.pin);
    }
    return lock;
  }

  // Checks what was entered against the lock. `entry` is { pin } or { pattern }. Returns { ok, lock } with failures and the
  // wait updated, or { ok:false, waitSeconds } when it is too soon to try again.
  async function check(lock, entry, nowMs = Date.now()) {
    if (nowMs < (lock.until || 0)) return { ok: false, lock, waitSeconds: Math.ceil((lock.until - nowMs) / 1000) };
    const credential = entry.pattern ? lock.pattern : lock.pin;
    const secret = entry.pattern ? (isPattern(entry.pattern) ? patternSecret(entry.pattern) : '') : String(entry.pin || '');
    const ok = Boolean(secret) && await verifyCredential(credential, secret);
    if (ok) return { ok: true, lock: { ...lock, failures: 0, until: 0 } };
    const failures = (lock.failures || 0) + 1, wait = waitSeconds(failures);
    return { ok: false, lock: { ...lock, failures, until: wait ? nowMs + wait * 1000 : 0 }, waitSeconds: wait };
  }

  const api = { isPin, isPattern, patternSecret, createCredential, verifyCredential, buildLock, check, waitSeconds, isSetUp, isOff, METHODS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AppLock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
