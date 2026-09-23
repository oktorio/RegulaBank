package id.regulabank.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.text.Html;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class PdfDownloadBridge {
    private static final int MAX_PAGE_BYTES = 5 * 1024 * 1024;
    private static final int MAX_PDF_BYTES = 100 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final Pattern REGULATION_ID_PATTERN = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_-]{0,79}");
    private static final Pattern PDF_LINK_PATTERN = Pattern.compile(
            "(?i)href\\s*=\\s*([\"'])([^\"']+?\\.pdf(?:\\?[^\"']*)?)\\1"
    );

    private final Activity activity;
    private final WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Set<String> activeDownloads = Collections.synchronizedSet(new HashSet<>());

    PdfDownloadBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    void destroy() {
        executor.shutdownNow();
        activeDownloads.clear();
    }

    @JavascriptInterface
    public int getDownloadedPdfCount(String regulationId) {
        String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty()) return 0;
        return listDownloadedPdfs(safeId).size();
    }

    @JavascriptInterface
    public void downloadAllPdfs(String regulationId, String title, String sourceUrl) {
        final String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty() || !isOfficialOjkUrl(sourceUrl)) {
            notifyDownload(safeId, "error", 0, 0,
                    "Sumber dokumen tidak valid.", getDownloadedPdfCount(safeId));
            return;
        }
        if (!activeDownloads.add(safeId)) {
            toast("Unduhan dokumen ini masih berjalan.");
            return;
        }

        toast("Menyiapkan dokumen PDF resmi...");
        executor.execute(() -> {
            try {
                List<String> pdfUrls = discoverPdfUrls(sourceUrl);
                if (pdfUrls.isEmpty()) {
                    notifyDownload(safeId, "error", 0, 0,
                            "Tidak ada lampiran PDF yang ditemukan.", getDownloadedPdfCount(safeId));
                    return;
                }

                File directory = pdfDirectory(safeId);
                if (!directory.exists() && !directory.mkdirs()) {
                    throw new IOException("Tidak dapat membuat folder penyimpanan.");
                }

                int completed = 0;
                int failed = 0;
                notifyDownload(safeId, "downloading", 0, pdfUrls.size(),
                        "Mulai mengunduh " + pdfUrls.size() + " dokumen...", getDownloadedPdfCount(safeId));

                Set<String> usedNames = new LinkedHashSet<>();
                for (String pdfUrl : pdfUrls) {
                    if (Thread.currentThread().isInterrupted()) return;
                    try {
                        downloadPdf(pdfUrl, directory, usedNames);
                    } catch (IOException error) {
                        failed++;
                    }
                    completed++;
                    notifyDownload(safeId, "downloading", completed, pdfUrls.size(),
                            "Mengunduh dokumen " + completed + " dari " + pdfUrls.size(),
                            getDownloadedPdfCount(safeId));
                }

                int saved = getDownloadedPdfCount(safeId);
                if (saved == 0) {
                    notifyDownload(safeId, "error", completed, pdfUrls.size(),
                            "Unduhan gagal. Periksa koneksi lalu coba lagi.", 0);
                } else {
                    String message = failed == 0
                            ? saved + " PDF siap dibaca offline."
                            : saved + " PDF tersimpan; " + failed + " gagal diunduh.";
                    notifyDownload(safeId, "complete", completed, pdfUrls.size(), message, saved);
                }
            } catch (Exception error) {
                notifyDownload(safeId, "error", 0, 0,
                        "Gagal mengambil lampiran dari OJK.", getDownloadedPdfCount(safeId));
            } finally {
                activeDownloads.remove(safeId);
            }
        });
    }

    @JavascriptInterface
    public void showDownloadedPdfs(String regulationId, String title) {
        final String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty()) {
            toast("Identitas ketentuan tidak valid.");
            return;
        }
        activity.runOnUiThread(() -> showPdfPicker(safeId, title));
    }

    private List<String> discoverPdfUrls(String sourceUrl) throws Exception {
        if (!isOfficialOjkUrl(sourceUrl)) throw new IOException("Domain sumber tidak diizinkan.");
        if (sourceUrl.toLowerCase(Locale.ROOT).contains(".pdf")) {
            return Collections.singletonList(sourceUrl);
        }

        String html = fetchText(sourceUrl);
        URI base = new URI(sourceUrl);
        Matcher matcher = PDF_LINK_PATTERN.matcher(html);
        Set<String> discovered = new LinkedHashSet<>();

        while (matcher.find()) {
            String rawLink = decodeHtml(matcher.group(2)).trim().replace(" ", "%20");
            try {
                URI resolved = base.resolve(rawLink);
                String url = resolved.toString();
                if (isOfficialOjkUrl(url)) discovered.add(url);
            } catch (IllegalArgumentException ignored) {
                // Skip malformed links while preserving the remaining official attachments.
            }
        }

        List<String> result = new ArrayList<>(discovered);
        result.sort(Comparator.comparingInt(this::pdfSortWeight));
        return result;
    }

    private int pdfSortWeight(String url) {
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.contains("abstrak") || lower.contains("summary") || lower.contains("ringkasan")) return 1;
        if (lower.contains("faq") || lower.contains("tanya")) return 2;
        return 0;
    }

    private String fetchText(String sourceUrl) throws IOException {
        HttpURLConnection connection = openOfficialConnection(sourceUrl);
        try {
            int response = connection.getResponseCode();
            if (response < 200 || response >= 300) throw new IOException("HTTP " + response);

            long contentLength = connection.getContentLengthLong();
            if (contentLength > MAX_PAGE_BYTES) throw new IOException("Halaman terlalu besar.");

            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_PAGE_BYTES) throw new IOException("Halaman terlalu besar.");
                    output.write(buffer, 0, read);
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            connection.disconnect();
        }
    }

    private void downloadPdf(String pdfUrl, File directory, Set<String> usedNames) throws IOException {
        if (!isOfficialOjkUrl(pdfUrl)) throw new IOException("Domain PDF tidak diizinkan.");

        String fileName = uniqueFileName(fileNameFromUrl(pdfUrl), usedNames);
        File destination = new File(directory, fileName);
        if (destination.exists() && isValidPdf(destination)) return;

        File partial = new File(directory, fileName + ".part");
        if (partial.exists()) partial.delete();
        HttpURLConnection connection = openOfficialConnection(pdfUrl);
        try {
            int response = connection.getResponseCode();
            if (response < 200 || response >= 300) throw new IOException("HTTP " + response);

            long contentLength = connection.getContentLengthLong();
            if (contentLength > MAX_PDF_BYTES) throw new IOException("PDF terlalu besar.");

            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(partial))) {
                byte[] buffer = new byte[16384];
                int total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_PDF_BYTES) throw new IOException("PDF terlalu besar.");
                    output.write(buffer, 0, read);
                }
            }

            if (!isValidPdf(partial)) throw new IOException("File bukan PDF yang valid.");
            if (destination.exists() && !destination.delete()) throw new IOException("Tidak dapat mengganti file.");
            if (!partial.renameTo(destination)) copyFile(partial, destination);
        } finally {
            connection.disconnect();
            if (partial.exists()) partial.delete();
        }
    }

    /**
     * Opens only HTTPS connections to ojk.go.id and validates every redirect hop.
     * This prevents a trusted OJK URL from redirecting the native downloader to an
     * unrelated host or to cleartext HTTP.
     */
    private HttpURLConnection openOfficialConnection(String initialUrl) throws IOException {
        String currentUrl = initialUrl;
        for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
            if (!isOfficialOjkUrl(currentUrl)) throw new IOException("Domain tidak diizinkan.");

            HttpURLConnection connection = (HttpURLConnection) new URL(currentUrl).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(45000);
            connection.setRequestProperty("User-Agent", "RegulaBank/1.1 (Android; official OJK PDF reader)");
            connection.setRequestProperty("Accept", "application/pdf,text/html;q=0.9,*/*;q=0.8");

            int response = connection.getResponseCode();
            if (response < 300 || response >= 400) return connection;

            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null || location.trim().isEmpty()) {
                throw new IOException("Redirect tanpa lokasi tujuan.");
            }

            try {
                currentUrl = new URI(currentUrl).resolve(location.trim()).toString();
            } catch (Exception error) {
                throw new IOException("Redirect tidak valid.", error);
            }
        }
        throw new IOException("Terlalu banyak redirect.");
    }

    private boolean isOfficialOjkUrl(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            String scheme = uri.getScheme();
            int port = uri.getPort();
            if (host == null || !"https".equalsIgnoreCase(scheme)) return false;
            if (uri.getUserInfo() != null) return false;
            if (port != -1 && port != 443) return false;
            String normalizedHost = host.toLowerCase(Locale.ROOT);
            return normalizedHost.equals("ojk.go.id") || normalizedHost.endsWith(".ojk.go.id");
        } catch (Exception ignored) {
            return false;
        }
    }

    private String decodeHtml(String value) {
        return Html.fromHtml(value, Html.FROM_HTML_MODE_LEGACY).toString();
    }

    private String fileNameFromUrl(String value) {
        try {
            String path = new URL(value).getPath();
            String name = path.substring(path.lastIndexOf('/') + 1);
            name = URLDecoder.decode(name, StandardCharsets.UTF_8.name());
            name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
            if (!name.toLowerCase(Locale.ROOT).endsWith(".pdf")) name += ".pdf";
            if (name.length() > 110) name = name.substring(0, 106) + ".pdf";
            return name.isEmpty() ? "dokumen-ojk.pdf" : name;
        } catch (Exception ignored) {
            return "dokumen-ojk.pdf";
        }
    }

    private String uniqueFileName(String original, Set<String> usedNames) {
        String candidate = original;
        int suffix = 2;
        while (!usedNames.add(candidate.toLowerCase(Locale.ROOT))) {
            String base = original.substring(0, Math.max(0, original.length() - 4));
            candidate = base + "-" + suffix++ + ".pdf";
        }
        return candidate;
    }

    private String sanitizeId(String value) {
        if (value == null) return "";
        String candidate = value.trim();
        return REGULATION_ID_PATTERN.matcher(candidate).matches() ? candidate : "";
    }

    private File pdfDirectory(String regulationId) {
        String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty()) return new File(new File(activity.getFilesDir(), "pdfs"), "__invalid__");
        return new File(new File(activity.getFilesDir(), "pdfs"), safeId);
    }

    private List<File> listDownloadedPdfs(String regulationId) {
        String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty()) return new ArrayList<>();
        File[] files = pdfDirectory(safeId).listFiles(
                file -> file.isFile() && file.getName().toLowerCase(Locale.ROOT).endsWith(".pdf") && isValidPdf(file)
        );
        List<File> result = new ArrayList<>();
        if (files != null) Collections.addAll(result, files);
        result.sort(Comparator.comparing(File::getName, String.CASE_INSENSITIVE_ORDER));
        return result;
    }

    private boolean isValidPdf(File file) {
        if (!file.isFile() || file.length() < 5) return false;
        byte[] header = new byte[5];
        try (FileInputStream input = new FileInputStream(file)) {
            return input.read(header) == 5
                    && header[0] == '%' && header[1] == 'P' && header[2] == 'D'
                    && header[3] == 'F' && header[4] == '-';
        } catch (IOException ignored) {
            return false;
        }
    }

    private void copyFile(File source, File destination) throws IOException {
        try (InputStream input = new BufferedInputStream(new FileInputStream(source));
             BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(destination))) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
    }

    private void notifyDownload(String id, String state, int completed, int total, String message, int saved) {
        String script = "window.onPdfDownloadUpdate && window.onPdfDownloadUpdate("
                + JSONObject.quote(id) + "," + JSONObject.quote(state) + ","
                + completed + "," + total + "," + JSONObject.quote(message) + "," + saved + ");";
        activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private void showPdfPicker(String regulationId, String title) {
        List<File> files = listDownloadedPdfs(regulationId);
        if (files.isEmpty()) {
            Toast.makeText(activity, "Belum ada PDF yang tersimpan.", Toast.LENGTH_SHORT).show();
            return;
        }

        String[] names = new String[files.size()];
        for (int index = 0; index < files.size(); index++) names[index] = friendlyPdfName(files.get(index).getName());
        new AlertDialog.Builder(activity)
                .setTitle(title)
                .setItems(names, (dialog, which) -> openPdf(files.get(which)))
                .setNegativeButton("Tutup", null)
                .show();
    }

    private String friendlyPdfName(String fileName) {
        String decoded = fileName.replace('_', ' ').replace("%20", " ");
        return decoded.length() > 80 ? decoded.substring(0, 77) + "..." : decoded;
    }

    private void openPdf(File file) {
        Uri uri = PdfProvider.uriFor(activity, file);
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/pdf")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivity(intent);
        } catch (ActivityNotFoundException error) {
            toast("Pasang aplikasi pembaca PDF untuk membuka dokumen.");
        }
    }

    private void toast(String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }
}
