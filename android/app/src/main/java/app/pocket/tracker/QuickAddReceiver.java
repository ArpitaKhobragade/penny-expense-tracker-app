package app.pocket.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

/**
 * Called when you send text from the quick-add notification. The text is kept in {@link QuickAddQueue} until Penny
 * opens, and the notification is posted again so its progress spinner stops. Only Penny's own notification can reach this
 * (it is not exported). The text is never logged.
 */
public class QuickAddReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (intent == null) return;
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            if (results == null) return;
            CharSequence typed = results.getCharSequence(QuickAdd.RESULT_KEY);
            String text = typed == null ? "" : typed.toString().trim();
            if (text.isEmpty()) {
                QuickAdd.refresh(context);   // nothing to keep, but stop the spinner
                return;
            }
            QuickAddQueue.add(context, text, System.currentTimeMillis());
            PocketExtrasPlugin.notifyArrived("quick");
            if (ExtrasPrefs.isQuickAddEnabled(context)) QuickAdd.post(context, text);
        } catch (RuntimeException e) {
            // A broadcast must never crash the app; this text is simply not kept.
        }
    }
}
