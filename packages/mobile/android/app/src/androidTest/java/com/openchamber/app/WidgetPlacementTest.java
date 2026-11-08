package com.openchamber.app;

import static org.junit.Assert.assertTrue;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Pins a widget the way a user confirms it, then asks the system whether the launcher really bound
 * it. AppWidgetManager.getAppWidgetIds is the authority: the picker listing a provider proves only
 * that the manifest was read.
 */
@RunWith(AndroidJUnit4.class)
public class WidgetPlacementTest {

    private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void theSystemPinsAWidgetWhenTheUserConfirmsIt() throws Exception {
        // requestPinAppWidget is the system flow a launcher shows as "Add to home screen"; the
        // drag out of the picker needs a gesture the picker's own list does not reliably accept.
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, OverviewWidgetProvider.class);
        manager.requestPinAppWidget(provider, null, null);

        UiObject2 confirm = waitFor("Add", 15_000);
        if (confirm == null) {
            confirm = waitFor("Add to home screen", 5_000);
        }
        assertTrue("the launcher did not ask to pin the widget", confirm != null);
        confirm.click();
        SystemClock.sleep(3000);
        device.pressHome();
        SystemClock.sleep(2000);

        int[] ids = manager.getAppWidgetIds(provider);
        assertTrue("the launcher bound no overview widget", ids.length > 0);
    }

    private UiObject2 waitFor(String text, long timeout) {
        return device.wait(Until.findObject(By.textContains(text)), timeout);
    }
}
