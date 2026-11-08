package com.openchamber.app;

import static org.junit.Assert.assertTrue;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Point;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.io.File;
import java.io.FileOutputStream;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Puts a widget on the home screen through the launcher, then asks the system whether it is bound.
 *
 * AppWidgetManager.getAppWidgetIds is the authority here: the picker listing a provider proves only
 * that the manifest was read, and a screenshot of an empty home screen proves nothing at all.
 */
@RunWith(AndroidJUnit4.class)
public class WidgetPlacementTest {

    private static final String TAG = "WidgetPlacement";

    private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void aWidgetLandsOnTheHomeScreen() throws Exception {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, OverviewWidgetProvider.class);
        Log.i(TAG, "pin supported: " + manager.isRequestPinAppWidgetSupported());

        if (!pin(manager, provider)) {
            dragFromPicker();
        }

        device.pressHome();
        SystemClock.sleep(2500);
        int[] ids = manager.getAppWidgetIds(provider);
        Log.i(TAG, "bound overview widgets: " + ids.length);
        capturePreview();
        assertTrue("the launcher bound no overview widget", ids.length > 0);
    }

    /** The system prompt a user confirms; the launcher answers by binding the widget itself. */
    private boolean pin(AppWidgetManager manager, ComponentName provider) {
        if (!manager.isRequestPinAppWidgetSupported()) {
            return false;
        }
        if (!manager.requestPinAppWidget(provider, null, null)) {
            Log.i(TAG, "the launcher refused to pin the widget");
            return false;
        }
        UiObject2 confirm = waitFor("Add", 8000);
        if (confirm == null) {
            Log.i(TAG, "no pin prompt appeared");
            return false;
        }
        confirm.click();
        SystemClock.sleep(3000);
        return true;
    }

    /** The older path: long-press a preview in the picker and drop it on the workspace. */
    private void dragFromPicker() {
        device.pressHome();
        SystemClock.sleep(1500);
        device.pressMenu();
        SystemClock.sleep(800);
        UiObject2 widgets = waitFor("Widgets", 5000);
        if (widgets == null) {
            Log.i(TAG, "no Widgets entry on the home menu");
            return;
        }
        widgets.click();
        SystemClock.sleep(2500);

        UiObject2 entry = scrollTo("OpenChamber", 8);
        if (entry == null) {
            Log.i(TAG, "OpenChamber is not in the picker");
            return;
        }
        entry.click();
        SystemClock.sleep(2500);

        UiObject2 preview = scrollTo("OpenChamber overview", 4);
        if (preview == null) {
            Log.i(TAG, "no overview preview");
            return;
        }
        Log.i(TAG, "dragging the preview at " + preview.getVisibleBounds());
        preview.drag(
            new Point(device.getDisplayWidth() / 2, (int) (device.getDisplayHeight() * 0.45)),
            400
        );
        SystemClock.sleep(2500);
    }

    /** Keeps the widget's own pixels, so the artifact shows what the launcher would draw. */
    private void capturePreview() throws Exception {
        RemoteViews views = WidgetRenderer.overview(context, WidgetSnapshotStore.read(context));
        final Bitmap bitmap = Bitmap.createBitmap(420, 220, Bitmap.Config.ARGB_8888);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            FrameLayout host = new FrameLayout(context);
            View inflated = views.apply(context, host);
            inflated.measure(
                View.MeasureSpec.makeMeasureSpec(420, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(220, View.MeasureSpec.EXACTLY)
            );
            inflated.layout(0, 0, 420, 220);
            inflated.draw(new Canvas(bitmap));
        });
        File out = new File(context.getFilesDir(), "widget-overview.png");
        try (FileOutputStream stream = new FileOutputStream(out)) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);
        }
        Log.i(TAG, "wrote " + out);
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
}
