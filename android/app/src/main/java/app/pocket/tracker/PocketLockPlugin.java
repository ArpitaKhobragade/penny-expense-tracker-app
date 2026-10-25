package app.pocket.tracker;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.view.WindowManager;

import java.util.concurrent.Executor;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Locks Penny behind the phone's own screen lock (PIN, pattern, password or fingerprint). Penny never sees or stores
 * any credential: Android shows its own unlock screen and only says yes or no. While the lock is on, the window is also
 * marked secure, which hides Penny's content in the recent-apps view and blocks screenshots of it.
 */
@CapacitorPlugin(name = "PocketLock")
public class PocketLockPlugin extends Plugin {

    private KeyguardManager keyguard() {
        return (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
    }

    private boolean hasScreenLock() {
        KeyguardManager manager = keyguard();
        return manager != null && manager.isDeviceSecure();
    }

    /** Is a screen lock set up on the phone? Without one there is nothing to unlock with. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", hasScreenLock());
        call.resolve(result);
    }

    /** Shows Android's unlock screen. Resolves { ok: true } only if the person unlocked it. */
    @PluginMethod
    public void authenticate(PluginCall call) {
        KeyguardManager manager = keyguard();
        if (manager == null || !manager.isDeviceSecure()) {
            call.reject("No screen lock is set on this phone.");
            return;
        }
        Intent intent = manager.createConfirmDeviceCredentialIntent("Unlock Penny", "Use your phone's screen lock to open Penny");
        if (intent == null) {
            call.reject("No screen lock is set on this phone.");
            return;
        }
        startActivityForResult(call, intent, "authenticationResult");
    }

    @ActivityCallback
    private void authenticationResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject answer = new JSObject();
        answer.put("ok", result != null && result.getResultCode() == Activity.RESULT_OK);
        call.resolve(answer);
    }

    /** Is a fingerprint set up on this phone that Penny can ask for? Needs Android 11 or newer. */
    @PluginMethod
    public void biometricStatus(PluginCall call) {
        boolean available = false;
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricManager manager = getContext().getSystemService(BiometricManager.class);
            available = manager != null
                    && manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        JSObject result = new JSObject();
        result.put("available", available);
        call.resolve(result);
    }

    /**
     * Shows Android's own fingerprint prompt. Resolves { ok: true } only when the fingerprint matched. { ok: false } with
     * cancelled: true means the person chose "Use PIN" (or backed out), so the web app can offer the backup.
     */
    @PluginMethod
    public void biometricAuth(PluginCall call) {
        if (Build.VERSION.SDK_INT < 30) {
            call.reject("Fingerprint needs Android 11 or newer.");
            return;
        }
        final String title = call.getString("title", "Unlock Penny");
        final String backup = call.getString("backup", "Use PIN");
        getActivity().runOnUiThread(() -> {
            try {
                final Executor executor = getContext().getMainExecutor();
                BiometricPrompt prompt = new BiometricPrompt.Builder(getContext())
                        .setTitle(title)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                        .setNegativeButton(backup, executor, (dialog, which) -> finish(call, false, true))
                        .build();
                prompt.authenticate(new CancellationSignal(), executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        finish(call, true, false);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence message) {
                        finish(call, false, true);
                    }
                    // A fingerprint that does not match is not final: Android keeps the prompt open for another try.
                });
            } catch (RuntimeException e) {
                call.reject("The fingerprint prompt could not be shown.");
            }
        });
    }

    private void finish(PluginCall call, boolean ok, boolean cancelled) {
        JSObject answer = new JSObject();
        answer.put("ok", ok);
        answer.put("cancelled", cancelled);
        call.resolve(answer);
    }

    /** Hides Penny in the recent-apps view and blocks screenshots while the app is locked or out of sight. */
    @PluginMethod
    public void setSecureWindow(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        // `enabled` is whether the app lock is on (remembered, so the next start is black). `shield` is whether screenshots are
        // blocked right now: only while the app is locked or out of sight, so you can take screenshots of Penny while using it.
        final boolean shield = Boolean.TRUE.equals(call.getBoolean("shield", enabled));
        LockPrefs.setSecure(getContext(), enabled);
        getActivity().runOnUiThread(() -> {
            if (shield) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
        call.resolve();
    }
}
