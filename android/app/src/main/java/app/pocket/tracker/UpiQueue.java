package app.pocket.tracker;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Payment-app notifications that arrived while Penny was closed, until the app opens and reads them.
 * Stored in the app's private storage and emptied as soon as the app has taken them.
 */
final class UpiQueue {
    private static final JsonQueue QUEUE = new JsonQueue("pocket_upi_queue", 200);

    private UpiQueue() {}

    static void add(Context context, String id, String pkg, String app, String title, String text, long postedAt) {
        try {
            JSONObject item = new JSONObject();
            item.put("id", id);
            item.put("pkg", pkg);
            item.put("app", app);
            item.put("title", title);
            item.put("text", text);
            item.put("postedAt", postedAt);
            QUEUE.add(context, item);
        } catch (JSONException e) {
            // Nothing sensible to do; the notification is simply not kept.
        }
    }

    static JSONArray drain(Context context) {
        return QUEUE.drain(context);
    }
}
