package com.kb.ioport;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * 文件名清洗与 {@code Content-Disposition} 构造（API.md §10：导出路径不得因标题里的
 * {@code / \ : * ? " < > |} 变成非法 ZIP 路径；中文名用 RFC 5987 编码）。
 */
public final class FileNames {

    /** Windows/macOS 均不可作为文件名的字符 + 控制字符。 */
    private static final String ILLEGAL_CHARS = "[\\\\/:*?\"<>|\\p{Cntrl}]";

    private static final int MAX_NAME_LENGTH = 80;
    private static final String FALLBACK_NAME = "untitled";

    private FileNames() {
    }

    /** 单个路径段（文件名或目录名）清洗：非法字符替换为下划线，去掉首尾空白与结尾点。 */
    public static String sanitizeSegment(String raw) {
        String name = raw == null ? "" : raw;
        name = name.replaceAll(ILLEGAL_CHARS, "_").strip();
        name = name.replaceAll("\\s+", " ");
        while (name.endsWith(".") || name.endsWith(" ")) {
            name = name.substring(0, name.length() - 1);
        }
        if (name.length() > MAX_NAME_LENGTH) {
            name = name.substring(0, MAX_NAME_LENGTH).strip();
        }
        if (name.isEmpty() || ".".equals(name) || "..".equals(name)) {
            return FALLBACK_NAME;
        }
        return name;
    }

    /** 导出文件主名：清洗后为空则用 {@code note-<id>} 兜底。 */
    public static String sanitizeFileName(String rawTitle, long noteId) {
        String name = sanitizeSegment(rawTitle);
        return FALLBACK_NAME.equals(name) ? "note-" + noteId : name;
    }

    /**
     * 附件在 ZIP 里的条目名（IMPORT-IMAGES.md §7）：{@code attachments/{id}-{原名}}。
     * 正文里重写出来的相对路径必须与它逐字一致，否则导出包解压后引用指不到文件。
     *
     * <p>额外把 {@code #} 与 {@code %} 换成下划线：这两个字符在 Markdown 目标里会被当作
     * fragment / 百分号编码，导入回来时一定对不上；其余字符保持原样，方便人眼阅读。
     */
    public static String attachmentEntryName(long id, String originalName) {
        return "attachments/" + id + "-" + sanitizeSegment(originalName).replace('#', '_').replace('%', '_');
    }

    /**
     * 把条目名变成 Markdown 目标：含空格 / 括号等 markdown 目标里的敏感字符时用 {@code <...>} 包裹
     * （CommonMark 允许尖括号内出现空格，且引用的就是原样的文件名）。
     *
     * <p>刻意**不做**百分号编码：ZIP 解压出来的文件名必须与目标逐字相同，
     * Typora / VS Code 才会在磁盘上找到它；编码过的目标在这些工具里反而会找不到文件。
     */
    public static String markdownDestination(String entryName) {
        return needsAngleBrackets(entryName) ? "<" + entryName + ">" : entryName;
    }

    /**
     * Markdown 的图片路径是**相对该 .md 所在目录**解析的（IMPORT-IMAGES.md §7 裁定）：
     * {@code notes/技术/x.md} 要引用包根的 {@code attachments/1-a.png}，路径必须写成
     * {@code ../../attachments/1-a.png}，否则 Typora 会去 {@code notes/技术/attachments/} 里找。
     *
     * @param mdPath    文档在导出包内的相对路径（单篇导出时就是文件名本身 → 无前缀）
     * @param entryPath 附件的包内条目名，如 {@code attachments/1-a.png}
     */
    public static String relativeToMd(String mdPath, String entryPath) {
        String dir = dirname(mdPath);
        int depth = 0;
        for (String segment : dir.split("/")) {
            if (!segment.isEmpty()) {
                depth++;
            }
        }
        return "../".repeat(depth) + entryPath;
    }

    /** 同 {@link #relativeToMd}，并按需加 {@code <...>} 包裹。 */
    public static String markdownReference(String mdPath, String entryPath) {
        String relative = relativeToMd(mdPath, entryPath);
        return needsAngleBrackets(relative) ? "<" + relative + ">" : relative;
    }

    private static String dirname(String path) {
        String text = path == null ? "" : path;
        int slash = text.lastIndexOf('/');
        return slash < 0 ? "" : text.substring(0, slash);
    }

    private static boolean needsAngleBrackets(String path) {
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c <= 0x20 || "()<>\"'`".indexOf(c) >= 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * 同名去重：已占用时在扩展名前追加 {@code (2)}、{@code (3)}……
     * {@code used} 存小写路径（Windows 解压不区分大小写）。
     */
    public static String uniqueEntryPath(java.util.Set<String> used, String desiredPath) {
        if (used.add(desiredPath.toLowerCase(Locale.ROOT))) {
            return desiredPath;
        }
        int dot = desiredPath.lastIndexOf('.');
        String base = dot < 0 ? desiredPath : desiredPath.substring(0, dot);
        String extension = dot < 0 ? "" : desiredPath.substring(dot);
        for (int index = 2; index < 10_000; index++) {
            String candidate = base + " (" + index + ")" + extension;
            if (used.add(candidate.toLowerCase(Locale.ROOT))) {
                return candidate;
            }
        }
        throw new IllegalStateException("无法为 " + desiredPath + " 生成唯一路径");
    }

    /** {@code Content-Disposition: attachment}，同时给出 ASCII 兜底名与 RFC 5987 编码名。 */
    public static String attachmentDisposition(String fileName) {
        return "attachment; filename=\"" + asciiFallback(fileName) + "\"; filename*=UTF-8''" + rfc5987(fileName);
    }

    /** 头部 ASCII 兜底名：非 ASCII、引号、反斜杠、百分号、控制字符一律替换，避免头部注入。 */
    public static String asciiFallback(String name) {
        StringBuilder out = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            out.append(c > 0x20 && c < 0x7F && c != '"' && c != '\\' && c != '%' ? c : '_');
        }
        String fallback = out.toString().strip();
        return fallback.isEmpty() ? "download" : fallback;
    }

    /** RFC 5987 百分号编码（UTF-8 字节逐个编码，中文名不乱码）。 */
    public static String rfc5987(String name) {
        StringBuilder out = new StringBuilder(name.length() * 3);
        for (byte b : name.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xFF;
            boolean attrChar = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || "!#$&+-.^_`|~".indexOf(c) >= 0;
            if (attrChar) {
                out.append((char) c);
            } else {
                out.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
                        .append(Character.toUpperCase(Character.forDigit(c & 0xF, 16)));
            }
        }
        return out.toString();
    }
}
