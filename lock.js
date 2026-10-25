// The web side of the app lock. Inside the Android app it asks the phone's own unlock screen; in a browser there is
// nothing to lock with, so `available` is false and the setting is hidden.
(function (root) {
  const plugin = () => (root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.PocketLock) || null;
  const AFTER_MS = 0;   // the app asks again every time you come back to it

  const api = {
    AFTER_MS,
    available: () => Boolean(plugin()),
    // Is a screen lock set up on the phone?
    ready: async () => { try { return Boolean((await plugin().isAvailable()).available); } catch { return false; } },
    // Shows the phone's unlock screen. true only if the person unlocked it.
    authenticate: async () => { try { return (await plugin().authenticate()).ok === true; } catch { return false; } },
    // Is a fingerprint set up on the phone for Penny to ask for? (false in a browser)
    biometricReady: async () => { try { return Boolean((await plugin().biometricStatus()).available); } catch { return false; } },
    // Shows the phone's fingerprint prompt. { ok } is true only for a match; { cancelled } means "use the password instead".
    biometricAuth: async () => { try { const r = await plugin().biometricAuth({ title: 'Unlock Penny', backup: 'Use password' }); return { ok: r.ok === true, cancelled: r.cancelled === true }; } catch { return { ok: false, cancelled: true }; } },
    // `enabled`: the lock is on (the next start opens black). `shield` (default: same): hide Penny in recent apps and block screenshots right now.
    setSecure: async (enabled, shield) => { try { await plugin().setSecureWindow({ enabled: Boolean(enabled), shield: shield === undefined ? Boolean(enabled) : Boolean(shield) }); } catch { /* not available */ } },
    // Whether coming back to the app after `awayMs` should ask for the lock again.
    shouldRelock: (enabled, awayMs) => Boolean(enabled) && awayMs > AFTER_MS,
  };
  root.PocketLock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
