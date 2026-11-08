package com.openchamber.app;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Drives the launcher shortcut the way a user does: press home, open the app drawer, long-press
 * the icon, tap *New session*, and check the app came up. The menu itself is drawn by the
 * launcher, so the only way to prove the entry exists and works is to look at it.
 */
@RunWith(AndroidJUnit4.class)
public class LauncherShortcutsE2ETest {

    private static final String PACKAGE = "com.openchamber.app";
    private static final long TIMEOUT = 15_000;

    @Test
    public void longPressingTheIconOffersNewSession() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.pressHome();
        device.waitForIdle();
        openAppDrawer(device);

        UiObject2 icon = device.wait(Until.findObject(By.text("OpenChamber")), TIMEOUT);
        assertNotNull("no OpenChamber icon in the app drawer", icon);
        icon.longClick();
        device.waitForIdle();

        UiObject2 action = device.wait(Until.findObject(By.text("New session")), TIMEOUT);
        assertNotNull("long-pressing the icon offered no New session action", action);
        attachScreenshot(device, "1-quick-actions-menu");
        action.click();

        assertTrue("the shortcut did not bring the app to the foreground", waitForApp(device, TIMEOUT));
        attachScreenshot(device, "2-new-session-from-shortcut");
        System.out.println("E2E quick action opened the app");
    }

    /** The drawer opens with an upward swipe from the bottom edge on the AOSP launcher. */
    private void openAppDrawer(UiDevice device) {
        int width = device.getDisplayWidth();
        int height = device.getDisplayHeight();
        device.swipe(width / 2, (int) (height * 0.92), width / 2, (int) (height * 0.15), 40);
        device.waitForIdle();
        if (device.wait(Until.findObject(By.text("OpenChamber")), 3_000) != null) {
            return;
        }
        // A launcher that keeps its icon on the home screen needs no drawer at all.
        device.pressBack();
        device.waitForIdle();
    }

    private boolean waitForApp(UiDevice device, long timeout) {
        return device.wait(Until.hasObject(By.pkg(PACKAGE).depth(0)), timeout);
    }

    private void attachScreenshot(UiDevice device, String name) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        java.io.File directory = new java.io.File(context.getExternalFilesDir(null), "evidence");
        //noinspection ResultOfMethodCallIgnored
        directory.mkdirs();
        device.takeScreenshot(new java.io.File(directory, name + ".png"));
    }
}
