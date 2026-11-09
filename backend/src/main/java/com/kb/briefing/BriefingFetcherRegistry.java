package com.kb.briefing;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/** BRIEFING.md §5：按 {@link BriefingSources} 的清单装配全部抓取器（顺序 = 渲染顺序）。 */
@Component
public class BriefingFetcherRegistry {

    private final List<BriefingFetcher> fetchers;

    public BriefingFetcherRegistry(HttpTransport transport, SecureXml secureXml) {
        List<BriefingFetcher> built = new ArrayList<>();
        for (BriefingSource source : BriefingSources.ALL) {
            built.add(switch (source.id()) {
                case "hackernews" -> new HackerNewsFetcher(source, transport);
                case "anthropic" -> new HtmlLinkFetcher(source, transport, HtmlParsers::anthropic);
                case "arxiv" -> new HtmlLinkFetcher(source, transport, HtmlParsers::arxiv);
                case "jiqizhixin" -> new HtmlLinkFetcher(source, transport, HtmlParsers::jiqizhixin);
                case "techmeme" -> new RssFetcher(source, transport, secureXml, HtmlParsers::techmemeArticleLink);
                default -> new RssFetcher(source, transport, secureXml, null);
            });
        }
        this.fetchers = List.copyOf(built);
    }

    public List<BriefingFetcher> all() {
        return fetchers;
    }

    public List<BriefingSource> sources() {
        return BriefingSources.ALL;
    }

    /** 渲染/报告用的稳定源顺序（含被跳过的源）。 */
    public List<BriefingSource> sourcesInOrder() {
        return BriefingSources.ALL;
    }
}
