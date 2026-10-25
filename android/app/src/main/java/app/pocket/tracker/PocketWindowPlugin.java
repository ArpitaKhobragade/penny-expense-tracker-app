package app.pocket.tracker;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the strips behind the status bar and the navigation bar, and the colour of their icons, in step with the app's
 * light or dark look. The web app calls this whenever the look changes, so a theme chosen inside Penny (not only the
 * phone's own setting) is respected.
 */
@CapacitorPlugin(name = "PocketWindow")
public class PocketWindowPlugin extends Plugin {

    /** { dark: true | false } */
    @PluginMethod
    public void setTheme(PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> MainActivity.applyBarStyle(getActivity(), dark));
        call.resolve();
    }
}
