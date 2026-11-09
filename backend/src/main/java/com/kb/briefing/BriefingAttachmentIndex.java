package com.kb.briefing;

import java.util.Collection;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 简报里用到的附件索引：按 sha256 复用已有附件、以及把附件回填到生成的简报笔记上。
 *
 * <p>只做两件事（读写 attachments 表的 id/sha256/note_id 三个与简报相关的列），
 * 上传本体仍然走 {@code AttachmentService}。
 */
@Repository
public class BriefingAttachmentIndex {

    private final JdbcTemplate jdbc;

    public BriefingAttachmentIndex(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 同一空间里已经存过同样字节的附件 → 直接复用，不再上传（避免同一张图存多份）。 */
    public Optional<Long> findBySha256(long spaceId, String sha256) {
        if (sha256 == null || sha256.isBlank()) {
            return Optional.empty();
        }
        return jdbc.query("SELECT id FROM attachments WHERE space_id = ? AND sha256 = ?"
                        + " ORDER BY id LIMIT 1",
                (rs, rowNum) -> rs.getLong("id"), spaceId, sha256).stream().findFirst();
    }

    /** 把本轮上传的附件挂到生成的简报笔记上（note_id 为 NULL 的才回填，不动别处的附件）。 */
    public int backfillNoteId(long spaceId, long noteId, Collection<Long> attachmentIds) {
        if (attachmentIds == null || attachmentIds.isEmpty()) {
            return 0;
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(attachmentIds.size(), "?"));
        Object[] args = new Object[attachmentIds.size() + 2];
        args[0] = noteId;
        args[1] = spaceId;
        int index = 2;
        for (Long id : attachmentIds) {
            args[index++] = id;
        }
        return jdbc.update("UPDATE attachments SET note_id = ? WHERE space_id = ? AND note_id IS NULL"
                + " AND id IN (" + placeholders + ")", args);
    }
}
