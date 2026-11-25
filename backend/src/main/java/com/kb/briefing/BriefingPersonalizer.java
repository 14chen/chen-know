package com.kb.briefing;

import com.kb.search.SearchHit;
import com.kb.search.SearchQuery;
import com.kb.search.SearchService;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** 本地个性化：用全文检索找用户知识库里的相关笔记标题。只读本地 DB，不外发任何内容。 */
@Service
public class BriefingPersonalizer {

    private static final Logger log = LoggerFactory.getLogger(BriefingPersonalizer.class);

    private final SearchService search;
    private final BriefingProperties properties;

    public BriefingPersonalizer(SearchService search, BriefingProperties properties) {
        this.search = search;
        this.properties = properties;
    }

    public List<String> relatedTitles(long spaceId, String title) {
        if (!properties.isPersonalize() || title == null || title.isBlank()) {
            return List.of();
        }
        try {
            return search.search(spaceId, SearchQuery.of(title, null, null, 1, 3))
                    .items().stream()
                    .map(SearchHit::title)
                    .filter(value -> value != null && !value.isBlank())
                    .distinct()
                    .limit(3)
                    .toList();
        } catch (RuntimeException e) {
            log.debug("本地个性化查询失败，跳过: {}", e.getClass().getSimpleName());
            return List.of();
        }
    }
}
