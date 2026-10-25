package app.pocket.tracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

/**
 * The "Penny · Add an expense" notification that stays in the shade. It has a text box: type "chai 20", send it, and
 * {@link QuickAddReceiver} keeps the text until Penny opens. The notification is quiet: no sound, no vibration, low priority.
 */
final class QuickAdd {
    static final String RESULT_KEY = "text";
    static final int NOTIFICATION_ID = 1002;
    private static final String CHANNEL_ID = "quick_add";
    private static final String DEFAULT_TEXT = "Type what you spent, like “chai 20”";

    private QuickAdd() {}

    static boolean canNotify(Context context) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    /** Puts the notification back if it is switched on and notifications are allowed; takes it away otherwise. Safe to call any time. */
    static void refresh(Context context) {
        try {
            if (ExtrasPrefs.isQuickAddEnabled(context) && canNotify(context)) post(context, null);
            else cancel(context);
        } catch (RuntimeException e) {
            // Never let this crash a launch or a boot.
        }
    }

    /** Posts (or re-posts) the notification. "saved" is the text just received, or null for the plain prompt. */
    static void post(Context context, String saved) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Quick add", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("A quiet notification where you can type an expense without opening Penny.");
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }

        // Tapping the notification opens Penny, the same way the bank-message notification does.
        Intent open = new Intent(context, MainActivity.class);
        open.putExtra(MainActivity.EXTRA_TARGET, "add");
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // The reply goes to an explicit receiver in this app. Android fills in the typed text, so the PendingIntent must be mutable.
        Intent reply = new Intent(context, QuickAddReceiver.class);
        reply.setPackage(context.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent send = PendingIntent.getBroadcast(context, 2, reply, flags);
        RemoteInput input = new RemoteInput.Builder(RESULT_KEY).setLabel("chai 20").build();
        NotificationCompat.Action action = new NotificationCompat.Action.Builder(R.drawable.ic_stat_pocket, "Add", send)
                .addRemoteInput(input)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build();

        String body = saved == null
                ? DEFAULT_TEXT
                : "Saved “" + saved + "” — it will be counted when you open Penny";
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_pocket)
                .setContentTitle("Penny · Add an expense")
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .addAction(action)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build();
        manager.notify(NOTIFICATION_ID, notification);
    }

    static void cancel(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
    }
}
