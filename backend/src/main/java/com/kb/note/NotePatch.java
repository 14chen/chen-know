package com.kb.note;

import com.kb.common.ApiException;
import java.util.Map;

/**
 * PATCH /api/notes/{id} 的解析结果（API.md §4）。
 *
 * <p>请求体用 {@code Map} 承载而不是直接绑定 record：PATCH 是部分更新，
 * {@code {"folderId": null}}（移到未分类）与「不带 folderId」（不改目录）必须可区分，
 * 若直接绑定 record，两者都会变成 null，改标题会顺带把笔记搬出原目录。
 */
public record NotePatch(boolean hasFolderId, Long folderId,
        boolean hasTitle, String title,
        boolean hasContent, String content,
        boolean hasFavorite, Boolean favorite,
        boolean hasPinned, Boolean pinned,
        boolean hasSortOrder, Integer sortOrder) {

    public static NotePatch from(Map<String, Object> body) {
        if (body == null) {
            throw ApiException.validation("请求体不能为空", "body");
        }
        boolean hasFolderId = body.containsKey("folderId");
        boolean hasTitle = body.containsKey("title");
        boolean hasContent = body.containsKey("content");
        boolean hasFavorite = body.containsKey("isFavorite");
        boolean hasPinned = body.containsKey("isPinned");
        boolean hasSortOrder = body.containsKey("sortOrder");
        if (!(hasFolderId || hasTitle || hasContent || hasFavorite || hasPinned || hasSortOrder)) {
            throw ApiException.validation("没有可更新的字段", "body");
        }
        return new NotePatch(
                hasFolderId, hasFolderId ? optionalLong(body.get("folderId"), "folderId") : null,
                hasTitle, hasTitle ? string(body.get("title"), "title") : null,
                hasContent, hasContent ? string(body.get("content"), "content") : null,
                hasFavorite, hasFavorite ? bool(body.get("isFavorite"), "isFavorite") : null,
                hasPinned, hasPinned ? bool(body.get("isPinned"), "isPinned") : null,
                hasSortOrder, hasSortOrder ? intValue(body.get("sortOrder"), "sortOrder") : null);
    }

    private static String string(Object value, String field) {
        if (!(value instanceof String text)) {
            throw ApiException.validation(field + " 必须是字符串", field);
        }
        return text;
    }

    private static Long optionalLong(Object value, String field) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        throw ApiException.validation(field + " 必须是数字或 null", field);
    }

    private static Boolean bool(Object value, String field) {
        if (!(value instanceof Boolean flag)) {
            throw ApiException.validation(field + " 必须是布尔值", field);
        }
        return flag;
    }

    private static Integer intValue(Object value, String field) {
        if (!(value instanceof Number number)) {
            throw ApiException.validation(field + " 必须是数字", field);
        }
        long raw = number.longValue();
        if (raw < Integer.MIN_VALUE || raw > Integer.MAX_VALUE) {
            throw ApiException.validation(field + " 超出取值范围", field);
        }
        return (int) raw;
    }
}
