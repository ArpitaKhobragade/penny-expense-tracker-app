// The lock screens: choosing a lock the first time (the fingerprint, with a backup password), the password keypad, the pattern grid, the
// fingerprint prompt, and changing the lock later. The secrets themselves are handled by applock.js; this file only draws
// the screens and passes what was entered to it. Browser only.
(function (root) {
  const doc = root.document;
  const $ = id => doc.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = doc.documentElement;
  const LABELS = { pin: 'Password', pattern: 'Pattern', fingerprint: 'Fingerprint' };

  let storage = null, options = {}, busy = 0, keyHandler = null;
  const lockStore = () => root.Store.loadLock(storage);
  const save = lock => root.Store.saveLock(storage, lock);
  const body = () => $('lock-body');
  const show = html => { setKeys(null); body().innerHTML = html; };
  const setKeys = handler => { if (keyHandler) doc.removeEventListener('keydown', keyHandler); keyHandler = handler; if (handler) doc.addEventListener('keydown', handler); };
  const openApp = () => { page.removeAttribute('data-locked'); setKeys(null); body().innerHTML = ''; if (options.onUnlocked) options.onUnlocked(); };
  // Covers the app in black the moment it is left; `hold` lets a phone screen Penny opened itself (permissions, sharing) come and go.
  let holdUntil = 0;
  const phoneUnlockReady = async () => Boolean(root.PocketLock && root.PocketLock.available() && await root.PocketLock.ready());

  // ---------- keypad ----------
  // Digits 4 to 8; the tick sends them. onSubmit(pin) is called with what was typed. Returns { say(text) }.
  function pinPad({ title, error = '', extra = '', onSubmit }) {
    show(`<h2 class="lock-title">${esc(title)}</h2><div class="pin-dots" id="pin-dots" aria-live="polite"></div><p class="lock-error" id="lock-msg" role="alert">${esc(error)}</p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-key="${n}">${n}</button>`).join('')}<button type="button" data-key="back" aria-label="Delete">⌫</button><button type="button" data-key="0">0</button><button type="button" data-key="ok" class="ok" aria-label="Done">✓</button></div>${extra}`);
    let digits = '';
    const dots = $('pin-dots');
    const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, digits.length) }, (_, i) => `<i class="${i < digits.length ? 'on' : ''}"></i>`).join(''); };
    const say = text => { $('lock-msg').textContent = text || ''; };
    const press = key => {
      if (/^\d$/.test(key)) { if (digits.length < 8) digits += key; say(''); }
      else if (key === 'back' || key === 'Backspace') digits = digits.slice(0, -1);
      else if (key === 'ok' || key === 'Enter') {
        if (digits.length < 4) { say('Use 4 to 8 digits.'); return; }
        const value = digits; digits = ''; draw(); onSubmit(value); return;
      }
      draw();
    };
    draw();
    body().querySelector('.keypad').addEventListener('click', event => { const b = event.target.closest('[data-key]'); if (b) press(b.dataset.key); });
    setKeys(event => { if (/^\d$/.test(event.key) || event.key === 'Backspace' || event.key === 'Enter') press(event.key); });
    return { say };
  }

  // ---------- pattern grid ----------
  // Touch dots in order, lift to finish. onSubmit(dots) gets the dot numbers 0-8 (left to right, top to bottom).
  function patternPad({ title, error = '', extra = '', onSubmit }) {
    const at = i => ({ x: 40 + (i % 3) * 80, y: 40 + Math.floor(i / 3) * 80 });
    show(`<h2 class="lock-title">${esc(title)}</h2><p class="lock-error" id="lock-msg" role="alert">${esc(error)}</p>
      <svg class="pattern" id="pattern-pad" viewBox="0 0 240 240" role="img" aria-label="Pattern grid, nine dots"><polyline id="pattern-trail" points="" />${Array.from({ length: 9 }, (_, i) => `<circle class="dot" data-dot="${i}" cx="${at(i).x}" cy="${at(i).y}" r="11" /><circle class="halo" cx="${at(i).x}" cy="${at(i).y}" r="26" />`).join('')}</svg>${extra}`);
    const svg = $('pattern-pad'), trail = $('pattern-trail');
    let path = [], drawing = false;
    const toSvg = event => { const r = svg.getBoundingClientRect(); return { x: (event.clientX - r.left) * 240 / r.width, y: (event.clientY - r.top) * 240 / r.height }; };
    const dotAt = p => { for (let i = 0; i < 9; i++) { const d = at(i); if (Math.hypot(p.x - d.x, p.y - d.y) < 30) return i; } return -1; };
    const mark = () => svg.querySelectorAll('.dot').forEach((c, i) => c.classList.toggle('on', path.includes(i)));
    const line = p => { trail.setAttribute('points', [...path.map(i => `${at(i).x},${at(i).y}`), ...(p ? [`${p.x},${p.y}`] : [])].join(' ')); };
    const add = p => { const i = dotAt(p); if (i >= 0 && !path.includes(i)) { path.push(i); mark(); } };
    svg.addEventListener('pointerdown', event => { event.preventDefault(); drawing = true; path = []; mark(); try { svg.setPointerCapture(event.pointerId); } catch { /* not needed */ } const p = toSvg(event); add(p); line(p); $('lock-msg').textContent = ''; });
    svg.addEventListener('pointermove', event => { if (!drawing) return; const p = toSvg(event); add(p); line(p); });
    const finish = () => {
      if (!drawing) return;
      drawing = false; const dots = path.slice(); line(null);
      setTimeout(() => { path = []; mark(); line(null); }, 250);
      if (dots.length) onSubmit(dots);
    };
    svg.addEventListener('pointerup', finish); svg.addEventListener('pointercancel', finish);
    return { say: text => { $('lock-msg').textContent = text || ''; } };
  }

  // ---------- unlocking ----------
  const waitText = seconds => `Too many tries. Wait ${seconds} second${seconds === 1 ? '' : 's'}.`;
  async function tryEntry(entry) {
    const result = await root.AppLock.check(lockStore(), entry);
    save(result.lock);
    if (result.ok) return { ok: true };
    return { ok: false, error: result.waitSeconds ? waitText(result.waitSeconds) : `Wrong ${entry.pattern ? 'pattern' : 'password'}. Try again.` };
  }

  async function forgotLink() { return (await phoneUnlockReady()) ? '<button class="lock-link" id="lock-forgot" type="button">Forgot password?</button>' : ''; }
  function wireForgot(next) {
    const link = $('lock-forgot');
    if (!link) return;
    link.addEventListener('click', async () => {
      busy++; const ok = await root.PocketLock.authenticate(); busy--;
      if (ok) chooser({ mandatory: true, message: 'Choose a new lock.', done: openApp }); else $('lock-msg').textContent = 'The phone did not unlock.';
    });
  }

  async function unlockScreen({ onSuccess, error = '', pinOnly = false }) {
    const lock = lockStore(), extra = await forgotLink();
    if (lock.method === 'fingerprint' && !pinOnly && await root.PocketLock.biometricReady()) { fingerprintScreen({ onSuccess, error, extra }); return; }
    const submit = async (entry, pad) => { const r = await tryEntry(entry); if (r.ok) onSuccess(); else pad.say(r.error); };
    if (lock.method === 'pattern') { const pad = patternPad({ title: 'Draw your pattern', error, extra, onSubmit: dots => submit({ pattern: dots }, pad) }); wireForgot(); }
    else { const pad = pinPad({ title: 'Enter your password', error, extra, onSubmit: pin => submit({ pin }, pad) }); wireForgot(); }
  }

  // While the phone's fingerprint prompt is up the screen is only black: no title, no button, no link. If the print is not
  // recognised (the phone gave up), a fingerprint button and a message appear so you can try again; backing out of the prompt
  // goes to the password.
  function fingerprintScreen({ onSuccess, error }) {
    show(error ? fingerprintRetry(error) : '');
    wireRetry();
    const go = async () => {
      busy++; const r = await root.PocketLock.biometricAuth(); busy--;
      if (r.ok) { const lock = lockStore(); save({ ...lock, failures: 0, until: 0 }); onSuccess(); }
      else if (r.cancelled) unlockScreen({ onSuccess, pinOnly: true });
      else { show(fingerprintRetry('That fingerprint did not match.')); wireRetry(); }
    };
    function wireRetry() { const b = $('lock-finger'); if (b) b.addEventListener('click', go); }
    go();
  }
  const fingerprintRetry = message => `<button class="finger-btn" id="lock-finger" type="button" aria-label="Use fingerprint"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 11v3.5c0 2-.6 4-1.7 5.5M8.5 10.5a3.5 3.5 0 0 1 7 0v3c0 2.6-.9 5-2.4 6.8M5.5 10a6.5 6.5 0 0 1 13 0v2.5c0 1.6-.2 3.2-.7 4.7M3.5 12.5c0-.8 0-1.6.1-2.3M7 20c.7-1.2 1.2-2.5 1.5-3.9"/></svg></button><p class="lock-error" id="lock-msg" role="alert">${esc(message)}</p>`;

  // ---------- choosing and setting a lock ----------
  async function chooser({ mandatory, message = '', done }) {
    const fingerprint = await root.PocketLock.biometricReady();
    show(`<h2 class="lock-title">${mandatory ? 'Secure Penny' : 'Change app lock'}</h2><p class="lock-error" id="lock-msg" role="alert">${esc(message)}</p>
      <div class="lock-choices">
        ${fingerprint
          ? '<button type="button" data-method="fingerprint"><strong>Fingerprint</strong><span>With a backup password</span></button>'
          : '<button type="button" data-method="pin"><strong>Password</strong><span>4 to 8 digits. No fingerprint is set up on this phone.</span></button>'}
      </div>${mandatory ? '' : '<button class="lock-link" id="lock-cancel" type="button">Cancel</button>'}`);
    body().querySelector('.lock-choices').addEventListener('click', event => {
      const b = event.target.closest('[data-method]');
      if (!b || b.disabled) return;
      createPin({ method: b.dataset.method, done, back: () => chooser({ mandatory, done }) });
    });
    const cancel = $('lock-cancel');
    if (cancel) cancel.addEventListener('click', () => { page.removeAttribute('data-locked'); setKeys(null); body().innerHTML = ''; });
  }

  const back = back => `<button class="lock-link" id="lock-back" type="button">Back</button>`;
  function wireBack(go) { const b = $('lock-back'); if (b) b.addEventListener('click', go); }

  function createPin({ method, done, back: goBack }) {
    const title = method === 'fingerprint' ? 'Set a backup password' : 'Create a password';
    const first = (error = '') => { pinPad({ title, error, extra: back(), onSubmit: pin => again(pin) }); wireBack(goBack); };
    const again = pin => {
      pinPad({ title: 'Confirm your password', extra: back(), onSubmit: async second => {
        if (second !== pin) { first('The passwords did not match. Try again.'); return; }
        await finish(method, { pin });
      } });
      wireBack(() => first());
    };
    const finish = async (m, secrets) => {
      try {
        const lock = await root.AppLock.buildLock(m, secrets);
        if (m === 'fingerprint') {
          busy++; const r = await root.PocketLock.biometricAuth(); busy--;
          if (!r.ok) { chooser({ mandatory: !isSetUp(), message: 'The fingerprint was not confirmed. Try again or choose another lock.', done }); return; }
        }
        save(lock); done(lock);
      } catch (error) { first(error.message); }
    };
    first();
  }

  function createPattern({ done, back: goBack }) {
    const first = (error = '') => { patternPad({ title: 'Draw a pattern', error, extra: back(), onSubmit: dots => { if (!root.AppLock.isPattern(dots)) first('Connect at least 4 dots.'); else again(dots); } }); wireBack(goBack); };
    const again = dots => {
      patternPad({ title: 'Draw it again', extra: back(), onSubmit: async second => {
        if (second.join('-') !== dots.join('-')) { first('The patterns did not match. Try again.'); return; }
        const lock = await root.AppLock.buildLock('pattern', { pattern: dots });
        save(lock); done(lock);
      } });
      wireBack(() => first());
    };
    first();
  }

  const isSetUp = () => root.AppLock.isSetUp(lockStore());

  const api = {
    // options: { storage, onUnlocked(), onChanged() }
    init(opts) { storage = opts.storage; options = opts; },
    active: () => isSetUp(),
    busy: () => busy > 0,
    methodLabel: () => LABELS[lockStore().method] || 'Not set',

    // First thing when Penny opens: a new user chooses a lock; everyone else unlocks.
    cover() { if (!isSetUp()) return; page.setAttribute('data-locked', ''); setKeys(null); body().innerHTML = ''; },
    hold(ms) { holdUntil = Date.now() + (ms || 90000); },
    held: () => Date.now() < holdUntil,
    release() { holdUntil = 0; },
    async startup() {
      const lock = lockStore();
      if (root.AppLock.isOff(lock)) { page.removeAttribute('data-locked'); return; }
      page.setAttribute('data-locked', '');
      if (root.AppLock.isSetUp(lock)) unlockScreen({ onSuccess: openApp });
      else chooser({ mandatory: true, done: openApp });
    },
    // Coming back after a while away.
    lockNow() { if (!isSetUp()) return; page.setAttribute('data-locked', ''); unlockScreen({ onSuccess: openApp }); },
    // Settings > Change: prove the current lock first, then choose a new one.
    change() {
      page.setAttribute('data-locked', '');
      unlockScreen({ onSuccess: () => chooser({ mandatory: false, done: () => { openApp(); if (options.onChanged) options.onChanged(); } }) });
    },
  };
  root.LockUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
