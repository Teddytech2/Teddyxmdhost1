package com.teddytech.teddyxmd;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.content.Intent;
import android.app.DownloadManager;
import android.os.Environment;
import android.webkit.DownloadListener;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    // Keep this small config endpoint online even if the dashboard itself moves.
    // Change public/app-config.json to point the installed app at the new website.
    private static final String REMOTE_CONFIG_URL =
        "https://teddyxmdhost1-39f912857ad8.herokuapp.com/app-config.json";
    private static final String FALLBACK_DASHBOARD_URL =
        "https://teddyxmdhost1-39f912857ad8.herokuapp.com/";

    private WebView webView;
    private final Set<String> allowedHosts = new HashSet<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);
        configureWebView();

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            return;
        }
        loadConfiguredWebsite();
    }

    private void configureWebView() {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " TEDDYXMDApp");

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.addRequestHeader("User-Agent", userAgent);
                request.setTitle("TEDDY-XMD Android app");
                request.setDescription("Downloading TEDDY-XMD installer");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "TEDDY-XMD.apk");
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                manager.enqueue(request);
            } catch (Exception ignored) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (Exception ignoredAgain) { }
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("https".equalsIgnoreCase(uri.getScheme()) && host != null &&
                    allowedHosts.contains(host.toLowerCase(Locale.ROOT))) {
                    return false;
                }
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });
    }

    private void loadConfiguredWebsite() {
        new Thread(() -> {
            String targetUrl = FALLBACK_DASHBOARD_URL;
            Set<String> hosts = new HashSet<>();
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(REMOTE_CONFIG_URL).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                connection.setUseCaches(false);
                connection.setRequestProperty("Cache-Control", "no-cache");
                try {
                    if (connection.getResponseCode() == 200) {
                        StringBuilder body = new StringBuilder();
                        try (InputStream input = connection.getInputStream();
                             BufferedReader reader = new BufferedReader(new InputStreamReader(input))) {
                            String line;
                            while ((line = reader.readLine()) != null) body.append(line);
                        }
                        JSONObject config = new JSONObject(body.toString());
                        String configuredUrl = config.optString("websiteUrl", "").trim();
                        Uri parsed = Uri.parse(configuredUrl);
                        if ("https".equalsIgnoreCase(parsed.getScheme()) && parsed.getHost() != null) {
                            targetUrl = configuredUrl;
                            hosts.add(parsed.getHost().toLowerCase(Locale.ROOT));
                        }
                        JSONArray configuredHosts = config.optJSONArray("allowedHosts");
                        if (configuredHosts != null) {
                            for (int i = 0; i < configuredHosts.length(); i++) {
                                String host = configuredHosts.optString(i, "").trim().toLowerCase(Locale.ROOT);
                                if (!host.isEmpty() && !host.contains("/") && !host.contains(":")) hosts.add(host);
                            }
                        }
                    }
                } finally {
                    connection.disconnect();
                }
            } catch (Exception ignored) {
                // Keep the last-known baked-in fallback if remote config is temporarily unavailable.
            }

            Uri target = Uri.parse(targetUrl);
            if (target.getHost() != null) hosts.add(target.getHost().toLowerCase(Locale.ROOT));
            final String finalUrl = targetUrl;
            final Set<String> finalHosts = hosts;
            runOnUiThread(() -> {
                allowedHosts.clear();
                allowedHosts.addAll(finalHosts);
                webView.loadUrl(finalUrl);
            });
        }).start();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
