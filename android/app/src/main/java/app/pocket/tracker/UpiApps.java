package app.pocket.tracker;

/**
 * Which apps' notifications Penny looks at: the common UPI and wallet apps, and nothing else. A notification from any
 * other app is dropped on the spot without being read.
 */
final class UpiApps {
    private UpiApps() {}

    /** The app's everyday name, or null when Penny should ignore notifications from this package. */
    static String nameOf(String pkg) {
        if (pkg == null) return null;
        switch (pkg) {
            case "com.google.android.apps.nbu.paisa.user": return "Google Pay";
            case "com.phonepe.app": return "PhonePe";
            case "net.one97.paytm": return "Paytm";
            case "in.org.npci.upiapp": return "BHIM";
            case "com.dreamplug.androidapp": return "CRED";
            case "in.amazon.mShop.android.shopping": return "Amazon Pay";
            case "com.mobikwik_new": return "MobiKwik";
            case "com.freecharge.android": return "Freecharge";
            default: return null;
        }
    }

    static boolean isSupported(String pkg) {
        return nameOf(pkg) != null;
    }
}
