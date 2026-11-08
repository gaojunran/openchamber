package com.openchamber.app;

import static org.junit.Assert.assertTrue;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.MotionEvent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Puts a widget on the home screen the way a user does, then asks the system whether it is bound.
 *
 * The launcher only accepts a widget by long-pressing a preview and dragging it out, so this
 * synthesizes that gesture precisely: down, hold past the long-press threshold, move, up. A plain
 * swipe is interpreted as a scroll and the launcher never enters drag mode.
 */
@RunWith(AndroidJUnit4.class)
public class WidgetPlacementTest {

    private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void aWidgetCanBeDraggedFromThePickerOntoTheHomeScreen() throws Exception {
        device.pressHome();
        SystemClock.sleep(1500);

        longPress(device.getDisplayWidth() / 2, device.getDisplayHeight() / 2, 1500);
        UiObject2 widgets = waitFor("Widgets", 10_000);
        assertTrue("the home menu offers no Widgets entry", widgets != null);
        widgets.click();
        SystemClock.sleep(2500);

        UiObject2 entry = scrollTo("OpenChamber", 8);
        assertTrue("OpenChamber is not in the widget picker", entry != null);
        entry.click();
        SystemClock.sleep(2500);

        UiObject2 preview = scrollTo("OpenChamber overview", 4);
        assertTrue("no overview preview", preview != null);
        Rect bounds = preview.getVisibleBounds();

        int dropX = device.getDisplayWidth() / 2;
        int dropY = device.getDisplayHeight() / 3;
        dragOut(bounds.centerX(), bounds.centerY(), dropX, dropY);

        SystemClock.sleep(2000);
        device.pressHome();
        SystemClock.sleep(1500);

        int[] ids = AppWidgetManager.getInstance(context)
            .getAppWidgetIds(new ComponentName(context, OverviewWidgetProvider.class));
        assertTrue("the launcher bound no overview widget", ids.length > 0);
    }

    private UiObject2 waitFor(String text, long timeout) {
        return device.wait(Until.findObject(By.textContains(text)), timeout);
    }

    private UiObject2 scrollTo(String text, int swipes) {
        UiObject2 found = waitFor(text, 2000);
        for (int attempt = 0; attempt < swipes && found == null; attempt++) {
            device.swipe(
                device.getDisplayWidth() / 2,
                (int) (device.getDisplayHeight() * 0.75),
                device.getDisplayWidth() / 2,
                (int) (device.getDisplayHeight() * 0.35),
                20
            );
            SystemClock.sleep(1200);
            found = waitFor(text, 2000);
        }
        return found;
    }

    private void longPress(int x, int y, long holdMillis) {
        long now = SystemClock.uptimeMillis();
        List<MotionEvent> events = new ArrayList<>();
        events.add(MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0));
        events.add(MotionEvent.obtain(now, now + 40, MotionEvent.ACTION_MOVE, x, y, 0));
        events.add(MotionEvent.obtain(now, now + holdMillis, MotionEvent.ACTION_MOVE, x, y, 0));
        events.add(MotionEvent.obtain(now, now + holdMillis + 40, MotionEvent.ACTION_UP, x, y, 0));
        InstrumentationRegistry.getInstrumentation().sendPointerSync(events.get(0));
        for (int index = 1; index < events.size(); index++) {
            InstrumentationRegistry.getInstrumentation().sendPointerSync(events.get(index));
            SystemClock.sleep(index == 1 ? holdMillis : 40);
        }
    }

    private void dragOut(int fromX, int fromY, int toX, int toY) {
        long start = SystemClock.uptimeMillis();
        InstrumentationRegistry.getInstrumentation().sendPointerSync(
            MotionEvent.obtain(start, start, MotionEvent.ACTION_DOWN, fromX, fromY, 0)
        );
        SystemClock.sleep(1200);
        int steps = 20;
        for (int step = 1; step <= steps; step++) {
            float x = fromX + (toX - fromX) * step / (float) steps;
            float y = fromY + (toY - fromY) * step / (float) steps;
            InstrumentationRegistry.getInstrumentation().sendPointerSync(
                MotionEvent.obtain(start, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, x, y, 0)
            );
            SystemClock.sleep(40);
        }
        InstrumentationRegistry.getInstrumentation().sendPointerSync(
            MotionEvent.obtain(start, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, toX, toY, 0)
        );
        SystemClock.sleep(800);
    }
}
