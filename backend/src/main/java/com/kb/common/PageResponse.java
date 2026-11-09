package com.kb.common;

import java.util.List;

/**
 * API.md §0.3 分页响应：{@code { items, page, size, total }}。
 * page 从 1 起，size 上限 200、默认 50。数据访问层直接用 LIMIT/OFFSET，不引入 JPA。
 */
public record PageResponse<T>(List<T> items, int page, int size, long total) {

    public static final int DEFAULT_SIZE = 50;
    public static final int MAX_SIZE = 200;

    public static int normalizePage(Integer page) {
        return page == null || page < 1 ? 1 : page;
    }

    public static int normalizeSize(Integer size) {
        if (size == null || size < 1) {
            return DEFAULT_SIZE;
        }
        return Math.min(size, MAX_SIZE);
    }

    public static int offset(int page, int size) {
        return (page - 1) * size;
    }

    public static <T> PageResponse<T> of(List<T> items, int page, int size, long total) {
        return new PageResponse<>(items, page, size, total);
    }
}
