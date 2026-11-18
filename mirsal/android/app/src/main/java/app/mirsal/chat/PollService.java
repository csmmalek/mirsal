package app.mirsal.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

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
 * as real Android notifications while the app is closed. (Instant push while the process is
 * frozen by Doze would need Firebase Cloud Messaging; this works with zero dependencies.)
 */
public class PollService extends Service {
    private static final String CH_SERVICE = "mirsal_service";
    private static final String CH_MESSAGES = "mirsal_messages";
    private static final long POLL_MS = 20000;

    private volatile boolean running = false;
    private Thread worker;

    static void start(Context c) {
        Intent i = new Intent(c, PollService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, PollService.class));
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
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    private void loop() {
        long backoff = POLL_MS;
        while (running) {
            try {
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
            } catch (UnauthorizedException e) {
                Prefs.setToken(this, "");
                stopSelf();
                return;
            } catch (Exception e) {
                backoff = Math.min(backoff * 2, 120000);
            }
            try {
                Thread.sleep(backoff);
            } catch (InterruptedException e) {
                return;
            }
        }
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
