package id.regulabank.app;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

final class SecurityPolicy {
    private static final Pattern REGULATION_ID_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9_-]{0,79}");

    private SecurityPolicy() {}

    static String sanitizeRegulationId(String value) {
        if (value == null) return "";
        String candidate = value.trim();
        return REGULATION_ID_PATTERN.matcher(candidate).matches() ? candidate : "";
    }

    static boolean isOfficialOjkUrl(String value) {
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
}
