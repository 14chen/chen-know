package com.kb.attachment;

import java.util.Locale;
import java.util.Map;

/**
 * API.md §7 安全要求 1 与 3：MIME 白名单，以及**由 MIME 推导**的落盘扩展名。
 *
 * <p>白名单即 {@link #EXTENSION_OF_MIME} 的键集。客户端文件名只用于展示与类型兜底判定，
 * 绝不参与磁盘路径或扩展名决策。
 */
final class AttachmentTypes {

    /** MIME → 落盘扩展名（白名单唯一真源）。 */
    private static final Map<String, String> EXTENSION_OF_MIME = Map.ofEntries(
            Map.entry("image/png", ".png"),
            Map.entry("image/jpeg", ".jpg"),
            Map.entry("image/gif", ".gif"),
            Map.entry("image/webp", ".webp"),
            Map.entry("image/bmp", ".bmp"),
            Map.entry("image/avif", ".avif"),
            Map.entry("image/svg+xml", ".svg"),
            Map.entry("application/pdf", ".pdf"),
            Map.entry("text/plain", ".txt"),
            Map.entry("text/markdown", ".md"),
            Map.entry("application/zip", ".zip"));

    /**
     * 扩展名 → MIME，仅在客户端未声明可用类型时兜底。
     * 例如 {@code curl.exe -F file=@a.png} 送的是 {@code application/octet-stream}。
     */
    private static final Map<String, String> MIME_OF_EXTENSION = Map.ofEntries(
            Map.entry(".png", "image/png"),
            Map.entry(".jpg", "image/jpeg"),
            Map.entry(".jpeg", "image/jpeg"),
            Map.entry(".gif", "image/gif"),
            Map.entry(".webp", "image/webp"),
            Map.entry(".bmp", "image/bmp"),
            Map.entry(".avif", "image/avif"),
            Map.entry(".svg", "image/svg+xml"),
            Map.entry(".pdf", "application/pdf"),
            Map.entry(".txt", "text/plain"),
            Map.entry(".md", "text/markdown"),
            Map.entry(".markdown", "text/markdown"),
            Map.entry(".zip", "application/zip"));

    private AttachmentTypes() {
    }

    /** 去掉 charset 等参数并转小写；{@code null} 返回空串。 */
    static String normalizeContentType(String contentType) {
        if (contentType == null) {
            return "";
        }
        int semicolon = contentType.indexOf(';');
        String base = semicolon < 0 ? contentType : contentType.substring(0, semicolon);
        return base.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * 判定附件的 MIME：客户端声明的类型优先（必须在白名单内），
     * 声明缺失或不可用时按文件名扩展名兜底。
     *
     * @return 白名单内的 MIME；无法判定时返回 {@code null}（调用方应回 415）
     */
    static String resolveMimeType(String declaredContentType, String originalFilename) {
        String declared = normalizeContentType(declaredContentType);
        if (EXTENSION_OF_MIME.containsKey(declared)) {
            return declared;
        }
        String byExtension = MIME_OF_EXTENSION.get(extensionOf(originalFilename));
        return byExtension != null && EXTENSION_OF_MIME.containsKey(byExtension) ? byExtension : null;
    }

    static String extensionOfMime(String mimeType) {
        String extension = EXTENSION_OF_MIME.get(mimeType);
        if (extension == null) {
            throw new IllegalArgumentException("非白名单 MIME: " + mimeType);
        }
        return extension;
    }

    /** SVG 可内嵌脚本，必须强制下载（安全要求 5）；其余白名单类型可 inline。 */
    static boolean isInlineSafe(String mimeType) {
        return !"image/svg+xml".equals(mimeType);
    }

    private static String extensionOf(String filename) {
        if (filename == null) {
            return "";
        }
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) {
            return "";
        }
        return filename.substring(dot).toLowerCase(Locale.ROOT);
    }
}
