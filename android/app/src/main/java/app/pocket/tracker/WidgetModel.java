package app.pocket.tracker;

/**
 * Decides what the home-screen widget shows. Pure logic with no Android classes, so it can be tested on its own.
 * The app does the arithmetic and hands over ready-to-show text for today; the widget only has to cope with time
 * passing while the app is closed: after midnight yesterday's figure is no longer true.
 */
final class WidgetModel {
    static final int GREEN = 0, OVER = 1, IDLE = 2;

    /** What the app last told the widget. All text is already formatted ("₹1,973"). */
    static final class State {
        String date = "";          // the day the figures are for, yyyy-MM-dd
        String tone = "normal";    // normal, over or idle
        String label = "";
        String amountText = "";
        String sub = "";
        String tomorrowText = "";  // what tomorrow's amount was expected to be, or empty
        String billText = "";      // the next unpaid bill, e.g. "Rent ₹1,100 · due 28 Oct", or empty
        int percent = 0;           // how much of today's limit is used, 0 to 100
        boolean hide = false;      // show no amounts (privacy)
        int waiting = 0;           // payments or bills waiting for review
    }

    /** One widget face. */
    static final class Face {
        final String label, amount, sub, extra, tomorrow, bill;
        final int tone, percent;
        Face(String label, String amount, String sub, String extra, String tomorrow, String bill, int percent, int tone) {
            this.label = label; this.amount = amount; this.sub = sub; this.extra = extra;
            this.tomorrow = tomorrow; this.bill = bill; this.percent = percent; this.tone = tone;
        }
    }

    private WidgetModel() {}

    private static String extra(int waiting) {
        return waiting <= 0 ? "" : waiting == 1 ? "1 to review" : waiting + " to review";
    }

    private static int clamp(int percent) {
        return Math.max(0, Math.min(100, percent));
    }

    /** state may be null when the app has never reported anything. */
    static Face build(State state, String today, String yesterday, int queued) {
        if (state == null) return new Face("Penny", "Set up", "Open Penny to begin", extra(queued), "", "", 0, IDLE);
        String extra = extra(Math.max(0, state.waiting) + Math.max(0, queued));

        if (state.hide) return new Face("Penny", "• • • •", "Tap to open", extra, "", "", 0, GREEN);

        int tone = "over".equals(state.tone) ? OVER : "idle".equals(state.tone) ? IDLE : GREEN;
        if (state.date.equals(today)) {
            String tomorrow = state.tomorrowText.isEmpty() ? "" : "Tomorrow about " + state.tomorrowText;
            return new Face(state.label, state.amountText, state.sub, extra, tomorrow, state.billText, clamp(state.percent), tone);
        }

        // The figures are from an earlier day. Yesterday's forecast for today is the best guess we have; anything
        // older is not worth showing as a number.
        if (state.date.equals(yesterday) && !state.tomorrowText.isEmpty()) {
            return new Face("You can spend today, about", state.tomorrowText, "Open Penny to update", extra, "", "", 0, GREEN);
        }
        return new Face("Penny", "Open to update", "Today's amount needs a refresh", extra, "", "", 0, IDLE);
    }
}
