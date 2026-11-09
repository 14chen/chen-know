package com.kb.briefing;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * BRIEFING.md §1：RSS / Atom 抓取（6 个源共用；XML 解析集中在 {@link SecureXml}，防 XXE）。
 *
 * <p>Techmeme 的 description 是富文本、真正的原文链接在里面，由 {@code articleLinkExtractor} 提取。
 */
public class RssFetcher implements BriefingFetcher {

    private final BriefingSource source;
    private final HttpTransport transport;
    private final SecureXml xml;
    private final Function<String, String> articleLinkExtractor;

    public RssFetcher(BriefingSource source, HttpTransport transport, SecureXml xml,
            Function<String, String> articleLinkExtractor) {
        this.source = source;
        this.transport = transport;
        this.xml = xml;
        this.articleLinkExtractor = articleLinkExtractor;
    }

    @Override
    public BriefingSource source() {
        return source;
    }

    @Override
    public List<RawItem> fetch(int limit) {
        String body = transport.get(source.url(), JdkHttpTransport.ACCEPT_RSS,
                BriefingSources.attemptTimeout(source.id()));
        Document document = xml.parse(body);
        List<Element> entries = Xml.elementsNamed(document, "item");
        if (entries.isEmpty()) {
            entries = Xml.elementsNamed(document, "entry");
        }
        List<RawItem> items = new ArrayList<>();
        for (Element entry : entries) {
            if (items.size() >= limit) {
                break;
            }
            String title = BriefingText.clean(Xml.textOf(entry, "title"));
            String link = Xml.textOf(entry, "link");
            if (link.isEmpty()) {
                link = Xml.attributeOf(entry, "link", "href");
            }
            String description = Xml.firstNonEmpty(Xml.textOf(entry, "description"),
                    Xml.textOf(entry, "summary"), Xml.textOf(entry, "content"));
            String published = Xml.firstNonEmpty(Xml.textOf(entry, "pubDate"),
                    Xml.textOf(entry, "published"), Xml.textOf(entry, "updated"));
            if (articleLinkExtractor != null) {
                String real = articleLinkExtractor.apply(description);
                if (real != null && !real.isBlank()) {
                    link = real;
                }
            }
            if (title.isEmpty() || !BriefingUrls.isHttpUrl(link)) {
                continue;
            }
            items.add(new RawItem(title, link.trim(), description, source.id(), null, published));
        }
        if (items.isEmpty()) {
            throw new BriefingFetchException("0 条（页面结构可能变化）");
        }
        return items;
    }

    /** DOM 小工具：不依赖命名空间前缀，按本地名匹配。 */
    static final class Xml {

        private Xml() {
        }

        static List<Element> elementsNamed(Document document, String name) {
            List<Element> found = new ArrayList<>();
            NodeList all = document.getElementsByTagName("*");
            for (int i = 0; i < all.getLength(); i++) {
                Node node = all.item(i);
                if (node instanceof Element element && localName(element).equalsIgnoreCase(name)) {
                    found.add(element);
                }
            }
            return found;
        }

        static String textOf(Element parent, String childName) {
            List<Element> children = elementsNamed(parent.getOwnerDocument(), childName);
            for (Element child : children) {
                if (isDescendantOf(child, parent)) {
                    String text = child.getTextContent();
                    if (text != null && !text.isBlank()) {
                        return text.trim();
                    }
                }
            }
            return "";
        }

        static String attributeOf(Element parent, String childName, String attributeName) {
            List<Element> children = elementsNamed(parent.getOwnerDocument(), childName);
            for (Element child : children) {
                if (isDescendantOf(child, parent)) {
                    String value = child.getAttribute(attributeName);
                    if (value != null && !value.isBlank()) {
                        return value.trim();
                    }
                }
            }
            return "";
        }

        static String localName(Element element) {
            String tag = element.getTagName();
            int colon = tag.indexOf(':');
            return colon < 0 ? tag : tag.substring(colon + 1);
        }

        static boolean isDescendantOf(Element candidate, Element ancestor) {
            for (Node node = candidate; node != null; node = node.getParentNode()) {
                if (node == ancestor) {
                    return true;
                }
            }
            return false;
        }

        static String firstNonEmpty(String... values) {
            for (String value : values) {
                if (value != null && !value.isBlank()) {
                    return value;
                }
            }
            return "";
        }
    }
}
