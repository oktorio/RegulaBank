package id.regulabank.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SecurityPolicyTest {
    @Test
    public void officialOjkUrlAcceptsHttpsAuthorityAndSubdomains() {
        assertTrue(SecurityPolicy.isOfficialOjkUrl("https://ojk.go.id/id/regulasi/"));
        assertTrue(SecurityPolicy.isOfficialOjkUrl("https://www.ojk.go.id/id/regulasi/"));
        assertTrue(SecurityPolicy.isOfficialOjkUrl("https://jdih.ojk.go.id/"));
        assertTrue(SecurityPolicy.isOfficialOjkUrl("https://ojk.go.id:443/id/regulasi/"));
    }

    @Test
    public void officialOjkUrlRejectsLookalikesCleartextAndCredentials() {
        assertFalse(SecurityPolicy.isOfficialOjkUrl("http://ojk.go.id/id/regulasi/"));
        assertFalse(SecurityPolicy.isOfficialOjkUrl("https://ojk.go.id.evil.example/"));
        assertFalse(SecurityPolicy.isOfficialOjkUrl("https://evil.example/?next=https://ojk.go.id"));
        assertFalse(SecurityPolicy.isOfficialOjkUrl("https://user@ojk.go.id/"));
        assertFalse(SecurityPolicy.isOfficialOjkUrl("https://ojk.go.id:8443/"));
    }

    @Test
    public void regulationIdRejectsTraversalAndUnsafeCharacters() {
        assertEquals("pojk-27-2016", SecurityPolicy.sanitizeRegulationId(" po jk ".replace(" ", "")));
        assertEquals("", SecurityPolicy.sanitizeRegulationId("../pojk-27-2016"));
        assertEquals("", SecurityPolicy.sanitizeRegulationId("pojk/27/2016"));
        assertEquals("", SecurityPolicy.sanitizeRegulationId(""));
    }
}
