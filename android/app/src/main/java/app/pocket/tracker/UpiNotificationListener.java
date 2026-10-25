package app.pocket.tracker;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Told by Android about every notification, once the person has given Penny "notification access". Only notifications
 * from the known payment apps are looked at (see {@link UpiApps}), and of those only bill reminders are kept; everything else is
 * ignored. What is kept waits in {@link UpiQueue} and never leaves the phone. Nothing here is ever written to the log.
 */
public class UpiNotificationListener extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || !ExtrasPrefs.isUpiEnabled(this)) return;
            String pkg = sbn.getPackageName();
            String app = UpiApps.nameOf(pkg);
            if (app == null) return;
            Notification notification = sbn.getNotification();
            if (notification == null) return;
            if ((notification.flags & (Notification.FLAG_ONGOING_EVENT | Notification.FLAG_GROUP_SUMMARY)) != 0) return;
            Bundle extras = notification.extras;
            if (extras == null) return;

            String title = asText(extras.getCharSequence(Notification.EXTRA_TITLE));
            String text = asText(extras.getCharSequence(Notification.EXTRA_TEXT));
            String big = asText(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (!big.isEmpty()) text = big;   // the expanded text holds the whole message
            if (title.isEmpty() && text.isEmpty()) return;
            // Only bill reminders matter to Penny. A payment, an offer or a chat notification is dropped here without being kept.
            if (!looksLikeBill(title + " " + text)) return;

            String id = pkg + "|" + sbn.getKey() + "|" + sbn.getPostTime();
            UpiQueue.add(this, id, pkg, app, title, text, sbn.getPostTime());
            PocketExtrasPlugin.notifyArrived("upi");
        } catch (RuntimeException e) {
            // A system callback must never crash the app; this notification is simply skipped.
        }
    }

    private static boolean looksLikeBill(String combined) {
        String lower = combined.toLowerCase(java.util.Locale.ROOT);
        return lower.contains("bill") || lower.contains(" due") || lower.contains("emi") || lower.contains("premium") || lower.contains("recharge");
    }

    private static String asText(CharSequence value) {
        return value == null ? "" : value.toString().trim();
    }
}
