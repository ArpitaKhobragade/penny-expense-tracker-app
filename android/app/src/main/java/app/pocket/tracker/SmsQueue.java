package app.pocket.tracker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Holds bank messages that arrived while Penny was closed, until the app opens and reads them.
 * Stored in the app's private storage, which no other app can read. Once the app has taken the messages
 * the queue is emptied, so a raw message is kept only for as long as it takes you to open Penny.
 */
final class SmsQueue {
    private static final String PREFS = "pocket_sms_queue";
    private static final String KEY = "items";
    private static final int MAX_ITEMS = 200;

    private SmsQueue() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONArray read(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Adds a message and returns how many are now waiting. The oldest are dropped past MAX_ITEMS. */
    static synchronized int add(Context context, String sender, String body, long receivedAt) {
        JSONArray items = read(context);
        try {
            JSONObject item = new JSONObject();
            item.put("sender", sender);
            item.put("body", body);
            item.put("receivedAt", receivedAt);
            items.put(item);
        } catch (JSONException e) {
            return items.length();
        }
        if (items.length() > MAX_ITEMS) {
            JSONArray trimmed = new JSONArray();
            for (int i = items.length() - MAX_ITEMS; i < items.length(); i++) trimmed.put(items.opt(i));
            items = trimmed;
        }
        prefs(context).edit().putString(KEY, items.toString()).apply();
        return items.length();
    }

    static synchronized int size(Context context) {
        return read(context).length();
    }

    /** Returns everything waiting and empties the queue. */
    static synchronized JSONArray drain(Context context) {
        JSONArray items = read(context);
        prefs(context).edit().remove(KEY).apply();
        return items;
    }
}
