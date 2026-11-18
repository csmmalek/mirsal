package app.mirsal.chat;

import android.content.Context;
import android.content.SharedPreferences;

/** Tiny wrapper around SharedPreferences shared by the activity and the background service. */
final class Prefs {
    private static final String FILE = "mirsal";

    private Prefs() {}

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static String baseUrl(Context c) { return sp(c).getString("base_url", ""); }
    static void setBaseUrl(Context c, String v) { sp(c).edit().putString("base_url", v).apply(); }

    static String token(Context c) { return sp(c).getString("token", ""); }
    static void setToken(Context c, String v) { sp(c).edit().putString("token", v).apply(); }

    static String lastSeen(Context c) { return sp(c).getString("last_seen", ""); }
    static void setLastSeen(Context c, String v) { sp(c).edit().putString("last_seen", v).apply(); }

    /** Normalises "mirsal.me.workers.dev" -> "https://mirsal.me.workers.dev" (no trailing slash). */
    static String normalizeUrl(String input) {
        String s = input == null ? "" : input.trim();
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
