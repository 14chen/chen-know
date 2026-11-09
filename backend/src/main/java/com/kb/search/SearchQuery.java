package com.kb.search;

import com.kb.common.ApiException;
import com.kb.common.PageResponse;
import com.kb.common.SearchText;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;

/**
 * GET /api/search 的查询条件（API.md §5 + 增强筛选）。
 *
 * <p>{@code q} 为空（或全是 FTS5 元字符、没有有效检索词）时退化为按 tag/tagId/folderId/日期过滤的列表。
 *
 * @param folderId 只搜这个目录<b>及其子目录</b>；{@code 0} 表示「未分类」（folder_id IS NULL）
 * @param tag 按标签名过滤（既有参数，大小写不敏感）
 * @param tagId 按标签 id 过滤（新增）
 * @param from 更新日期 &gt;= 该天（YYYY-MM-DD，含当天）
 * @param to 更新日期 &lt;= 该天（YYYY-MM-DD，含当天）
 * @param sort {@code relevance}（默认）或 {@code updated}
 */
public record SearchQuery(String matchExpression, List<String> terms, Long folderId, String tag, Long tagId,
        String from, String to, String sort, int page, int size) {

    public static final String SORT_RELEVANCE = "relevance";
    public static final String SORT_UPDATED = "updated";

    /** 兼容旧调用方（未传新参数时行为与改造前完全一致）。 */
    public static SearchQuery of(String q, String tag, Long folderId, Integer pageParam, Integer sizeParam) {
        return of(q, tag, null, folderId, null, null, null, pageParam, sizeParam);
    }

    public static SearchQuery of(String q, String tag, Long tagId, Long folderId, String from, String to,
            String sort, Integer pageParam, Integer sizeParam) {
        if (folderId != null && folderId < 0) {
            throw ApiException.validation("folderId 不能为负数", "folderId");
        }
        if (tagId != null && tagId < 0) {
            throw ApiException.validation("tagId 不能为负数", "tagId");
        }
        String normalizedFrom = date(from, "from");
        String normalizedTo = date(to, "to");
        if (normalizedFrom != null && normalizedTo != null && normalizedFrom.compareTo(normalizedTo) > 0) {
            throw ApiException.validation("from 不能晚于 to", "from");
        }
        return new SearchQuery(SearchText.toMatchExpression(q), SearchHighlighter.terms(q),
                folderId, blankToNull(tag), tagId, normalizedFrom, normalizedTo, sortOf(sort),
                PageResponse.normalizePage(pageParam), PageResponse.normalizeSize(sizeParam));
    }

    /** 校验并归一化日期参数（YYYY-MM-DD）。 */
    static String date(String raw, String field) {
        String value = blankToNull(raw);
        if (value == null) {
            return null;
        }
        try {
            return LocalDate.parse(value).toString();
        } catch (DateTimeParseException e) {
            throw ApiException.validation(field + " 需要 YYYY-MM-DD 格式的日期", field);
        }
    }

    static String sortOf(String raw) {
        String value = blankToNull(raw);
        if (value == null) {
            return SORT_RELEVANCE;
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        if (!SORT_RELEVANCE.equals(normalized) && !SORT_UPDATED.equals(normalized)) {
            throw ApiException.validation("sort 只能是 relevance 或 updated", "sort");
        }
        return normalized;
    }

    private static String blankToNull(String raw) {
        return raw == null || raw.isBlank() ? null : raw.trim();
    }

    public boolean hasMatch() {
        return matchExpression != null && !matchExpression.isEmpty();
    }

    public boolean sortByUpdated() {
        return SORT_UPDATED.equals(sort);
    }

    public int offset() {
        return PageResponse.offset(page, size);
    }
}
