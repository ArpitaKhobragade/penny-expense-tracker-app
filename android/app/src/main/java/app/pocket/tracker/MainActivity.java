package app.pocket.tracker;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Says where in the app a tap should land: "add" (the widget's + button) or "review" (the notification). */
    static final String EXTRA_TARGET = "pocket_target";

    // The app's page colours (--bg in today.css), shown behind the status bar and the navigation bar.
    private static final int BACKGROUND_LIGHT = Color.parseColor("#FFFFFF");
    private static final int BACKGROUND_DARK = Color.parseColor("#121212");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins must be registered before the bridge starts.
        registerPlugin(SmsInboxPlugin.class);
        registerPlugin(PocketFilesPlugin.class);
        registerPlugin(PocketLockPlugin.class);
        registerPlugin(PocketWidgetPlugin.class);
        registerPlugin(PocketWindowPlugin.class);
        registerPlugin(PocketExtrasPlugin.class);
        super.onCreate(savedInstanceState);
        QuickAdd.refresh(this);   // put the quick-add notification back if it is switched on
        noteLaunchIntent(getIntent());
        keepClearOfSystemBars();
        handleBackButton();
        if (LockPrefs.secure(this)) blackOutUntilUnlocked();
    }

    /**
     * The phone's Back button asks the web app first (window.pocketBack): it closes an open sheet, goes from a screen
     * opened in More back to More, and from any other tab back to Today. Only when the web app has nothing to go back
     * to (Today) does the app step back to the home screen. Pages without that handler use the browser's own history.
     */
    private void handleBackButton() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView web = getBridge().getWebView();
                web.evaluateJavascript("(function(){return typeof window.pocketBack==='function'?String(window.pocketBack()):'none';})()", value -> {
                    String answer = value == null ? "" : value.replace("\"", "");
                    if ("true".equals(answer)) return;
                    if ("none".equals(answer) && web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
    }

    /**
     * With the app lock on, nothing of the app may show before the fingerprint: the window, the web view and the system bars
     * are black, and screenshots and the recent-apps picture are blocked. The web app brings the colours back once unlocked.
     */
    private void blackOutUntilUnlocked() {
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);
        getBridge().getWebView().setBackgroundColor(Color.BLACK);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    /**
     * Android 15 and later draw an app edge to edge, under the status bar and the navigation bar. The web page cannot
     * see how tall those bars are, so the content is padded here by exactly their size.
     */
    private void keepClearOfSystemBars() {
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            // Not the keyboard: the phone already makes the page shorter when the keyboard opens, so padding for it as well took
        // the keyboard's height off twice and left only a thin strip of the page above a blank gap.
        Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            // How much of the page the keyboard covers (the part of its height above the navigation bar), in the page's own units.
            int covered = windowInsets.isVisible(WindowInsetsCompat.Type.ime()) ? Math.max(0, windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom - bars.bottom) : 0;
            if (covered != keyboardPx) { keyboardPx = covered; tellPageAboutKeyboard(covered / getResources().getDisplayMetrics().density); }
            return WindowInsetsCompat.CONSUMED;
        });
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        applyBarStyle(this, night);
        ViewCompat.requestApplyInsets(content);
    }

    private int keyboardPx;

    /** The keyboard slides over the page and the page stays where it is; the page only moves a field that would be hidden. */
    private void tellPageAboutKeyboard(float cssPixels) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript("if(window.pocketKeyboard)window.pocketKeyboard(" + Math.round(cssPixels) + ")", null);
    }

    /** Background behind the system bars, and dark or light icons on top of it. */
    static void applyBarStyle(Activity activity, boolean dark) {
        Window window = activity.getWindow();
        window.getDecorView().setBackgroundColor(dark ? BACKGROUND_DARK : BACKGROUND_LIGHT);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        noteLaunchIntent(intent);
    }

    // Remember where a tap on a notification or the widget meant to go, so the web app can open that screen.
    private void noteLaunchIntent(Intent intent) {
        if (intent == null) return;
        if (intent.getBooleanExtra(Notifier.EXTRA_OPEN_REVIEW, false)) SmsInboxPlugin.openReviewRequested = true;
        String target = intent.getStringExtra(EXTRA_TARGET);
        if (target != null) SmsInboxPlugin.launchTarget = target;
    }
}
