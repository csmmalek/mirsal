package app.mirsal.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Foreground service that asks the server for new notifications every ~20 seconds and shows them
 * as real Android notifications while the app is closed. When the network comes back it polls at once.
 * (Instant push while the process is frozen by Doze would need Firebase Cloud Messaging; this works
 * with zero dependencies.)
 */
public class PollService extends Service {
    private static final String CH_SERVICE = "mirsal_service";
    private static final String CH_MESSAGES = "mirsal_messages";
    private static final long POLL_MS = 20000;
    private static final long MAX_BACKOFF_MS = 120000;
    /** Never poll more often than this, even right after the network comes back. */
    private static final long MIN_POLL_GAP_MS = 2000;

    private volatile boolean running = false;
    private Thread worker;

    /** Guards wakeRequested. The poll loop sleeps on this monitor, so a network change wakes it at once. */
    private final Object wakeLock = new Object();
    private boolean wakeRequested = false;
    /** When the last poll started (SystemClock.elapsedRealtime, ms). Used for the minimum gap. */
    private long lastPollAt = 0;

    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;

    static void start(Context c) {
        Intent i = new Intent(c, PollService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, PollService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        registerNetworkWake();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannels();
        startForeground(1, buildServiceNotification());
        if (!running) {
            running = true;
            worker = new Thread(new Runnable() {
                @Override public void run() { loop(); }
            }, "mirsal-poll");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        unregisterNetworkWake();
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    private void loop() {
        long backoff = POLL_MS;
        while (running) {
            try {
                long gap = lastPollAt + MIN_POLL_GAP_MS - SystemClock.elapsedRealtime();
                if (gap > 0) Thread.sleep(gap);
                lastPollAt = SystemClock.elapsedRealtime();

                String token = Prefs.token(this);
                String base = Prefs.baseUrl(this);
                if (token.isEmpty() || base.isEmpty()) {
                    stopSelf();
                    return;
                }
                String after = Prefs.lastSeen(this);
                if (after.isEmpty()) {
                    after = nowIso();
                    Prefs.setLastSeen(this, after);
                }
                poll(base, token, after);
                backoff = POLL_MS;
            } catch (InterruptedException e) {
                return;
            } catch (UnauthorizedException e) {
                Prefs.setToken(this, "");
                stopSelf();
                return;
            } catch (Exception e) {
                backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
            }

            boolean woken;
            try {
                woken = waitForNextPoll(backoff);
            } catch (InterruptedException e) {
                return;
            }
            if (!running) return;
            // The network came back: poll now with the normal interval instead of the long backoff.
            if (woken) backoff = POLL_MS;
        }
    }

    /**
     * Sleeps up to timeoutMs, or returns early when the network wakes us.
     * @return true if woken by a network change, false if the timeout ran out (or the service is stopping).
     */
    private boolean waitForNextPoll(long timeoutMs) throws InterruptedException {
        synchronized (wakeLock) {
            long deadline = SystemClock.elapsedRealtime() + timeoutMs;
            while (running && !wakeRequested) {
                long remaining = deadline - SystemClock.elapsedRealtime();
                if (remaining <= 0) return false;
                wakeLock.wait(remaining);
            }
            boolean woken = wakeRequested;
            wakeRequested = false;
            return woken;
        }
    }

    private void wakePoller() {
        synchronized (wakeLock) {
            wakeRequested = true;
            wakeLock.notifyAll();
        }
    }

    /** Wakes the poll loop whenever a network with internet becomes available. */
    private void registerNetworkWake() {
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (connectivity == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                wakePoller();
            }
        };
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                connectivity.registerDefaultNetworkCallback(networkCallback);
            } else {
                NetworkRequest request = new NetworkRequest.Builder()
                        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .build();
                connectivity.registerNetworkCallback(request, networkCallback);
            }
        } catch (RuntimeException e) {
            // Missing permission or too many registered callbacks: polling still works on the normal interval.
            networkCallback = null;
        }
    }

    private void unregisterNetworkWake() {
        if (connectivity != null && networkCallback != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                // Already unregistered.
            }
        }
        networkCallback = null;
    }

    private static class UnauthorizedException extends Exception {}

    private void poll(String base, String token, String after) throws Exception {
        URL url = new URL(base + "/api/notifications?after=" + java.net.URLEncoder.encode(after, "UTF-8"));
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        try {
            int code = conn.getResponseCode();
            if (code == 401) throw new UnauthorizedException();
            if (code != 200) throw new Exception("HTTP " + code);
            BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();

            JSONObject json = new JSONObject(sb.toString());
            boolean pushEnabled = json.optBoolean("pushEnabled", true);
            JSONArray list = json.optJSONArray("notifications");
            if (list == null) return;
            String newest = after;
            for (int i = 0; i < list.length(); i++) {
                JSONObject n = list.getJSONObject(i);
                String created = n.optString("createdAt", "");
                if (created.compareTo(newest) > 0) newest = created;
                if (pushEnabled && !MainActivity.isForeground) {
                    show(n.optString("title", "مِرسال"), n.optString("body", ""), created.hashCode());
                }
            }
            if (!newest.equals(after)) Prefs.setLastSeen(this, newest);
        } finally {
            conn.disconnect();
        }
    }

    private void show(String title, String body, int id) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = builder(CH_MESSAGES)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentIntent(pi)
                .setAutoCancel(true);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(id, b.build());
    }

    private Notification buildServiceNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = builder(CH_SERVICE)
                .setContentTitle("مِرسال")
                .setContentText("متصل لاستقبال الإشعارات")
                .setSmallIcon(R.drawable.ic_stat)
                .setContentIntent(pi)
                .setOngoing(true);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_MIN);
        return b.build();
    }

    private Notification.Builder builder(String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CH_SERVICE, "الاتصال بالخادم", NotificationManager.IMPORTANCE_MIN));
        nm.createNotificationChannel(new NotificationChannel(CH_MESSAGES, "الرسائل", NotificationManager.IMPORTANCE_HIGH));
    }

    private static String nowIso() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }
}
