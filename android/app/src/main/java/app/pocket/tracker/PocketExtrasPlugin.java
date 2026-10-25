package app.pocket.tracker;

import android.app.Activity;
import android.content.Intent;
import android.provider.Settings;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;

/**
 * Small extras for the web app: share text, speak an expense, read payment-app notifications, and a quick-add
 * notification. Everything stays on the phone; nothing here uses the internet.
 */
@CapacitorPlugin(name = "PocketExtras")
public class PocketExtrasPlugin extends Plugin {
    private static volatile PocketExtrasPlugin live;

    @Override
    public void load() { live = this; }

    @Override
    protected void handleOnDestroy() { if (live == this) live = null; }

    /** Tells the web app something new was queued ("upi" or "quick") so it can take it at once. */
    static void notifyArrived(String what) {
        PocketExtrasPlugin plugin = live;
        if (plugin == null) return;
        try { plugin.notifyListeners(what + "Arrived", new JSObject()); } catch (RuntimeException ignored) { /* the app drains the queue when opened */ }
    }

    // ---- Share ----

    /** Opens Android's share sheet with some plain text. */
    @PluginMethod
    public void shareText(PluginCall call) {
        final String text = call.getString("text", "");
        if (text == null || text.isEmpty()) {
            call.reject("Nothing to share.");
            return;
        }
        final String title = call.getString("title", "");
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
            getActivity().startActivity(Intent.createChooser(send, title == null || title.isEmpty() ? null : title));
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not open the share sheet.");
        }
    }

    // ---- Voice ----

    /** Opens the phone's speech recogniser and resolves { text } with what was heard. */
    @PluginMethod
    public void listenVoice(PluginCall call) {
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Say what you spent");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                call.reject("unavailable");
                return;
            }
            startActivityForResult(call, intent, "voiceResult");
        } catch (RuntimeException e) {
            call.reject("unavailable");
        }
    }

    @ActivityCallback
    private void voiceResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String heard = "";
        if (result != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> results = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (results != null && !results.isEmpty() && results.get(0) != null) heard = results.get(0).trim();
        }
        if (heard.isEmpty()) {
            call.reject("cancelled");
            return;
        }
        JSObject answer = new JSObject();
        answer.put("text", heard);
        call.resolve(answer);
    }

    // ---- Payment-app notifications ----

    private boolean notificationAccessGranted() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    /** granted: Android's "notification access" is given to Penny. enabled: the person's own on/off choice. */
    @PluginMethod
    public void upiStatus(PluginCall call) {
        JSObject status = new JSObject();
        status.put("granted", notificationAccessGranted());
        status.put("enabled", ExtrasPrefs.isUpiEnabled(getContext()));
        call.resolve(status);
    }

    @PluginMethod
    public void upiSetEnabled(PluginCall call) {
        ExtrasPrefs.setUpiEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }

    /** Opens Android's "notification access" screen, where the person allows Penny. */
    @PluginMethod
    public void upiOpenSettings(PluginCall call) {
        try {
            Intent settings = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not open the settings screen.");
        }
    }

    /** Returns the payment-app notifications captured since the last call, and empties the queue. */
    @PluginMethod
    public void upiDrain(PluginCall call) {
        call.resolve(itemsObject(UpiQueue.drain(getContext())));
    }

    // ---- Quick add ----

    private JSObject quickAddObject() {
        JSObject status = new JSObject();
        status.put("enabled", ExtrasPrefs.isQuickAddEnabled(getContext()));
        status.put("canNotify", QuickAdd.canNotify(getContext()));
        return status;
    }

    @PluginMethod
    public void quickAddStatus(PluginCall call) {
        call.resolve(quickAddObject());
    }

    /** Saves the choice and puts up (or takes down) the notification. If notifications are off the choice is still saved. */
    @PluginMethod
    public void quickAddSet(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        ExtrasPrefs.setQuickAddEnabled(getContext(), enabled);
        QuickAdd.refresh(getContext());
        call.resolve(quickAddObject());
    }

    /** Returns the texts typed into the notification since the last call, and empties the queue. */
    @PluginMethod
    public void quickAddDrain(PluginCall call) {
        call.resolve(itemsObject(QuickAddQueue.drain(getContext())));
    }

    private static JSObject itemsObject(JSONArray queued) {
        JSArray items = new JSArray();
        for (int i = 0; i < queued.length(); i++) {
            JSONObject item = queued.optJSONObject(i);
            if (item != null) items.put(item);
        }
        JSObject result = new JSObject();
        result.put("items", items);
        return result;
    }
}
