package app.pocket.tracker;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The on/off switch for reading bank messages as they arrive. Android's permission only says whether Penny is allowed to
 * be told about new messages; this says whether it should act on them. It is on unless the person turns it off.
 */
final class AutoReading {
    private static final String PREFS = "pocket_auto_reading";
    private static final String KEY = "enabled";

    private AutoReading() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY, true);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY, enabled).apply();
    }
}
