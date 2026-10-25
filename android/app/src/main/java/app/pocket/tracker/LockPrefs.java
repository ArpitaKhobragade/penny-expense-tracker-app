package app.pocket.tracker;

import android.content.Context;

/**
 * Whether the app lock is switched on. The web app tells this to {@link PocketLockPlugin}; MainActivity reads it at the very
 * start, before any page is drawn, so a locked app opens on a black screen and never flashes its contents.
 */
final class LockPrefs {
    private static final String FILE = "pocket_lock";
    private static final String KEY = "secure";

    private LockPrefs() { }

    static boolean secure(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    static void setSecure(Context context, boolean on) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply();
    }
}
