package app.pocket.tracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * The "bank messages to review" notification. It says how many are waiting but never shows an amount or a
 * merchant, so nothing about your spending appears on the lock screen. Tapping it opens the Review tab.
 */
final class Notifier {
    static final String EXTRA_OPEN_REVIEW = "open_review";
    static final int NOTIFICATION_ID = 1001;
    private static final String CHANNEL_ID = "bank_messages";

    private Notifier() {}

    static void show(Context context, int waiting) {
        if (waiting <= 0) return;
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            debugLog(context, "notification not shown: notification permission is off");
            return;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Bank messages", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Tells you when Penny has found a payment in a bank message.");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(context, MainActivity.class);
        open.putExtra(EXTRA_OPEN_REVIEW, true);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String text = waiting == 1 ? "1 bank message to review" : waiting + " bank messages to review";
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_pocket)
                .setContentTitle("Penny")
                .setContentText(text)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build();
        manager.notify(NOTIFICATION_ID, notification);
        debugLog(context, "notification shown for " + waiting + " waiting");
    }

    // Test (debug) builds only; says nothing about the message itself.
    private static void debugLog(Context context, String text) {
        if ((context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) Log.i("PocketSms", text);
    }

    static void clear(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
    }
}
