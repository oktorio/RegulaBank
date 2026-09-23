package id.regulabank.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;

public class PdfProvider extends ContentProvider {
    private static final String AUTHORITY_SUFFIX = ".pdfs";

    public static Uri uriFor(Context context, File file) {
        File root = new File(context.getFilesDir(), "pdfs");
        try {
            String rootPath = root.getCanonicalPath();
            String filePath = file.getCanonicalPath();
            if (!filePath.startsWith(rootPath + File.separator)) {
                throw new IllegalArgumentException("PDF berada di luar penyimpanan aplikasi.");
            }

            String relative = filePath.substring(rootPath.length() + 1);
            String[] parts = relative.split("[\\\\/]", 2);
            if (parts.length != 2) throw new IllegalArgumentException("Lokasi PDF tidak valid.");

            return new Uri.Builder()
                    .scheme("content")
                    .authority(context.getPackageName() + AUTHORITY_SUFFIX)
                    .appendPath(parts[0])
                    .appendPath(parts[1])
                    .build();
        } catch (IOException error) {
            throw new IllegalArgumentException("Lokasi PDF tidak valid.", error);
        }
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        return "application/pdf";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File file;
        try {
            file = resolveFile(uri);
        } catch (FileNotFoundException error) {
            throw new IllegalArgumentException("PDF tidak ditemukan.", error);
        }
        String[] columns = projection != null
                ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(file.getName());
            else if (OpenableColumns.SIZE.equals(column)) row.add(file.length());
            else row.add(null);
        }
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Hanya akses baca yang diizinkan.");
        File file = resolveFile(uri);
        if (!file.isFile()) throw new FileNotFoundException("PDF tidak ditemukan.");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    private File resolveFile(Uri uri) throws FileNotFoundException {
        Context context = getContext();
        if (context == null) throw new FileNotFoundException("Penyimpanan tidak tersedia.");
        List<String> segments = uri.getPathSegments();
        if (segments.size() != 2) throw new FileNotFoundException("Lokasi PDF tidak valid.");

        File root = new File(context.getFilesDir(), "pdfs");
        File candidate = new File(new File(root, segments.get(0)), segments.get(1));
        try {
            String rootPath = root.getCanonicalPath();
            String candidatePath = candidate.getCanonicalPath();
            if (!candidatePath.startsWith(rootPath + File.separator)) {
                throw new FileNotFoundException("Lokasi PDF tidak diizinkan.");
            }
            return candidate;
        } catch (IOException error) {
            throw new FileNotFoundException("Lokasi PDF tidak valid.");
        }
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
