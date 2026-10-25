package app.pocket.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

/**
 * Called by Android whenever a text message arrives, even if Penny is closed.
 * Messages that do not look like bank payments are ignored without being stored. The rest wait in
 * {@link SmsQueue} and you get a notification. Penny never sends anything anywhere: the app has no
 * internet permission.
 */
public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "PocketSms";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!AutoReading.isEnabled(context)) return;   // automatic reading is switched off: nothing is looked at or kept
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0 || parts[0] == null) return;

        // A long message arrives as several parts in one broadcast; join them back together.
        String sender = parts[0].getOriginatingAddress();
        StringBuilder body = new StringBuilder();
        for (SmsMessage part : parts) {
            if (part != null && part.getMessageBody() != null) body.append(part.getMessageBody());
        }
        boolean bankSender = BankSmsFilter.isBankSender(sender);
        boolean keep = BankSmsFilter.shouldKeep(sender, body.toString());

        int waiting = -1;
        if (keep) {
            waiting = SmsQueue.add(context, sender, body.toString(), parts[0].getTimestampMillis());
            Notifier.show(context, waiting);
            TodayWidget.refresh(context);
            SmsInboxPlugin.notifyArrived();   // when the app is open it takes the message at once
        }
        logOutcome(context, parts.length, body.length(), bankSender, keep, waiting);
    }

    // In test (debug) builds only: one line saying that a message reached Penny and what was decided. It holds no
    // sender, no text and no amounts, only counts and yes/no answers, so it is safe to read back when checking that
    // Android really does hand messages to Penny.
    private static void logOutcome(Context context, int parts, int length, boolean bankSender, boolean keep, int waiting) {
        if ((context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) return;
        Log.i(TAG, "message received: parts=" + parts + " length=" + length + " bankStyleSender=" + bankSender
                + " kept=" + keep + (keep ? " waiting=" + waiting : ""));
    }
}
