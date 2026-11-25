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
        boolean hasSortOrder, Integer sortOrder,
        /**
         * 是否为本次改动新建一个历史版本并递增 version。默认 true（兼容既有调用）；
         * 自动保存传 false —— 正文落盘但不产生版本，避免写到一半就刷出一堆版本。
         */
        boolean createVersion,
        /** createVersion=true 时，即使内容没变也强制留一个快照（用户显式点「存为版本」）。 */
        boolean forceVersion) {

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
        boolean hasForceVersion = body.containsKey("forceVersion") && Boolean.TRUE.equals(body.get("forceVersion"));
        if (!(hasFolderId || hasTitle || hasContent || hasFavorite || hasPinned || hasSortOrder || hasForceVersion)) {
            throw ApiException.validation("没有可更新的字段", "body");
        }
        return new NotePatch(
                hasFolderId, hasFolderId ? optionalLong(body.get("folderId"), "folderId") : null,
                hasTitle, hasTitle ? string(body.get("title"), "title") : null,
                hasContent, hasContent ? string(body.get("content"), "content") : null,
                hasFavorite, hasFavorite ? bool(body.get("isFavorite"), "isFavorite") : null,
                hasPinned, hasPinned ? bool(body.get("isPinned"), "isPinned") : null,
                hasSortOrder, hasSortOrder ? intValue(body.get("sortOrder"), "sortOrder") : null,
                body.containsKey("createVersion") ? bool(body.get("createVersion"), "createVersion") : true,
                body.containsKey("forceVersion") ? bool(body.get("forceVersion"), "forceVersion") : false);
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
