package app.pocket.tracker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A small first-in-first-out list kept in the app's private storage, shared by the UPI-notification queue and the
 * quick-add queue. Same idea as {@link SmsQueue}: items wait here only until the app opens and takes them, then the
 * list is emptied. Every method locks on this queue, so the notification service, the receiver and the app can all use it.
 */
final class JsonQueue {
    private static final String KEY = "items";

    private final String prefsName;
    private final int maxItems;

    JsonQueue(String prefsName, int maxItems) {
        this.prefsName = prefsName;
        this.maxItems = maxItems;
    }

    private SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(prefsName, Context.MODE_PRIVATE);
    }

    private JSONArray read(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Adds an item unless one with the same "id" is already waiting. The oldest are dropped past the limit. */
    synchronized void add(Context context, JSONObject item) {
        JSONArray items = read(context);
        String id = item.optString("id", "");
        if (!id.isEmpty()) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject existing = items.optJSONObject(i);
                if (existing != null && id.equals(existing.optString("id", ""))) return;
            }
        }
        items.put(item);
        if (items.length() > maxItems) {
            JSONArray trimmed = new JSONArray();
            for (int i = items.length() - maxItems; i < items.length(); i++) trimmed.put(items.opt(i));
            items = trimmed;
        }
        prefs(context).edit().putString(KEY, items.toString()).apply();
    }

    synchronized int size(Context context) {
        return read(context).length();
    }

    /** Returns everything waiting and empties the queue. */
    synchronized JSONArray drain(Context context) {
        JSONArray items = read(context);
        prefs(context).edit().remove(KEY).apply();
        return items;
    }
}
