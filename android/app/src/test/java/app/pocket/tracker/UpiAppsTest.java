package app.pocket.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Checks which apps' notifications Penny will look at. */
public class UpiAppsTest {
    @Test
    public void knowsThePaymentApps() {
        assertEquals("Google Pay", UpiApps.nameOf("com.google.android.apps.nbu.paisa.user"));
        assertEquals("PhonePe", UpiApps.nameOf("com.phonepe.app"));
        assertEquals("Paytm", UpiApps.nameOf("net.one97.paytm"));
        assertEquals("BHIM", UpiApps.nameOf("in.org.npci.upiapp"));
        assertEquals("CRED", UpiApps.nameOf("com.dreamplug.androidapp"));
        assertEquals("Amazon Pay", UpiApps.nameOf("in.amazon.mShop.android.shopping"));
        assertEquals("MobiKwik", UpiApps.nameOf("com.mobikwik_new"));
        assertEquals("Freecharge", UpiApps.nameOf("com.freecharge.android"));
        assertTrue(UpiApps.isSupported("com.phonepe.app"));
    }

    @Test
    public void ignoresEveryOtherApp() {
        assertNull(UpiApps.nameOf("com.whatsapp"));
        assertNull(UpiApps.nameOf("com.phonepe.app.other"));
        assertNull(UpiApps.nameOf(""));
        assertNull(UpiApps.nameOf(null));
        assertFalse(UpiApps.isSupported("com.google.android.gm"));
    }
}
