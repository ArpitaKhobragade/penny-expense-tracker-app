package app.pocket.tracker;

import java.util.regex.Pattern;

/**
 * Decides, on the phone and before anything is stored, whether a text message could be a bank payment message.
 * Anything that fails is dropped on the spot: it is never saved and never leaves this class.
 * The web side (sms-parser.js) repeats these checks and is the one that actually reads the message.
 */
final class BankSmsFilter {
    // Bank sender IDs look like "VM-HDFCBK-S", "AX-SBIUPI" or "HDFCBK". Phone numbers and saved contacts do not.
    private static final Pattern SENDER = Pattern.compile("^(?:[A-Z]{2}-)?[A-Z][A-Z0-9]{2,10}(?:-[A-Z])?$");
    // One-time passwords are never kept.
    private static final Pattern OTP = Pattern.compile(
            "\\botp\\b|one[- ]?time password|verification code|\\bcvv\\b", Pattern.CASE_INSENSITIVE);
    // An amount: "Rs 120", "Rs.120", "INR 120", the rupee sign, or "debited by 120".
    private static final Pattern MONEY = Pattern.compile(
            "(?:\\brs\\.?|\\binr|₹|\\brupees?\\b)\\s*\\d"
                    + "|\\b(?:debited|debit|spent|paid|sent|withdrawn)\\s+(?:by|for|of|with)?\\s*\\d",
            Pattern.CASE_INSENSITIVE);

    private BankSmsFilter() {}

    static boolean isBankSender(String sender) {
        return sender != null && SENDER.matcher(sender.trim()).matches();
    }

    static boolean shouldKeep(String sender, String body) {
        if (!isBankSender(sender) || body == null) return false;
        if (OTP.matcher(body).find()) return false;
        return MONEY.matcher(body).find();
    }
}
