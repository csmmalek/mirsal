package app.mirsal.chat;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import java.util.ArrayList;
import java.util.List;

/** Hosts the Mirsal web app (served by your Cloudflare Worker) in a full-screen WebView. */
public class MainActivity extends Activity {
    /** Read by PollService so it does not notify while the app is on screen. */
    static volatile boolean isForeground = false;

    private static final int REQ_PERMS = 10;
    private static final int REQ_FILE = 11;

    private WebView web;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> fileCallback;
    private boolean errorDialogShown = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B1117"));
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        configureWebView();

        if (Prefs.baseUrl(this).isEmpty()) {
            askForServerUrl(false);
        } else {
            web.loadUrl(Prefs.baseUrl(this));
        }
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        web.addJavascriptInterface(new Bridge(), "MirsalAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String base = Prefs.baseUrl(MainActivity.this);
                if (!base.isEmpty() && u.toString().startsWith(base)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) askForServerUrl(true);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { handleWebPermission(request); }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "اختر ملفاً"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    /** Grants the page camera/mic access, asking Android for the runtime permission first. */
    private void handleWebPermission(PermissionRequest request) {
        List<String> needed = new ArrayList<String>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) needed.add(Manifest.permission.RECORD_AUDIO);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) needed.add(Manifest.permission.CAMERA);
        }
        List<String> missing = new ArrayList<String>();
        if (Build.VERSION.SDK_INT >= 23) {
            for (String p : needed) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
            }
        }
        if (missing.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingWebPermission = request;
            requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQ_PERMS || pendingWebPermission == null) return;
        boolean all = grantResults.length > 0;
        for (int r : grantResults) if (r != PackageManager.PERMISSION_GRANTED) all = false;
        PermissionRequest req = pendingWebPermission;
        pendingWebPermission = null;
        if (all) req.grant(req.getResources()); else req.deny();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[] { data.getData() };
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private void askForServerUrl(final boolean connectionFailed) {
        if (errorDialogShown) return;
        errorDialogShown = true;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("mirsal.your-name.workers.dev");
        input.setText(Prefs.baseUrl(this));
        input.setTextDirection(View.TEXT_DIRECTION_LTR);

        new AlertDialog.Builder(this)
                .setTitle(connectionFailed ? "تعذر الاتصال بالخادم" : "عنوان خادم مِرسال")
                .setMessage("أدخل عنوان تطبيقك على Cloudflare (الذي نشرته)")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("اتصال", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        errorDialogShown = false;
                        String url = Prefs.normalizeUrl(input.getText().toString());
                        if (url.isEmpty()) { askForServerUrl(connectionFailed); return; }
                        Prefs.setBaseUrl(MainActivity.this, url);
                        web.loadUrl(url);
                    }
                })
                .setNegativeButton("إغلاق", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { finish(); }
                })
                .show();
    }

    /** Methods the web app can call as window.MirsalAndroid.* */
    public class Bridge {
        @JavascriptInterface
        public void setSession(String baseUrl, String token) {
            Prefs.setBaseUrl(MainActivity.this, Prefs.normalizeUrl(baseUrl));
            Prefs.setToken(MainActivity.this, token);
            PollService.start(MainActivity.this);
        }

        @JavascriptInterface
        public void clearSession() {
            Prefs.setToken(MainActivity.this, "");
            Prefs.setLastSeen(MainActivity.this, "");
            PollService.stop(MainActivity.this);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        isForeground = true;
        web.onResume();
    }

    @Override
    protected void onPause() {
        isForeground = false;
        web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
    }
}
