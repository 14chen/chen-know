package com.kb.search;

import com.kb.common.ApiException;
import com.kb.common.PageResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

/** API.md §5 搜索。 */
@Service
public class SearchService {

    private static final Logger log = LoggerFactory.getLogger(SearchService.class);

    /** 正文高亮片段的窗口长度。 */
    private static final int SNIPPET_LENGTH = 200;

    private final SearchRepository searchRepository;
    private final SearchResultCache resultCache;

    public SearchService(SearchRepository searchRepository, SearchResultCache resultCache) {
        this.searchRepository = searchRepository;
        this.resultCache = resultCache;
    }

    public PageResponse<SearchHit> search(long spaceId, SearchQuery query) {
        String cacheKey = SearchResultCache.key(spaceId, query);
        SearchRepository.SearchPage page = resultCache.get(cacheKey);
        if (page == null) {
            try {
                // 一次查询带回命中行 + 总数（DEF-E3-002）；正文只取命中词附近的窗口（DEF-E3-001）
                page = searchRepository.search(spaceId, query);
            } catch (DataAccessException ex) {
                // 敌意输入（FTS5 元字符）不得冒泡成 500：SearchText 已做转义，
                // 这里是最后一道防线（SQLite 的 FTS 语法错误没有稳定的 SQLState，只能按 DataAccess 兜住）
                log.warn("FTS 查询被拒绝，按非法搜索词处理: expr={}, error={}", query.matchExpression(),
                        ex.getMostSpecificCause().getMessage());
                throw ApiException.validation("搜索词无法解析", "q");
            }
            resultCache.put(cacheKey, page);
        }
        return PageResponse.of(page.rows().stream().map(row -> toHit(row, query)).toList(),
                query.page(), query.size(), page.total());
    }

    private static SearchHit toHit(SearchRepository.SearchRow row, SearchQuery query) {
        String title = SearchHighlighter.highlight(row.title(), query.terms());
        if (!query.hasMatch()) {
            return new SearchHit(row.noteId(), title, row.excerpt(), row.score(), row.folderId(),
                    row.updatedAt(), null);
        }
        // 窗口文本只算一次命中标记，HTML 片段与 markdown 摘要共用
        SearchHighlighter.Rendered rendered = SearchHighlighter.render(row.window(), query.terms(),
                SNIPPET_LENGTH, SearchHighlighter.SNIPPET_RADIUS);
        return new SearchHit(row.noteId(), title, rendered.html(), row.score(), row.folderId(),
                row.updatedAt(), rendered.markdown());
    }
}
