package app.pocket.tracker;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The web app tells the home-screen widget what to show, and can ask Android to offer adding it. */
@CapacitorPlugin(name = "PocketWidget")
public class PocketWidgetPlugin extends Plugin {

    /** Stores the latest figure (a few lines of text) and redraws any widget on the home screen. */
    @PluginMethod
    public void update(PluginCall call) {
        WidgetStore.save(getContext(), call.getData());
        TodayWidget.refresh(getContext());
        call.resolve();
    }

    /** Shows Android's own "add widget" prompt, where supported. The person still has to confirm it. */
    @PluginMethod
    public void pin(PluginCall call) {
        Context context = getContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        boolean supported = Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported();
        if (supported) manager.requestPinAppWidget(new ComponentName(context, TodayWidgetProvider.class), null, null);
        JSObject result = new JSObject();
        result.put("supported", supported);
        call.resolve(result);
    }
}
