package app.pocket.tracker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Remembers what the app last told the widget, in the app's private storage. Only the few lines of text the widget
 * shows are kept, never the expense list.
 */
final class WidgetStore {
    private static final String PREFS = "pocket_widget";
    private static final String KEY = "state";

    private WidgetStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context context, JSONObject state) {
        prefs(context).edit().putString(KEY, state.toString()).apply();
    }

    /** Null when the app has never reported anything. */
    static WidgetModel.State load(Context context) {
        String raw = prefs(context).getString(KEY, null);
        if (raw == null) return null;
        try {
            JSONObject o = new JSONObject(raw);
            WidgetModel.State s = new WidgetModel.State();
            s.date = o.optString("date", "");
            s.tone = o.optString("tone", "normal");
            s.label = o.optString("label", "");
            s.amountText = o.optString("amountText", "");
            s.sub = o.optString("sub", "");
            s.tomorrowText = o.optString("tomorrowText", "");
            s.hide = o.optBoolean("hide", false);
            s.waiting = o.optInt("waiting", 0);
            return s;
        } catch (JSONException e) {
            return null;
        }
    }
}
