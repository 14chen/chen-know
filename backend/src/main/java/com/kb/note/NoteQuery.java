package com.kb.note;

import com.kb.common.ApiException;
import com.kb.common.PageResponse;
import com.kb.common.SearchText;

/**
 * GET /api/notes 的查询条件（API.md §4 + §3.1 的 folderId 语义）。
 *
 * <p>{@code folderId}：不传 = 不按目录过滤；{@code 0} = 未分类（{@code folder_id IS NULL}）；
 * 正整数 = 该目录的直属笔记；负数视为非法参数（400）。
 * {@code q} 走 SCHEMA §2 的 FTS5 表达式，空串表示无有效检索词，退化为普通列表。
 */
public record NoteQuery(Long folderId, String tag, String matchExpression, boolean favoriteOnly,
        Sort sort, int page, int size) {

    /**
     * 契约只允许 updated | created | title，列名白名单化后拼进 ORDER BY。
     * 三段排序键**永远**以 {@code is_pinned DESC} 起头（API.md §4.4）：置顶是用户可见的效果，
     * 不能被 sort 参数挤掉。
     */
    public enum Sort {
        UPDATED("n.is_pinned DESC, n.updated_at DESC, n.id DESC"),
        CREATED("n.is_pinned DESC, n.created_at DESC, n.id DESC"),
        TITLE("n.is_pinned DESC, n.title COLLATE NOCASE ASC, n.id ASC");

        private final String orderBy;

        Sort(String orderBy) {
            this.orderBy = orderBy;
        }

        public String orderBy() {
            return orderBy;
        }

        public static Sort parse(String raw) {
            if (raw == null || raw.isBlank()) {
                return UPDATED;
            }
            return switch (raw) {
                case "updated" -> UPDATED;
                case "created" -> CREATED;
                case "title" -> TITLE;
                default -> throw ApiException.validation("sort 只能是 updated、created 或 title", "sort");
            };
        }
    }

    public static NoteQuery of(Long folderId, String tag, String q, Boolean favorite, String sort,
            Integer pageParam, Integer sizeParam) {
        if (folderId != null && folderId < 0) {
            throw ApiException.validation("folderId 不能为负数", "folderId");
        }
        int page = PageResponse.normalizePage(pageParam);
        int size = PageResponse.normalizeSize(sizeParam);
        return new NoteQuery(folderId, tag == null || tag.isBlank() ? null : tag,
                SearchText.toMatchExpression(q), Boolean.TRUE.equals(favorite), Sort.parse(sort), page, size);
    }

    public int offset() {
        return PageResponse.offset(page, size);
    }

    /** GET /api/favorites：与列表同一条查询路径，只多一个 is_favorite = 1（folderId 语义同 §3.1）。 */
    public static NoteQuery favorites(Long folderId, Integer pageParam, Integer sizeParam) {
        if (folderId != null && folderId < 0) {
            throw ApiException.validation("folderId 不能为负数", "folderId");
        }
        return new NoteQuery(folderId, null, "", true, Sort.UPDATED,
                PageResponse.normalizePage(pageParam), PageResponse.normalizeSize(sizeParam));
    }
}
