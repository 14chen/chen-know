package com.kb.ioport;

import java.util.List;

/**
 * API.md §10 / IMPORT-IMAGES.md §6.2 {@code POST /api/import/markdown} 响应。
 *
 * @param imagesImported 成功上传的图片数
 * @param missingImages  找不到或无法上传的引用，逐条列出
 */
public record ImportResult(long imported, long skipped, List<String> errors, long imagesImported,
        List<MissingImage> missingImages) {
}
