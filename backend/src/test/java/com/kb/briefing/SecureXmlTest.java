package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;

/** BRIEFING.md §9 #14：XXE —— 带外部实体的 XML 不得读取本地文件。 */
class SecureXmlTest {

    @Test
    @DisplayName("XXE：外部实体指向本地文件时不得泄露文件内容")
    void doesNotResolveExternalEntities() throws Exception {
        Path secret = Files.createTempFile("kb-briefing-secret", ".txt");
        Files.writeString(secret, "TOP-SECRET-MARKER");
        String xml = """
                <?xml version="1.0"?>
                <!DOCTYPE rss [ <!ENTITY xxe SYSTEM "file:///%s"> ]>
                <rss><channel><item><title>&xxe;</title><link>https://example.com/a</link></item></channel></rss>
                """.formatted(secret.toAbsolutePath().toString().replace("\\", "/"));

        String leaked;
        try {
            Document document = new SecureXml().parse(xml);
            leaked = document.getDocumentElement().getTextContent();
        } catch (BriefingFetchException e) {
            leaked = "";           // 直接拒绝解析也算安全
        }
        assertFalse(leaked.contains("TOP-SECRET-MARKER"), "不得读到本地文件内容: " + leaked);
        Files.deleteIfExists(secret);
    }

    @Test
    @DisplayName("正常 RSS（含 CDATA 与实体）可以解析")
    void parsesNormalFeed() {
        Document document = new SecureXml().parse("""
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0"><channel><item>
                  <title><![CDATA[Hello <b>world</b>]]></title>
                  <link>https://example.com/a?x=1&amp;y=2</link>
                  <description><![CDATA[<p>desc</p>]]></description>
                </item></channel></rss>
                """);
        assertTrue(document.getDocumentElement().getTextContent().contains("Hello"));
    }

    @Test
    @DisplayName("彻底损坏的 XML → BriefingFetchException（原因是解析失败）")
    void rejectsBrokenXml() {
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> new SecureXml().parse("<rss><channel>"));
        assertTrue(error.getMessage().startsWith("解析失败"), error.getMessage());
    }
}
