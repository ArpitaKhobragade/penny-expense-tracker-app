package app.pocket.tracker;

import android.Manifest;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.provider.Telephony;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ThreadLocalRandom;

/**
 * The bridge between the web app and the phone's text messages.
 * "receive" lets Penny be told about new messages, "read" is only used for the optional one-time scan of
 * this month's messages, and "notifications" lets it tell you when a payment is waiting for review.
 */
@CapacitorPlugin(
        name = "SmsInbox",
        permissions = {
                @Permission(alias = "receive", strings = {Manifest.permission.RECEIVE_SMS}),
                @Permission(alias = "read", strings = {Manifest.permission.READ_SMS}),
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        })
public class SmsInboxPlugin extends Plugin {
    private static final int MAX_SCAN_RESULTS = 400;

    /** Set by MainActivity when Penny was opened from the notification, so the web app can show Review. */
    static volatile boolean openReviewRequested = false;

    /** Set by MainActivity when a tap on the widget or a notification meant a specific screen: "add" or "review". */
    static volatile String launchTarget = "";

    /** The running plugin, while the web view is alive. A new message tells it straight away so the app can show it at once. */
    private static volatile SmsInboxPlugin live;

    @Override
    public void load() { live = this; }

    @Override
    protected void handleOnDestroy() { if (live == this) live = null; }

    /** Tells the web app a message has just been queued. Returns false when the app is not running (it drains the queue when opened). */
    static boolean notifyArrived() {
        SmsInboxPlugin plugin = live;
        if (plugin == null) return false;
        try { plugin.notifyListeners("smsArrived", new JSObject()); return true; }
        catch (RuntimeException ignored) { return false; }
    }

    private boolean granted(String alias) {
        return getPermissionState(alias) == PermissionState.GRANTED;
    }

    private boolean notificationsAllowed() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    private boolean isDebuggable() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private JSObject statusObject() {
        JSObject status = new JSObject();
        status.put("receive", granted("receive"));
        status.put("enabled", AutoReading.isEnabled(getContext()));
        status.put("read", granted("read"));
        status.put("notifications", notificationsAllowed());
        status.put("queued", SmsQueue.size(getContext()));
        status.put("debug", isDebuggable());
        return status;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    /** The on/off switch: { enabled: true | false }. Turning it off keeps the permission but ignores new messages. */
    @PluginMethod
    public void setAutoReading(PluginCall call) {
        AutoReading.setEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", true)));
        call.resolve(statusObject());
    }

    /** Asks for permission to be told about new messages, and (on Android 13+) to show notifications. */
    @PluginMethod
    public void requestAutoReading(PluginCall call) {
        List<String> aliases = new ArrayList<>();
        if (!granted("receive")) aliases.add("receive");
        if (Build.VERSION.SDK_INT >= 33 && !granted("notifications")) aliases.add("notifications");
        if (aliases.isEmpty()) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "permissionsResult");
    }

    /** Asks for permission to read existing messages, used only by the one-time scan. */
    @PluginMethod
    public void requestRead(PluginCall call) {
        if (granted("read")) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAliases(new String[]{"read"}, call, "permissionsResult");
    }

    @PermissionCallback
    private void permissionsResult(PluginCall call) {
        call.resolve(statusObject());
    }

    /** Hands over the messages that arrived while the app was closed and empties the waiting list. */
    @PluginMethod
    public void drain(PluginCall call) {
        JSArray messages = new JSArray();
        JSONArray waiting = SmsQueue.drain(getContext());
        for (int i = 0; i < waiting.length(); i++) messages.put(waiting.opt(i));
        Notifier.clear(getContext());
        TodayWidget.refresh(getContext());

        JSObject result = new JSObject();
        result.put("messages", messages);
        String target = launchTarget;
        launchTarget = "";
        result.put("fromNotification", openReviewRequested || "review".equals(target));
        result.put("target", target == null ? "" : target);
        openReviewRequested = false;
        call.resolve(result);
    }

    /**
     * Reads this month's inbox once and returns only the messages that pass the bank-message filter.
     * Everything else is looked at in memory and discarded; it is never stored or returned.
     */
    @PluginMethod
    public void backfill(PluginCall call) {
        if (!granted("read")) {
            call.reject("Permission to read messages has not been given.");
            return;
        }
        Long sinceValue = call.getLong("since");
        long since = sinceValue == null ? 0L : sinceValue;
        JSArray messages = new JSArray();
        String[] columns = {Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE};
        try (Cursor cursor = getContext().getContentResolver().query(
                Telephony.Sms.Inbox.CONTENT_URI, columns, Telephony.Sms.DATE + " >= ?",
                new String[]{String.valueOf(since)}, Telephony.Sms.DATE + " ASC")) {
            if (cursor != null) {
                while (cursor.moveToNext() && messages.length() < MAX_SCAN_RESULTS) {
                    String sender = cursor.getString(0);
                    String body = cursor.getString(1);
                    if (!BankSmsFilter.shouldKeep(sender, body)) continue;
                    JSObject item = new JSObject();
                    item.put("sender", sender);
                    item.put("body", body);
                    item.put("receivedAt", cursor.getLong(2));
                    messages.put(item);
                }
            }
        } catch (RuntimeException e) {
            call.reject("Could not read messages: " + e.getMessage());
            return;
        }
        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }

    /** Opens Penny's page in Android settings, where "Allow restricted settings" lives for installed-by-hand apps. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /**
     * Test helper, only available in debug builds: puts a made-up bank message in the waiting list and shows the
     * notification, so the whole path can be tried without waiting for a real payment.
     */
    @PluginMethod
    public void simulate(PluginCall call) {
        if (!isDebuggable()) {
            call.reject("Not available.");
            return;
        }
        String today = new SimpleDateFormat("dd-MM-yy", Locale.US).format(new Date());
        String reference = String.format(Locale.US, "%012d", ThreadLocalRandom.current().nextLong(1_000_000_000_000L));
        String body = "Rs.120.00 debited from a/c **1234 on " + today + " to VPA test.shop@ybl (UPI Ref No " + reference + ")";
        int waiting = SmsQueue.add(getContext(), "VM-POCKET-S", body, System.currentTimeMillis());
        Notifier.show(getContext(), waiting);
        call.resolve(statusObject());
    }
}
