package com.kb.ioport;

import java.util.List;

/**
 * API.md §10.1 / IMPORT-IMAGES.md §6.2 {@code POST /api/import/preview} 响应：只解析、不入库、不上传。
 *
 * @param imagesImported 预览阶段**不会上传**，这里是「将会被导入的图片数量」——
 *                       前端据此告诉用户「将导入 N 张图」；实际入库数见 {@code /api/import/markdown}
 * @param missingImages  如果现在导入，这些引用会缺
 */
public record ImportPreviewResponse(List<ImportPreviewItem> items, long total, List<String> errors,
        long imagesImported, List<MissingImage> missingImages) {
}
