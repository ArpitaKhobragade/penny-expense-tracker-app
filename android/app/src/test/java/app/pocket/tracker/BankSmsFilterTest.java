package app.pocket.tracker;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Checks the on-phone filter. Messages here are invented examples, not real ones. */
public class BankSmsFilterTest {
    private static final String DEBIT = "Rs.120.00 debited from a/c **1234 on 12-05-26 to VPA swiggy@ybl(UPI Ref No 412345678901)";

    @Test
    public void keepsBankPaymentMessages() {
        assertTrue(BankSmsFilter.shouldKeep("VM-HDFCBK-S", DEBIT));
        assertTrue(BankSmsFilter.shouldKeep("AX-SBIUPI", "Dear UPI user A/C X1234 debited by 500.0 on date 12May26 trf to RAHUL SHARMA Refno 123456789012"));
        assertTrue(BankSmsFilter.shouldKeep("HDFCBK", "INR 80.00 spent on card x1234 at AMAZON"));
        assertTrue(BankSmsFilter.shouldKeep("JD-ICICIB-T", "Rs 5000.00 credited to your A/c XX1234"));
    }

    @Test
    public void dropsMessagesFromPeopleAndContacts() {
        assertFalse(BankSmsFilter.shouldKeep("+919876543210", DEBIT));
        assertFalse(BankSmsFilter.shouldKeep("9876543210", DEBIT));
        assertFalse(BankSmsFilter.shouldKeep("Mom", DEBIT));
        assertFalse(BankSmsFilter.shouldKeep(null, DEBIT));
        assertFalse(BankSmsFilter.shouldKeep("", DEBIT));
    }

    @Test
    public void neverKeepsOneTimePasswords() {
        assertFalse(BankSmsFilter.shouldKeep("VM-HDFCBK-S", "482913 is your OTP for txn of Rs 500 at AMAZON. Do not share."));
        assertFalse(BankSmsFilter.shouldKeep("VM-HDFCBK-S", "Your one time password is 4829 for Rs 500"));
        assertFalse(BankSmsFilter.shouldKeep("VM-HDFCBK-S", "Use verification code 4829 to pay Rs 500"));
    }

    @Test
    public void dropsMessagesWithNoAmount() {
        assertFalse(BankSmsFilter.shouldKeep("VM-HDFCBK-S", "Thank you for banking with us. Visit our branch."));
        assertFalse(BankSmsFilter.shouldKeep("VM-HDFCBK-S", null));
    }
}
