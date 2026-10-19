package id.regulabank.app.lab;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Visible, inert instrumentation for a controlled mobile-threat laboratory.
 *
 * This is NOT Hirudo RAT and must not be confused with a real infection.
 * No credential access, overlay, SMS listener, accessibility service,
 * package replacement, boot persistence, native payload, or network C2.
 * Records only synthetic labels and ordinary Android activity lifecycle.
 */
public final class LabApplication extends Application {
    public static final String TAG = "HIRUDO_LAB";
    private static final String LOG_FILE = "hirudo_lab_events.jsonl";

    @Override
    public void onCreate() {
        super.onCreate();

        record("LAB_START", "NARADA LAB is a separate, visibly labeled debug application");
        record("BOOTSTRAP_SIMULATED", "No DEX injection, native loader, or dynamic code loading");
        record("ANTI_ANALYSIS_SIMULATED", "No debugger, emulator, or Frida detection performed");
        record("PERMISSIONS_SIMULATED", "No sensitive permissions requested");
        record("PERSISTENCE_SIMULATED", "No boot receiver or persistent service installed");
        record("C2_SIMULATED", "No HTTP, MQTT, or external connection initiated by lab module");
        record("MODULES_SIMULATED", "No access to SMS, notifications, credentials, or screen");
        record("BANK_REPLACEMENT_SIMULATED", "No package discovery, uninstall, or install");

        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override
            public void onActivityCreated(Activity activity, Bundle savedInstanceState) {
                record("ACTIVITY_CREATED", "Main activity lifecycle callback");
            }

            @Override
            public void onActivityStarted(Activity activity) {
                record("ACTIVITY_STARTED", "Main activity lifecycle callback");
            }

            @Override
            public void onActivityResumed(Activity activity) {
                record("ACTIVITY_RESUMED", "Main activity lifecycle callback");
            }

            @Override
            public void onActivityPaused(Activity activity) {
                record("ACTIVITY_PAUSED", "Main activity lifecycle callback");
            }

            @Override
            public void onActivityStopped(Activity activity) {
                record("ACTIVITY_STOPPED", "Main activity lifecycle callback");
            }

            @Override
            public void onActivitySaveInstanceState(Activity activity, Bundle outState) {
                // No sensitive activity or view state is captured.
            }

            @Override
            public void onActivityDestroyed(Activity activity) {
                record("ACTIVITY_DESTROYED", "Main activity lifecycle callback");
            }
        });
    }

    private synchronized void record(String event, String detail) {
        Log.i(TAG, "SIMULATION_ONLY event=" + event + " detail=" + detail);
        try {
            JSONObject object = new JSONObject();
            object.put("kind", "SAFE_SYNTHETIC_EVENT");
            object.put("event", event);
            object.put("detail", detail);
            object.put("timestamp_utc_millis", System.currentTimeMillis());

            byte[] bytes = (object.toString() + "\n").getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream stream = openFileOutput(LOG_FILE, MODE_APPEND)) {
                stream.write(bytes);
            }
        } catch (JSONException | IOException error) {
            Log.w(TAG, "Could not write synthetic lab event", error);
        }
    }
}
