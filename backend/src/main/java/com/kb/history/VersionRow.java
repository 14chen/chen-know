package com.kb.history;

/** note_versions 的一行；也用于表示「当前版本」（此时 createdBy 为 null，内容取自 notes）。 */
public record VersionRow(long noteId, int version, String title, String content, String createdAt,
        Long createdBy) {
}
