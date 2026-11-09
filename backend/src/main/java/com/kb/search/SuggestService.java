package com.kb.search;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 搜索联想词：先标签（最多 3 个），再标题（补满 limit）。
 *
 * <p>两条 LIKE 查询走完，只查本空间、排除回收站；{@code q} 为空直接返回空数组（不报错），
 * 超过 50 字先截断（防滥用）。
 */
@Service
public class SuggestService {

    private static final Logger log = LoggerFactory.getLogger(SuggestService.class);

    static final int MAX_QUERY_CHARS = 50;
    static final int MAX_TAG_SUGGESTS = 3;
    static final int DEFAULT_LIMIT = 5;
    static final int MAX_LIMIT = 10;

    private final JdbcTemplate jdbc;

    public SuggestService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<SuggestItem> suggest(long spaceId, String q, int limit) {
        String query = normalize(q);
        if (query.isEmpty()) {
            return List.of();
        }
        int cap = Math.max(1, Math.min(limit <= 0 ? DEFAULT_LIMIT : limit, MAX_LIMIT));
        String pattern = "%" + escapeLike(query) + "%";
        Set<String> seen = new LinkedHashSet<>();
        List<SuggestItem> items = new ArrayList<>(cap);

        List<String> tags = jdbc.queryForList("SELECT name FROM tags WHERE space_id = ?"
                        + " AND name LIKE ? ESCAPE '\\' ORDER BY LENGTH(name), name LIMIT ?",
                String.class, spaceId, pattern, Math.min(MAX_TAG_SUGGESTS, cap));
        for (String tag : tags) {
            if (items.size() >= cap) {
                break;
            }
            if (seen.add(tag.toLowerCase(Locale.ROOT))) {
                items.add(new SuggestItem(tag, "tag"));
            }
        }
        if (items.size() < cap) {
            List<String> titles = jdbc.queryForList("SELECT title FROM notes WHERE space_id = ?"
                            + " AND deleted_at IS NULL AND title LIKE ? ESCAPE '\\'"
                            + " ORDER BY updated_at DESC, id DESC LIMIT ?",
                    String.class, spaceId, pattern, cap);
            for (String title : titles) {
                if (items.size() >= cap) {
                    break;
                }
                if (seen.add(title.toLowerCase(Locale.ROOT))) {
                    items.add(new SuggestItem(title, "title"));
                }
            }
        }
        log.debug("联想词: q={} 返回 {} 条（limit={}）", query, items.size(), cap);
        return List.copyOf(items);
    }

    /** 去空白 + 截断到 50 字（按码点，避免切坏 emoji/汉字）。 */
    static String normalize(String q) {
        String text = q == null ? "" : q.trim();
        if (text.isEmpty()) {
            return "";
        }
        if (text.codePointCount(0, text.length()) <= MAX_QUERY_CHARS) {
            return text;
        }
        return text.substring(0, text.offsetByCodePoints(0, MAX_QUERY_CHARS));
    }

    /** LIKE 里的通配符必须转义，否则用户输入 {@code %} 会变成全表匹配。 */
    static String escapeLike(String text) {
        return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}