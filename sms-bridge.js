// The web app's door to the phone's text messages. Inside the Android app it talks to the native "SmsInbox"
// plugin; in a normal browser `available` is false and the rest of the app simply hides the feature.
(function (root) {
  const cap = root.Capacitor;

  // Inside the app, Capacitor puts every native plugin it knows about under Capacitor.Plugins. Some versions also
  // offer registerPlugin(); either way is accepted.
  function findPlugin() {
    if (!cap) return null;
    if (cap.Plugins && cap.Plugins.SmsInbox) return cap.Plugins.SmsInbox;
    if (typeof cap.registerPlugin === 'function') {
      try { return cap.registerPlugin('SmsInbox'); } catch { return null; }
    }
    return null;
  }
  const plugin = findPlugin();
  const list = result => (result && Array.isArray(result.messages) ? result.messages : []);

  const api = {
    available: Boolean(plugin),
    // true inside the Android app's web view even if the native side is not ready, so a problem can be shown
    // instead of the feature silently disappearing
    inApp: Boolean(cap),
    // { receive (permission), enabled (the on/off switch), read, notifications, queued, debug }
    status: () => plugin.status(),
    setAutoReading: enabled => plugin.setAutoReading({ enabled: Boolean(enabled) }),
    requestAutoReading: () => plugin.requestAutoReading(),
    requestRead: () => plugin.requestRead(),
    // { messages: [{ sender, body, receivedAt }], fromNotification, target: 'add' | 'review' | '' }
    drain: async () => {
      const result = await plugin.drain();
      return { messages: list(result), fromNotification: Boolean(result && result.fromNotification), target: String((result && result.target) || '') };
    },
    // Bank payment messages received since `since` (ms), read once from the inbox.
    backfill: async since => list(await plugin.backfill({ since })),
    openAppSettings: () => plugin.openAppSettings(),
    // Called the moment a message is queued while the app is open.
    onArrive: handler => { try { plugin.addListener('smsArrived', handler); } catch { /* the app drains on its own timer too */ } },
    simulate: () => plugin.simulate(),
  };
  root.SmsBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
