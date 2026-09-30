package id.regulabank.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import java.util.Locale;

public class MainActivity extends ComponentActivity {
    private static final String LOCAL_APP_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_APP_URL = "https://" + LOCAL_APP_HOST + "/assets/index.html";

    private WebView webView;
    private PdfDownloadBridge pdfDownloadBridge;
    private AppBridge appBridge;
    private Insets latestSystemInsets = Insets.NONE;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat systemBars =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        systemBars.setAppearanceLightStatusBars(false);
        systemBars.setAppearanceLightNavigationBars(true);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(255, 250, 247));
        setContentView(webView);

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            latestSystemInsets = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            updateCssInsets();
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        pdfDownloadBridge = new PdfDownloadBridge(this, webView);
        appBridge = new AppBridge(this);
        webView.addJavascriptInterface(pdfDownloadBridge, "AndroidApp");
        webView.addJavascriptInterface(appBridge, "NativeApp");

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocalAsset(uri)) return false;
                return openExternal(uri);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (isLocalAsset(uri)) return false;
                return openExternal(uri);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isLocalAsset(Uri.parse(url))) updateCssInsets();
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleAppBack();
            }
        });

        webView.loadUrl(LOCAL_APP_URL);
    }

    private boolean isLocalAsset(Uri uri) {
        if (uri == null) return false;
        String host = uri.getHost();
        String scheme = uri.getScheme();
        int port = uri.getPort();
        return "https".equalsIgnoreCase(scheme)
                && LOCAL_APP_HOST.equalsIgnoreCase(host)
                && (port == -1 || port == 443);
    }

    private boolean openExternal(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return true;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "Tidak ada aplikasi untuk membuka tautan.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void updateCssInsets() {
        if (webView == null) return;
        float density = getResources().getDisplayMetrics().density;
        float top = latestSystemInsets.top / density;
        float bottom = latestSystemInsets.bottom / density;
        float left = latestSystemInsets.left / density;
        float right = latestSystemInsets.right / density;
        String script = String.format(
                Locale.US,
                "document.documentElement.style.setProperty('--system-inset-top','%.2fpx');" +
                        "document.documentElement.style.setProperty('--system-inset-bottom','%.2fpx');" +
                        "document.documentElement.style.setProperty('--system-inset-left','%.2fpx');" +
                        "document.documentElement.style.setProperty('--system-inset-right','%.2fpx');",
                top, bottom, left, right
        );
        webView.post(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private void handleAppBack() {
        if (webView == null) {
            finishAfterTransition();
            return;
        }
        webView.evaluateJavascript(
                "window.naradaHandleBack ? window.naradaHandleBack() : false",
                result -> {
                    if (!"true".equals(result)) finishAfterTransition();
                }
        );
    }

    @Override
    protected void onDestroy() {
        if (pdfDownloadBridge != null) pdfDownloadBridge.destroy();
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            webView.removeJavascriptInterface("NativeApp");
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
