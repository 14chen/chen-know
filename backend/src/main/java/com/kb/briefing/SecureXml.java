package com.kb.briefing;

import java.io.IOException;
import java.io.StringReader;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

/**
 * BRIEFING.md §5：XML 解析（JDK 自带）—— <b>必须禁用 DTD 与外部实体（防 XXE）</b>。
 *
 * <p>四层防护：安全处理开关 + 关闭外部通用/参数实体 + 不加载外部 DTD + 实体解析器返回空，
 * 因此即使 feed 里带 {@code <!DOCTYPE ... SYSTEM "file:///...">} 也读不到本地文件。
 */
@Component
public class SecureXml {

    public Document parse(String xml) {
        DocumentBuilder builder = newBuilder();
        try {
            return builder.parse(new InputSource(new StringReader(xml == null ? "" : xml)));
        } catch (SAXException | IOException e) {
            throw new BriefingFetchException("解析失败：" + shortMessage(e));
        }
    }

    DocumentBuilder newBuilder() {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(false);
            factory.setValidating(false);
            setFeature(factory, XMLConstants.FEATURE_SECURE_PROCESSING, true);
            setFeature(factory, "http://xml.org/sax/features/external-general-entities", false);
            setFeature(factory, "http://xml.org/sax/features/external-parameter-entities", false);
            setFeature(factory, "http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            setAttribute(factory, XMLConstants.ACCESS_EXTERNAL_DTD, "");
            setAttribute(factory, XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            // 兜底：任何实体解析请求都返回空内容，绝不访问文件/网络
            builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
            return builder;
        } catch (ParserConfigurationException e) {
            throw new IllegalStateException("XML 解析器初始化失败", e);
        }
    }

    private static void setFeature(DocumentBuilderFactory factory, String feature, boolean value) {
        try {
            factory.setFeature(feature, value);
        } catch (ParserConfigurationException | RuntimeException ignored) {
            // 某些实现不认识某个 feature：其余防护仍然生效
        }
    }

    private static void setAttribute(DocumentBuilderFactory factory, String name, String value) {
        try {
            factory.setAttribute(name, value);
        } catch (RuntimeException ignored) {
            // 同上
        }
    }

    private static String shortMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }
}
