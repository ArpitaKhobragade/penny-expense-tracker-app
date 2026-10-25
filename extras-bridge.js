// The web app's door to the phone's extra abilities: sharing a message, speaking an expense, reading UPI app notifications and the
// "add an expense" notification. Inside the Android app it talks to the native "PocketExtras" plugin; in a normal browser
// `available` is false and the rest of the app simply hides these features.
(function (root) {
  const cap = root.Capacitor;
  const plugin = cap && cap.Plugins && cap.Plugins.PocketExtras ? cap.Plugins.PocketExtras : null;
  const items = result => (result && Array.isArray(result.items) ? result.items : []);

  const api = {
    available: Boolean(plugin),
    // Opens the phone's share sheet with a ready message. Without the app it falls back to the browser's share or the clipboard.
    shareText: async (text, title) => {
      if (plugin) return plugin.shareText({ text, title: title || '' });
      if (root.navigator && root.navigator.share) return root.navigator.share({ text, title: title || '' });
      if (root.navigator && root.navigator.clipboard) { await root.navigator.clipboard.writeText(text); return { copied: true }; }
      throw new Error('unavailable');
    },
    // Opens the phone's voice typing; resolves { text } or rejects 'cancelled' / 'unavailable'.
    listenVoice: () => plugin.listenVoice(),
    // { granted (notification access), enabled (the switch) }
    upiStatus: () => plugin.upiStatus(),
    upiSetEnabled: enabled => plugin.upiSetEnabled({ enabled: Boolean(enabled) }),
    upiOpenSettings: () => plugin.upiOpenSettings(),
    // [{ id, pkg, app, title, text, postedAt }], then the phone forgets them
    upiDrain: async () => items(await plugin.upiDrain()),
    // { enabled, canNotify }
    quickAddStatus: () => plugin.quickAddStatus(),
    quickAddSet: enabled => plugin.quickAddSet({ enabled: Boolean(enabled) }),
    // [{ id, text, at }] typed in the notification, then the phone forgets them
    quickAddDrain: async () => items(await plugin.quickAddDrain()),
    // Called the moment a UPI notification or a notification-bar expense is queued while the app is open.
    onArrive: handler => { if (!plugin) return; for (const name of ['upiArrived', 'quickArrived']) { try { plugin.addListener(name, handler); } catch { /* the timer covers it */ } } },
  };
  root.ExtrasBridge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
