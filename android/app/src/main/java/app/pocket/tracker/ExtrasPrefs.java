package app.pocket.tracker;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The on/off switches for the two optional extras: reading payment-app notifications, and the quick-add notification.
 * Both are off until the person turns them on.
 */
final class ExtrasPrefs {
    private static final String PREFS = "pocket_extras";
    private static final String KEY_UPI = "upi_enabled";
    private static final String KEY_QUICK_ADD = "quick_add_enabled";

    private ExtrasPrefs() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isUpiEnabled(Context context) {
        return prefs(context).getBoolean(KEY_UPI, false);
    }

    static void setUpiEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_UPI, enabled).apply();
    }

    static boolean isQuickAddEnabled(Context context) {
        return prefs(context).getBoolean(KEY_QUICK_ADD, false);
    }

    static void setQuickAddEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_QUICK_ADD, enabled).apply();
    }
}
