package app.pocket.tracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Draws the home-screen widget from what the app last reported. Tapping it opens Penny, and the + button opens Penny
 * ready to type an expense. On Android 12 and newer the widget picks one of three layouts to suit its size.
 */
final class TodayWidget {
    private enum Size { COMPACT, MEDIUM, WIDE }

    private TodayWidget() {}

    private static String day(int offset) {
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DAY_OF_YEAR, offset);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(calendar.getTime());
    }

    /** Redraws every widget the person has placed. Does nothing if there are none. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidgetProvider.class));
        if (ids != null && ids.length > 0) update(context, manager, ids);
    }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        WidgetModel.Face face = WidgetModel.build(WidgetStore.load(context), day(0), day(-1), SmsQueue.size(context));
        for (int id : ids) {
            RemoteViews views;
            if (Build.VERSION.SDK_INT >= 31) {
                Map<SizeF, RemoteViews> bySize = new HashMap<>();
                bySize.put(new SizeF(110f, 40f), bind(context, face, Size.COMPACT));
                bySize.put(new SizeF(180f, 100f), bind(context, face, Size.MEDIUM));
                bySize.put(new SizeF(260f, 100f), bind(context, face, Size.WIDE));
                views = new RemoteViews(bySize);
            } else {
                views = bind(context, face, Size.MEDIUM);
            }
            manager.updateAppWidget(id, views);
        }
    }

    private static RemoteViews bind(Context context, WidgetModel.Face face, Size size) {
        int layout = size == Size.COMPACT ? R.layout.widget_today_compact : size == Size.WIDE ? R.layout.widget_today_wide : R.layout.widget_today;
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);

        views.setTextViewText(R.id.widget_label, face.label);
        views.setTextViewText(R.id.widget_amount, face.amount);
        views.setInt(R.id.widget_root, "setBackgroundResource",
                face.tone == WidgetModel.OVER ? R.drawable.widget_bg_over : face.tone == WidgetModel.IDLE ? R.drawable.widget_bg_idle : R.drawable.widget_bg_green);

        if (size != Size.COMPACT) {
            views.setTextViewText(R.id.widget_sub, face.sub);
            views.setProgressBar(R.id.widget_progress, 100, face.percent, false);
            views.setViewVisibility(R.id.widget_progress, face.percent > 0 ? View.VISIBLE : View.INVISIBLE);
            if (size == Size.MEDIUM) {
                views.setTextViewText(R.id.widget_extra, face.extra);
                views.setViewVisibility(R.id.widget_extra, face.extra.isEmpty() ? View.GONE : View.VISIBLE);
            }
        }
        if (size == Size.WIDE) {
            views.setTextViewText(R.id.widget_extra, face.extra);
            views.setViewVisibility(R.id.widget_extra, face.extra.isEmpty() ? View.GONE : View.VISIBLE);
            views.setTextViewText(R.id.widget_tomorrow, face.tomorrow);
            views.setViewVisibility(R.id.widget_tomorrow, face.tomorrow.isEmpty() ? View.GONE : View.VISIBLE);
            views.setTextViewText(R.id.widget_bill, face.bill);
            views.setViewVisibility(R.id.widget_bill, face.bill.isEmpty() ? View.GONE : View.VISIBLE);
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class), flags));
        // + opens Penny on Today with the "just type it" box ready
        Intent add = new Intent(context, MainActivity.class).putExtra(MainActivity.EXTRA_TARGET, "add");
        views.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(context, 1, add, flags));
        return views;
    }
}
