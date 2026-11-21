package com.openchamber.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SharedIntent";
    private static final String STATE_SHARED_INTENT = "sharedIntentSignature";

    private String sharedIntentSignature;

    // Reading a share means file I/O and base64; one reader keeps shares in arrival order.
    private final ExecutorService shareReader = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "openchamber-share-intake");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(ClipboardTextPlugin.class);
        registerPlugin(FileSharePlugin.class);
        registerPlugin(ImagePastePlugin.class);
        registerPlugin(PushKeyPlugin.class);
        registerPlugin(ReadingAudioFocusPlugin.class);
        registerPlugin(WindowLayoutPlugin.class);
        registerPlugin(RuntimeWebSocketPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(MobileDevTunnelPlugin.class);
        registerPlugin(SharedFilesPlugin.class);
        String signature = SharedIntentReader.signature(getIntent());
        String takenSignature = savedInstanceState == null
            ? null
            : savedInstanceState.getString(STATE_SHARED_INTENT);
        super.onCreate(savedInstanceState);
        // With singleTask, each share is its own event: this intent on a cold start, later
        // ones through onNewIntent. A recreated activity can carry either the share it was
        // already given or a new one, so the signature from the saved state decides; reading
        // a taken share again would re-arm content the page already has.
        if (signature != null && !signature.equals(takenSignature)) {
            readShare(getIntent(), signature);
        }
    }

    @Override
    public void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (sharedIntentSignature != null) {
            outState.putString(STATE_SHARED_INTENT, sharedIntentSignature);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readShare(intent, SharedIntentReader.signature(intent));
    }

    private void readShare(Intent intent, String signature) {
        if (intent == null || signature == null) {
            return;
        }
        sharedIntentSignature = signature;
        shareReader.execute(() -> {
            long started = System.nanoTime();
            try {
                SharedPayloadStore.SharedPayload payload = SharedIntentReader.read(intent, getContentResolver());
                if (payload == null) {
                    return;
                }
                SharedPayloadStore.put(payload);
                Log.i(TAG, "Stored share: text=" + (payload.text != null)
                    + " files=" + payload.files.size()
                    + " rejected=" + payload.rejected.size()
                    + " in " + ((System.nanoTime() - started) / 1_000_000L) + "ms");
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not read the shared intent", error);
            }
        });
    }

    @Override
    protected void load() {
        // Capacitor inflates a plain CapacitorWebView, which tells the IME it accepts no
        // content. Swap in ours before the bridge resolves the WebView by id.
        setContentView(R.layout.activity_main);
        super.load();
    }
}
