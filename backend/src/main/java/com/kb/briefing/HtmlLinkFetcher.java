package com.kb.briefing;

import java.util.List;

/** BRIEFING.md §1：HTML 列表页源（Anthropic / arXiv / 机器之心），解析规则由 {@link HtmlParsers} 提供。 */
public class HtmlLinkFetcher implements BriefingFetcher {

    /** 逐源解析规则。 */
    @FunctionalInterface
    public interface Parser {
        List<RawItem> parse(String html, int limit, BriefingSource source);
    }

    private final BriefingSource source;
    private final HttpTransport transport;
    private final Parser parser;

    public HtmlLinkFetcher(BriefingSource source, HttpTransport transport, Parser parser) {
        this.source = source;
        this.transport = transport;
        this.parser = parser;
    }

    @Override
    public BriefingSource source() {
        return source;
    }

    @Override
    public List<RawItem> fetch(int limit) {
        return parser.parse(transport.get(source.url(), JdkHttpTransport.ACCEPT_HTML,
                BriefingSources.attemptTimeout(source.id())), limit, source);
    }
}
