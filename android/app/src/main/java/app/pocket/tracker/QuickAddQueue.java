package app.pocket.tracker;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/**
 * Texts typed into the quick-add notification ("chai 20") while Penny was closed, until the app opens and counts them.
 * Stored in the app's private storage and emptied as soon as the app has taken them.
 */
final class QuickAddQueue {
    private static final JsonQueue QUEUE = new JsonQueue("pocket_quick_add_queue", 100);

    private QuickAddQueue() {}

    static void add(Context context, String text, long at) {
        try {
            JSONObject item = new JSONObject();
            item.put("id", UUID.randomUUID().toString());
            item.put("text", text);
            item.put("at", at);
            QUEUE.add(context, item);
        } catch (JSONException e) {
            // Nothing sensible to do; the text is simply not kept.
        }
    }

    static JSONArray drain(Context context) {
        return QUEUE.drain(context);
    }
}
