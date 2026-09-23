package id.regulabank.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

public final class AppBridge {
    private static final String INDEX_FILE = ".search-index.txt";
    private static final int MAX_INDEX_CHARS = 6_000_000;
    private static final int MAX_QUERY_LENGTH = 160;
    private static final Pattern REGULATION_ID_PATTERN = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_-]{0,79}");

    private final Activity activity;
    private final File pdfRoot;

    AppBridge(Activity activity) {
        this.activity = activity;
        this.pdfRoot = new File(activity.getFilesDir(), "pdfs");
        PDFBoxResourceLoader.init(activity.getApplicationContext());
    }

    @JavascriptInterface
    public void copyText(String label, String text) {
        if (text == null || text.isEmpty()) return;
        activity.runOnUiThread(() -> {
            ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard != null) {
                clipboard.setPrimaryClip(ClipData.newPlainText(safeLabel(label), text));
                Toast.makeText(activity, "Sitasi disalin.", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void shareText(String title, String text) {
        if (text == null || text.isEmpty()) return;
        activity.runOnUiThread(() -> {
            Intent share = new Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, safeLabel(title))
                    .putExtra(Intent.EXTRA_TEXT, text);
            activity.startActivity(Intent.createChooser(share, "Bagikan ketentuan"));
        });
    }

    @JavascriptInterface
    public boolean hasOfflineIndex(String regulationId) {
        String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty()) return false;
        File index = new File(regulationDirectory(safeId), INDEX_FILE);
        return index.isFile() && index.length() > 0;
    }

    @JavascriptInterface
    public int prepareOfflineIndex(String regulationId) {
        String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty()) return 0;

        File directory = regulationDirectory(safeId);
        List<File> pdfs = listPdfs(directory);
        if (pdfs.isEmpty()) return 0;

        File index = new File(directory, INDEX_FILE);
        File partial = new File(directory, INDEX_FILE + ".part");
        int indexed = 0;
        int characters = 0;

        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new BufferedOutputStream(new FileOutputStream(partial)), StandardCharsets.UTF_8))) {
            writer.write("# RegulaBank offline PDF index\n");
            for (File pdf : pdfs) {
                if (characters >= MAX_INDEX_CHARS) break;
                try (PDDocument document = PDDocument.load(pdf)) {
                    if (document.isEncrypted()) continue;
                    PDFTextStripper stripper = new PDFTextStripper();
                    stripper.setSortByPosition(true);
                    String text = stripper.getText(document);
                    if (text == null || text.trim().isEmpty()) continue;
                    int remaining = MAX_INDEX_CHARS - characters;
                    if (text.length() > remaining) text = text.substring(0, remaining);
                    writer.write("\n# FILE: ");
                    writer.write(pdf.getName());
                    writer.write("\n");
                    writer.write(text);
                    characters += text.length();
                    indexed++;
                } catch (Exception ignored) {
                    // A damaged or image-only attachment must not prevent other PDFs from being indexed.
                }
            }
        } catch (IOException error) {
            if (partial.exists()) partial.delete();
            return 0;
        }

        if (indexed == 0) {
            partial.delete();
            return 0;
        }
        if (index.exists() && !index.delete()) {
            partial.delete();
            return 0;
        }
        if (!partial.renameTo(index)) {
            try {
                copyFile(partial, index);
            } catch (IOException error) {
                partial.delete();
                return 0;
            }
            partial.delete();
        }
        return indexed;
    }

    @JavascriptInterface
    public String searchOfflinePdfIndex(String rawQuery) {
        JSONObject result = new JSONObject();
        JSONArray matches = new JSONArray();
        String query = normalize(rawQuery);
        if (query.length() > MAX_QUERY_LENGTH) query = query.substring(0, MAX_QUERY_LENGTH);
        String[] terms = query.split("\\s+");
        int indexedDocuments = 0;

        File[] directories = pdfRoot.listFiles(File::isDirectory);
        if (directories != null && !query.isEmpty()) {
            for (File directory : directories) {
                String safeId = sanitizeId(directory.getName());
                if (safeId.isEmpty()) continue;

                List<File> pdfs = listPdfs(directory);
                if (pdfs.isEmpty()) continue;
                File index = new File(directory, INDEX_FILE);
                if (!index.isFile() || index.lastModified() < newestModified(pdfs)) {
                    prepareOfflineIndex(safeId);
                }
                if (!index.isFile()) continue;

                indexedDocuments += pdfs.size();
                String text;
                try {
                    text = readText(index);
                } catch (IOException ignored) {
                    continue;
                }
                String normalizedText = normalize(text);
                boolean allMatch = true;
                int firstHit = -1;
                for (String term : terms) {
                    if (term.isEmpty()) continue;
                    int hit = normalizedText.indexOf(term);
                    if (hit < 0) {
                        allMatch = false;
                        break;
                    }
                    if (firstHit < 0 || hit < firstHit) firstHit = hit;
                }
                if (!allMatch) continue;

                JSONObject match = new JSONObject();
                try {
                    match.put("id", safeId);
                    match.put("snippet", snippet(normalizedText, firstHit));
                    matches.put(match);
                } catch (JSONException ignored) {
                    // Keep returning any other valid matches.
                }
            }
        }

        try {
            result.put("matches", matches);
            result.put("indexedDocuments", indexedDocuments);
        } catch (JSONException ignored) {
            return "{\"matches\":[],\"indexedDocuments\":0}";
        }
        return result.toString();
    }

    @JavascriptInterface
    public String getOfflineStorageStats() {
        StorageStats stats = collectStats(pdfRoot);
        JSONObject result = new JSONObject();
        try {
            result.put("bytes", stats.bytes);
            result.put("pdfFiles", stats.pdfFiles);
            result.put("indexFiles", stats.indexFiles);
            result.put("formattedBytes", formatBytes(stats.bytes));
        } catch (JSONException ignored) {
            return "{\"bytes\":0,\"pdfFiles\":0,\"indexFiles\":0,\"formattedBytes\":\"0 KB\"}";
        }
        return result.toString();
    }

    @JavascriptInterface
    public int clearOfflineData() {
        if (!pdfRoot.exists()) return 0;
        return deleteChildren(pdfRoot);
    }

    private File regulationDirectory(String regulationId) {
        String safeId = sanitizeId(regulationId);
        if (safeId.isEmpty()) return new File(pdfRoot, "__invalid__");
        return new File(pdfRoot, safeId);
    }

    private String sanitizeId(String value) {
        if (value == null) return "";
        String candidate = value.trim();
        return REGULATION_ID_PATTERN.matcher(candidate).matches() ? candidate : "";
    }

    private String safeLabel(String value) {
        if (value == null || value.trim().isEmpty()) return "RegulaBank";
        return value.length() > 100 ? value.substring(0, 100) : value;
    }

    private List<File> listPdfs(File directory) {
        File[] files = directory.listFiles(file ->
                file.isFile() && file.getName().toLowerCase(Locale.ROOT).endsWith(".pdf")
        );
        List<File> result = new ArrayList<>();
        if (files != null) Collections.addAll(result, files);
        result.sort(Comparator.comparing(File::getName, String.CASE_INSENSITIVE_ORDER));
        return result;
    }

    private long newestModified(List<File> files) {
        long newest = 0;
        for (File file : files) newest = Math.max(newest, file.lastModified());
        return newest;
    }

    private String normalize(String value) {
        String normalized = Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", " ")
                .trim();
        return normalized.replaceAll("\\s+", " ");
    }

    private String snippet(String text, int hit) {
        if (text.isEmpty()) return "";
        int safeHit = Math.max(0, hit);
        int start = Math.max(0, safeHit - 75);
        int end = Math.min(text.length(), safeHit + 170);
        String value = text.substring(start, end).trim();
        return (start > 0 ? "… " : "") + value + (end < text.length() ? " …" : "");
    }

    private String readText(File file) throws IOException {
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new BufferedInputStream(new FileInputStream(file)), StandardCharsets.UTF_8))) {
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1 && output.length() < MAX_INDEX_CHARS) {
                int allowed = Math.min(read, MAX_INDEX_CHARS - output.length());
                output.append(buffer, 0, allowed);
            }
        }
        return output.toString();
    }

    private void copyFile(File source, File destination) throws IOException {
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(source));
             BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(destination))) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
    }

    private StorageStats collectStats(File file) {
        StorageStats stats = new StorageStats();
        if (!file.exists()) return stats;
        File[] files = file.listFiles();
        if (files == null) return stats;
        for (File child : files) {
            if (child.isDirectory()) {
                stats.add(collectStats(child));
            } else {
                stats.bytes += child.length();
                String name = child.getName().toLowerCase(Locale.ROOT);
                if (name.endsWith(".pdf")) stats.pdfFiles++;
                else if (INDEX_FILE.equals(name)) stats.indexFiles++;
            }
        }
        return stats;
    }

    private int deleteChildren(File directory) {
        int deleted = 0;
        File[] files = directory.listFiles();
        if (files == null) return 0;
        for (File file : files) {
            if (file.isDirectory()) deleted += deleteChildren(file);
            if (file.delete()) deleted++;
        }
        return deleted;
    }

    private String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double kilobytes = bytes / 1024.0;
        if (kilobytes < 1024) return String.format(Locale.US, "%.1f KB", kilobytes);
        return String.format(Locale.US, "%.1f MB", kilobytes / 1024.0);
    }

    private static final class StorageStats {
        long bytes;
        int pdfFiles;
        int indexFiles;

        void add(StorageStats other) {
            bytes += other.bytes;
            pdfFiles += other.pdfFiles;
            indexFiles += other.indexFiles;
        }
    }
}
