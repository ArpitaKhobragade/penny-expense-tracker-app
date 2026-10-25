package app.pocket.tracker;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Called by Android when a widget is added, resized, or due its regular refresh. */
public class TodayWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        TodayWidget.update(context, manager, appWidgetIds);
    }
}
