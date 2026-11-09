package com.kb.ioport;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * IMPORT-IMAGES.md §2：文件集合索引。key 是归一化的相对路径（POSIX `/`、无 `./`、无 `..`、无盘符）。
 *
 * <p>匹配顺序（§3.4）：精确 → 大小写不敏感 → basename 唯一匹配（多个同名算未命中，避免配错图）。
 */
final class AssetIndex {

    /** 命中结果：{@code path} 为索引里的实际路径。 */
    record Match(String path, byte[] bytes) {
    }

    private final Map<String, byte[]> byPath = new HashMap<>();
    private final Map<String, String> actualPathByLower = new HashMap<>();
    private final Map<String, List<String>> pathsByLowerBasename = new HashMap<>();
    /** 已被某条引用指向过的索引路径（无论上传成功与否），用于计算 skipped。 */
    private final Set<String> referenced = new HashSet<>();
    /** 图片素材路径：契约 §10.3 规定图片类条目**不**计入 skipped，需要单独区分。 */
    private final Set<String> imagePaths = new HashSet<>();

    /** 兼容旧调用：未声明类型时按图片素材登记（宁可少算 skipped，也不多报）。 */
    void put(String path, byte[] bytes) {
        put(path, bytes, true);
    }

    void put(String path, byte[] bytes, boolean image) {
        byPath.put(path, bytes);
        if (image) {
            imagePaths.add(path);
        }
        String lower = path.toLowerCase(Locale.ROOT);
        actualPathByLower.putIfAbsent(lower, path);
        pathsByLowerBasename.computeIfAbsent(basename(path).toLowerCase(Locale.ROOT), key -> new ArrayList<>())
                .add(path);
    }

    boolean isEmpty() {
        return byPath.isEmpty();
    }

    int size() {
        return byPath.size();
    }

    /** §3.4 三级匹配；未命中返回 null。 */
    Match match(String normalizedPath) {
        byte[] exact = byPath.get(normalizedPath);
        if (exact != null) {
            referenced.add(normalizedPath);
            return new Match(normalizedPath, exact);
        }
        String caseInsensitive = actualPathByLower.get(normalizedPath.toLowerCase(Locale.ROOT));
        if (caseInsensitive != null) {
            referenced.add(caseInsensitive);
            return new Match(caseInsensitive, byPath.get(caseInsensitive));
        }
        List<String> sameName = pathsByLowerBasename.get(basename(normalizedPath).toLowerCase(Locale.ROOT));
        if (sameName != null && sameName.size() == 1) {
            String unique = sameName.get(0);
            referenced.add(unique);
            return new Match(unique, byPath.get(unique));
        }
        return null;
    }

    /** 未被任何引用指向的文件数（含图片）。 */
    int unreferencedCount() {
        return byPath.size() - referenced.size();
    }

    /**
     * 未被任何引用指向、且**不是图片**的条目数 —— 契约 §10.3：只有这类「无关条目」才计入 skipped，
     * 图片类条目（无论是否被引用）都不进 skipped。
     */
    int unreferencedNonImageCount() {
        int count = 0;
        for (String path : byPath.keySet()) {
            if (!referenced.contains(path) && !imagePaths.contains(path)) {
                count++;
            }
        }
        return count;
    }

    static String basename(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0 ? path : path.substring(slash + 1);
    }
}
