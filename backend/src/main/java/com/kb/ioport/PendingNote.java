package com.kb.ioport;

import java.util.List;

/** 解析结果（尚未入库）。{@code sourceFile} 为来源文件名或 ZIP 内相对路径。 */
record PendingNote(String title, String sourceFile, List<String> tags, String folderPath, String content,
        long sizeBytes) {
}
