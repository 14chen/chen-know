package com.kb.folder;

import com.kb.common.ApiException;
import java.util.Map;

/**
 * PATCH /api/folders/{id} 的解析结果（API.md §3）。
 *
 * <p>请求体用 {@code Map} 承载而不是直接绑定 record：PATCH 是部分更新，
 * {@code {"parentId": null}}（移动到根）与「不带 parentId」（保持原位）必须可区分，
 * 若直接绑定 record，两者都会变成 null，改名会顺带把目录搬到根，属于静默数据破坏。
 */
public record FolderPatch(boolean hasName, String name, boolean hasParentId, Long parentId,
        boolean hasSortOrder, Integer sortOrder) {

    public static FolderPatch from(Map<String, Object> body) {
        if (body == null) {
            throw ApiException.validation("请求体不能为空", "body");
        }
        boolean hasName = body.containsKey("name");
        boolean hasParentId = body.containsKey("parentId");
        boolean hasSortOrder = body.containsKey("sortOrder");
        if (!hasName && !hasParentId && !hasSortOrder) {
            throw ApiException.validation("没有可更新的字段", "body");
        }
        return new FolderPatch(
                hasName,
                hasName ? requireString(body.get("name"), "name") : null,
                hasParentId,
                hasParentId ? optionalLong(body.get("parentId"), "parentId") : null,
                hasSortOrder,
                hasSortOrder ? requireInt(body.get("sortOrder"), "sortOrder") : null);
    }

    private static String requireString(Object value, String field) {
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

    private static Integer requireInt(Object value, String field) {
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
