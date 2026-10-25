package app.pocket.tracker;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class WidgetModelTest {
    private static final String TODAY = "2026-10-22", YESTERDAY = "2026-10-21";

    private static WidgetModel.State state(String date) {
        WidgetModel.State s = new WidgetModel.State();
        s.date = date; s.tone = "normal"; s.label = "You can spend today"; s.amountText = "₹1,973";
        s.sub = "Today's limit ₹2,200 · spent ₹227"; s.tomorrowText = "₹2,192"; s.billText = "Rent ₹1,100 · due 28 Oct"; s.percent = 10;
        return s;
    }

    @Test
    public void showsTodaysFigureAsTheAppReportedIt() {
        WidgetModel.Face f = WidgetModel.build(state(TODAY), TODAY, YESTERDAY, 0);
        assertEquals("You can spend today", f.label);
        assertEquals("₹1,973", f.amount);
        assertEquals(WidgetModel.GREEN, f.tone);
        assertEquals("", f.extra);
    }

    @Test
    public void overAndIdleTonesCarryThrough() {
        WidgetModel.State over = state(TODAY); over.tone = "over";
        WidgetModel.State idle = state(TODAY); idle.tone = "idle";
        assertEquals(WidgetModel.OVER, WidgetModel.build(over, TODAY, YESTERDAY, 0).tone);
        assertEquals(WidgetModel.IDLE, WidgetModel.build(idle, TODAY, YESTERDAY, 0).tone);
    }

    @Test
    public void afterMidnightYesterdaysForecastIsShownAsAnEstimate() {
        WidgetModel.Face f = WidgetModel.build(state(YESTERDAY), TODAY, YESTERDAY, 0);
        assertEquals("You can spend today, about", f.label);
        assertEquals("₹2,192", f.amount);
        assertEquals("Open Penny to update", f.sub);
    }

    @Test
    public void figuresFromLongAgoAreNotShown() {
        WidgetModel.Face f = WidgetModel.build(state("2026-10-15"), TODAY, YESTERDAY, 0);
        assertEquals("Open to update", f.amount);
        assertEquals(WidgetModel.IDLE, f.tone);
        WidgetModel.State noForecast = state(YESTERDAY); noForecast.tomorrowText = "";
        assertEquals("Open to update", WidgetModel.build(noForecast, TODAY, YESTERDAY, 0).amount);
    }

    @Test
    public void hidingAmountsShowsNoMoneyAtAll() {
        WidgetModel.State s = state(TODAY); s.hide = true;
        WidgetModel.Face f = WidgetModel.build(s, TODAY, YESTERDAY, 0);
        assertEquals("Penny", f.label);
        assertEquals("• • • •", f.amount);
        assertEquals("Tap to open", f.sub);
        // and also when the figures are old
        WidgetModel.State old = state("2026-01-01"); old.hide = true;
        assertEquals("• • • •", WidgetModel.build(old, TODAY, YESTERDAY, 0).amount);
    }

    @Test
    public void waitingPaymentsAreCountedFromTheAppAndFromMessagesNotYetOpened() {
        WidgetModel.State s = state(TODAY); s.waiting = 2;
        assertEquals("2 to review", WidgetModel.build(s, TODAY, YESTERDAY, 0).extra);
        assertEquals("3 to review", WidgetModel.build(s, TODAY, YESTERDAY, 1).extra);
        assertEquals("1 to review", WidgetModel.build(state(TODAY), TODAY, YESTERDAY, 1).extra);
        assertEquals("", WidgetModel.build(state(TODAY), TODAY, YESTERDAY, 0).extra);
    }

    @Test
    public void neverOpenedPocketGivesASetUpFace() {
        WidgetModel.Face f = WidgetModel.build(null, TODAY, YESTERDAY, 0);
        assertEquals("Set up", f.amount);
        assertEquals(WidgetModel.IDLE, f.tone);
        assertEquals("1 to review", WidgetModel.build(null, TODAY, YESTERDAY, 1).extra);
    }

    @Test
    public void todaysFaceCarriesProgressTomorrowAndTheNextBill() {
        WidgetModel.Face f = WidgetModel.build(state(TODAY), TODAY, YESTERDAY, 0);
        assertEquals(10, f.percent);
        assertEquals("Tomorrow about ₹2,192", f.tomorrow);
        assertEquals("Rent ₹1,100 · due 28 Oct", f.bill);
    }

    @Test
    public void progressIsKeptBetweenZeroAndAHundred() {
        WidgetModel.State s = state(TODAY);
        s.percent = 340; assertEquals(100, WidgetModel.build(s, TODAY, YESTERDAY, 0).percent);
        s.percent = -5; assertEquals(0, WidgetModel.build(s, TODAY, YESTERDAY, 0).percent);
    }

    @Test
    public void noForecastOrBillMeansNoExtraLines() {
        WidgetModel.State s = state(TODAY); s.tomorrowText = ""; s.billText = "";
        WidgetModel.Face f = WidgetModel.build(s, TODAY, YESTERDAY, 0);
        assertEquals("", f.tomorrow);
        assertEquals("", f.bill);
    }

    @Test
    public void oldOrHiddenFacesShowNoDetailsAndNoProgress() {
        WidgetModel.Face old = WidgetModel.build(state(YESTERDAY), TODAY, YESTERDAY, 0);
        assertEquals("", old.tomorrow); assertEquals("", old.bill); assertEquals(0, old.percent);
        WidgetModel.State hidden = state(TODAY); hidden.hide = true;
        WidgetModel.Face h = WidgetModel.build(hidden, TODAY, YESTERDAY, 0);
        assertEquals("", h.tomorrow); assertEquals("", h.bill); assertEquals(0, h.percent);
    }
}
