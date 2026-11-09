package com.kb.ioport;

import java.util.List;

/** API.md §10.1 预览条目：字段名固定（title / sourceFile / tags / folder / sizeBytes）。 */
public record ImportPreviewItem(String title, String sourceFile, List<String> tags, String folder, long sizeBytes) {
}
