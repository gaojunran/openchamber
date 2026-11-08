package com.openchamber.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.content.res.Resources;
import android.content.res.XmlResourceParser;
import android.os.Bundle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.xmlpull.v1.XmlPullParser;

/**
 * Pins the launcher quick actions ("New session", "Needs attention") to the deep links the web
 * layer routes. Nothing else verifies them: a dropped metadata entry, a renamed id or a broken
 * link only shows up at runtime, as an empty long-press menu or a tap that opens the default
 * screen, so this reads the packaged resources the system would read.
 */
@RunWith(AndroidJUnit4.class)
public class LauncherShortcutsTest {

    private static final String ANDROID_NS = "http://schemas.android.com/apk/res/android";

    /**
     * The resource above says what we declared; this says what the system actually registered for
     * the launcher to query. A metadata entry the shortcut service rejects leaves the first test
     * green and the menu empty.
     */
    @Test
    public void theSystemRegistersBothQuickActions() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        assertNotNull("this device has no ShortcutManager", manager);

        // Each flag reaches a different store, and a non-launcher caller is not guaranteed every
        // one of them, so the union is what this asserts on and the per-flag counts go into the
        // message.
        int[] flags = {
            ShortcutManager.FLAG_MATCH_MANIFEST,
            ShortcutManager.FLAG_MATCH_CACHED,
            ShortcutManager.FLAG_MATCH_DYNAMIC,
            ShortcutManager.FLAG_MATCH_PINNED,
        };
        List<ShortcutInfo> shortcuts = new ArrayList<>();
        StringBuilder report = new StringBuilder();
        for (int flag : flags) {
            List<ShortcutInfo> found = manager.getShortcuts(flag);
            report.append(flag).append('=').append(found.size()).append(' ');
            for (ShortcutInfo shortcut : found) {
                if (!shortcuts.contains(shortcut)) {
                    shortcuts.add(shortcut);
                }
            }
        }
        report.append("registered: ").append(ids(shortcuts));

        assertEquals(report.toString(), 2, shortcuts.size());
        assertEquals("new-session", shortcuts.get(0).getId());
        assertEquals("attention", shortcuts.get(1).getId());
        assertEquals("openchamber://new-session", shortcuts.get(0).getIntent().getDataString());
        assertEquals("openchamber://sessions?filter=attention", shortcuts.get(1).getIntent().getDataString());
        assertTrue("the first action is disabled", shortcuts.get(0).isEnabled());
        assertEquals("New session", shortcuts.get(0).getShortLabel().toString());
        assertEquals("Needs attention", shortcuts.get(1).getShortLabel().toString());
    }

    private static String ids(List<ShortcutInfo> shortcuts) {
        List<String> ids = new ArrayList<>();
        for (ShortcutInfo shortcut : shortcuts) {
            ids.add(shortcut.getId());
        }
        return ids.toString();
    }

    @Test
    public void shortcutsMetadataAndDeepLinksMatchTheQuickActions() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PackageManager packageManager = context.getPackageManager();

        // The launcher activity carries the metadata; the shortcut service does not read an
        // application-level copy.
        ComponentName launcher = new ComponentName(context.getPackageName(), MainActivity.class.getName());
        ActivityInfo info = packageManager.getActivityInfo(launcher, PackageManager.GET_META_DATA);
        Bundle metadata = info.metaData;
        assertNotNull(metadata);
        int shortcutsResource = metadata.getInt("android.app.shortcuts");
        assertEquals(R.xml.shortcuts, shortcutsResource);

        List<String> ids = new ArrayList<>();
        List<String> deepLinks = new ArrayList<>();
        XmlResourceParser parser = context.getResources().getXml(R.xml.shortcuts);
        try {
            int event = parser.getEventType();
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) {
                    if ("shortcut".equals(parser.getName())) {
                        ids.add(parser.getAttributeValue(ANDROID_NS, "shortcutId"));
                    } else if ("intent".equals(parser.getName())) {
                        deepLinks.add(parser.getAttributeValue(ANDROID_NS, "data"));
                    }
                }
                event = parser.next();
            }
        } finally {
            parser.close();
        }

        assertEquals(Arrays.asList("new-session", "attention"), ids);
        assertEquals(Arrays.asList(
            "openchamber://new-session",
            "openchamber://sessions?filter=attention"), deepLinks);

        Resources resources = context.getResources();
        assertFalse(resources.getString(R.string.shortcut_new_session).trim().isEmpty());
        assertFalse(resources.getString(R.string.shortcut_needs_attention).trim().isEmpty());
    }
}
