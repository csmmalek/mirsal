package app.mirsal.chat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts the notification service after the phone reboots (only if the user is signed in). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && !Prefs.token(context).isEmpty()
                && !Prefs.baseUrl(context).isEmpty()) {
            PollService.start(context);
        }
    }
}
