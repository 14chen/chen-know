package com.kb.autotag;

import com.kb.note.NoteService;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 给<b>完全没有标签</b>的笔记自动打标签（保守规则见 {@link AutoTagRules}）。
 *
 * <p>默认关闭（{@code kb.autotag.enabled=false}）：自动打错标签很烦人，先让用户观察再开。
 */
@Service
public class AutoTagService {

    private static final Logger log = LoggerFactory.getLogger(AutoTagService.class);

    private final JdbcTemplate jdbc;
    private final NoteService noteService;
    private final AutoTagProperties properties;

    public AutoTagService(JdbcTemplate jdbc, NoteService noteService, AutoTagProperties properties) {
        this.jdbc = jdbc;
        this.noteService = noteService;
        this.properties = properties;
    }

    public record Result(int scanned, int tagged, List<String> tags) {
    }

    /** @return 扫描/打标统计；关闭时 scanned=0 且不做任何事 */
    public Result run(long spaceId) {
        if (!properties.isEnabled()) {
            log.info("自动标签未启用（kb.autotag.enabled=false），跳过");
            return new Result(0, 0, List.of());
        }
        List<Long> ids = jdbc.queryForList("SELECT n.id FROM notes n WHERE n.space_id = ?"
                + " AND n.deleted_at IS NULL"
                + " AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)",
                Long.class, spaceId);
        List<String> appliedTags = new ArrayList<>();
        int tagged = 0;
        for (Long noteId : ids) {
            String title = jdbc.queryForObject("SELECT title FROM notes WHERE id = ?", String.class, noteId);
            String content = jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);
            List<String> suggested = AutoTagRules.suggest(title, content);
            if (suggested.isEmpty()) {
                continue;
            }
            noteService.setTags(spaceId, noteId, suggested);
            appliedTags.addAll(suggested);
            tagged++;
            log.debug("自动标签: note={} → {}", noteId, suggested);
        }
        log.info("自动标签完成: 扫描 {} 篇（无标签），打标 {} 篇，标签 {}",
                ids.size(), tagged, appliedTags);
        return new Result(ids.size(), tagged, appliedTags);
    }
}
