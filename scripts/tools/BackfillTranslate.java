
import com.kb.briefing.BriefingText;
import com.kb.briefing.JdkHttpTransport;
import com.kb.briefing.MyMemoryTranslationClient;
import com.kb.briefing.TranslationClient;
import com.kb.common.SearchText;
import com.kb.common.Times;
import com.kb.note.Excerpt;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** 把已有的《AI 简报》笔记里仍是英文的标题与摘要补翻成中文（默认 dry-run，只写文件不改库）。 */
public class BackfillTranslate {

    record Item(int titleLine, String title, int summaryLine, String summary) {
    }

    public static void main(String[] args) throws Exception {
        String dbPath = args[0];
        long noteId = Long.parseLong(args[1]);
        boolean apply = args.length > 2 && args[2].equals("--apply");
        String outPath = args.length > 3 ? args[3] : null;

        String content;
        String title;
        int version;
        long userId;
        try (Connection c = open(dbPath)) {
            try (PreparedStatement ps = c.prepareStatement("SELECT title, content, version FROM notes WHERE id = ? AND deleted_at IS NULL")) {
                ps.setLong(1, noteId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) throw new IllegalStateException("笔记不存在: " + noteId);
                    title = rs.getString(1);
                    content = rs.getString(2);
                    version = rs.getInt(3);
                }
            }
            userId = ownerOf(c, noteId);
            try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT DISTINCT action FROM activities")) {
                StringBuilder b = new StringBuilder();
                while (rs.next()) b.append(rs.getString(1)).append(' ');
                System.out.println("activities actions = " + b);
            }
        }
        System.out.println("note " + noteId + " version=" + version + " chars=" + content.length() + " owner=" + userId);

        String[] lines = content.split("\n", -1);
        List<Item> items = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (!line.startsWith("#### ")) continue;
            String itemTitle = line.substring(5).replaceFirst("^\\d+\\.\\s*", "");
            int j = i + 1;
            int metaAt = -1;
            if (j < lines.length && lines[j].startsWith("> ")) { metaAt = j; j++; }
            int summaryAt = -1;
            for (int k = Math.max(j, i + 1); k < lines.length && !lines[k].startsWith("#"); k++) {
                String t = lines[k].trim();
                if (k == metaAt) continue;
                if (t.equals("---") || t.equals("***") || t.equals("___")) break;
                if (t.isEmpty() || t.startsWith("链接：") || t.startsWith("原题：") || t.startsWith("![")) continue;
                summaryAt = k;
                break;
            }
            items.add(new Item(i, itemTitle, summaryAt, summaryAt >= 0 ? lines[summaryAt].trim() : ""));
        }
        System.out.println("items = " + items.size());

        Map<String, String[]> manualZh = loadManual(Path.of("F:/devbox/study-net/.evidence/manual-zh.tsv"));
        Path cachePath = Path.of("F:/devbox/study-net/.evidence/backfill-cache.tsv");
        Map<String, String> cache = loadCache(cachePath);
        TranslationClient delegate = new MyMemoryTranslationClient(new JdkHttpTransport());
        TranslationClient client = new TranslationClient() {
            @Override
            public String providerName() {
                return delegate.providerName();
            }

            @Override
            public String translate(String text) {
                String key = key(text);
                String hit = cache.get(key);
                if (hit != null) return hit;
                String zh = delegate.translate(text);
                cache.put(key, zh);
                appendCache(cachePath, key, zh);
                return zh;
            }
        };
        Map<Integer, String[]> translated = new ConcurrentHashMap<>();   // itemIndex -> [titleZh, summaryZh]
        AtomicInteger failed = new AtomicInteger();
        int idx = 0;
        for (Item item : items) {
            int captured = idx++;
            String s = item.summary();
            boolean titleNeeds = !item.title().isBlank() && !BriefingText.looksChinese(item.title());
            boolean summaryNeeds = !s.isBlank() && !BriefingText.looksChinese(s);
            if (!titleNeeds && !summaryNeeds) continue;
            String[] manual = manualZh.get(item.title().trim());
            String manualTitle = manual != null && !manual[0].isBlank() ? manual[0] : null;
            String manualSummary = manual != null && manual.length > 1 && !manual[1].isBlank() ? manual[1] : null;
            boolean needTitle = titleNeeds && manualTitle == null;
            boolean needSummary = summaryNeeds && manualSummary == null;
            if (!needTitle && !needSummary) {
                translated.put(captured, new String[]{titleNeeds ? manualTitle : null, summaryNeeds ? manualSummary : null});
                System.out.println("  hand " + (captured + 1) + "/" + items.size() + " " + item.title());
                continue;
            }
            String titleText = stripTrailingEllipsis(item.title());
            String summaryText = stripTrailingEllipsis(s);
            List<String> texts = new ArrayList<>(2);
            if (needTitle) texts.add(titleText);
            if (needSummary) texts.add(summaryText);
            try {
                List<String> out = client.translateAll(texts);
                if (out == null || out.size() != texts.size()) throw new IllegalStateException("条数不符");
                int cursor = 0;
                String tZh = needTitle ? out.get(cursor++) : manualTitle;
                String sZh = needSummary ? out.get(cursor++) : manualSummary;
                if ((titleNeeds && isBlank(tZh)) || (summaryNeeds && isBlank(sZh))) throw new IllegalStateException("空译文");
                translated.put(captured, new String[]{tZh, sZh});
                System.out.println("  ok  " + (captured + 1) + "/" + items.size() + " " + item.title());
            } catch (RuntimeException e) {
                failed.incrementAndGet();
                System.out.println("  FAIL " + (captured + 1) + "/" + items.size() + " " + item.title() + " -> " + e.getMessage());
            }
        }
        System.out.println("translated=" + translated.size() + " failed=" + failed.get() + " untouched=" + (items.size() - translated.size() - failed.get()));

        if (translated.isEmpty()) {
            System.out.println("nothing to write");
            return;
        }

        List<String> out = new ArrayList<>(Arrays.asList(lines));
        // 从后往前改，避免下标位移
        List<Map.Entry<Integer, String[]>> ordered = new ArrayList<>(translated.entrySet());
        ordered.sort(Comparator.comparingInt((Map.Entry<Integer, String[]> e) -> e.getKey()).reversed());
        for (Map.Entry<Integer, String[]> e : ordered) {
            Item item = items.get(e.getKey());
            String[] zh = e.getValue();
            String originalTitle = item.title();
            String newTitle = zh[0] != null ? zh[0] : stripTrailingEllipsis(originalTitle);
            out.set(item.titleLine(), "#### " + (item.titleLine() >= 0 ? headingNumber(lines[item.titleLine()]) : "") + newTitle);
            if (zh[1] != null && item.summaryLine() >= 0) {
                String suffix = item.summary().endsWith("…") ? "…" : "";
                out.set(item.summaryLine(), zh[1] + suffix);
            }
            if (zh[0] != null) {
                int insertAt = item.titleLine() + 1;
                int linkAt = -1;
                for (int k = item.titleLine() + 1; k < out.size() && !out.get(k).startsWith("#### "); k++) {
                    if (out.get(k).startsWith("链接：")) { linkAt = k; break; }
                }
                if (linkAt >= 0) insertAt = linkAt;
                else {
                    int last = item.summaryLine() >= 0 ? item.summaryLine() : item.titleLine() + 1;
                    insertAt = last + 1;
                }
                out.add(insertAt, "原题：" + originalTitle);
                if (insertAt <= item.summaryLine()) {
                    throw new IllegalStateException("insert-at " + insertAt + " <= summary " + item.summaryLine()
                            + " (titleLine=" + item.titleLine() + ", summary=" + item.summary() + ")");
                }
            }
        }
        String merged = String.join("\n", out);
        System.out.println("new chars=" + merged.length() + " delta=" + (merged.length() - content.length()));

        if (outPath != null) {
            Files.write(Path.of(outPath), merged.getBytes(StandardCharsets.UTF_8));
            System.out.println("dry-run output -> " + outPath);
        }
        if (!apply) {
            System.out.println("dry-run: 未写库（加 --apply 才写）");
            return;
        }
        try (Connection c = open(dbPath)) {
            c.setAutoCommit(false);
            String now = Times.now();
            try (PreparedStatement ins = c.prepareStatement("INSERT INTO note_versions (note_id, version, title, content, created_at, created_by) VALUES (?,?,?,?,?,?)")) {
                ins.setLong(1, noteId); ins.setInt(2, version); ins.setString(3, title); ins.setString(4, content);
                ins.setString(5, now); ins.setLong(6, userId);
                ins.executeUpdate();
            }
            try (PreparedStatement upd = c.prepareStatement("UPDATE notes SET content = ?, excerpt = ?, search_blob = ?, version = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")) {
                upd.setString(1, merged);
                upd.setString(2, Excerpt.of(merged));
                upd.setString(3, SearchText.normalize(Excerpt.stripTags(title + " " + merged)));
                upd.setInt(4, version + 1);
                upd.setString(5, now);
                upd.setLong(6, noteId);
                int n = upd.executeUpdate();
                if (n != 1) throw new IllegalStateException("UPDATE 影响行数 " + n);
            }
            try (PreparedStatement act = c.prepareStatement("INSERT INTO activities (user_id, note_id, action, created_at) VALUES (?,?,?,?)")) {
                act.setLong(1, userId); act.setLong(2, noteId); act.setString(3, "edit"); act.setString(4, now);
                act.executeUpdate();
            }
            c.commit();
            System.out.println("applied: version " + version + " -> " + (version + 1) + " at " + now);
        }
    }

    private static Map<String, String[]> loadManual(Path path) {
        Map<String, String[]> out = new HashMap<>();
        if (!Files.exists(path)) return out;
        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                if (line.isBlank()) continue;
                String[] parts = line.split("\t", -1);
                if (parts.length < 2) continue;
                out.put(parts[0].trim(), new String[]{parts[1].trim(), parts.length > 2 ? parts[2].trim() : ""});
            }
        } catch (Exception e) {
            System.out.println("manual table load failed: " + e);
        }
        return out;
    }

    private static String key(String text) {
        return Integer.toHexString(text.hashCode()) + "-" + text.length();
    }

    private static Map<String, String> loadCache(Path path) {
        Map<String, String> out = new HashMap<>();
        if (!Files.exists(path)) return out;
        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                int tab = line.indexOf('	');
                if (tab <= 0) continue;
                out.put(line.substring(0, tab), new String(Base64.getDecoder().decode(line.substring(tab + 1)), StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            System.out.println("cache load failed: " + e);
        }
        return out;
    }

    private static synchronized void appendCache(Path path, String key, String value) {
        try {
            String tab = Character.toString((char) 9);
            String lf = System.lineSeparator();
            Files.writeString(path, key + tab + Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)) + lf,
                    StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (Exception e) {
            System.out.println("cache write failed: " + e);
        }
    }

    private static String headingNumber(String line) {
        String rest = line.substring(5);
        int dot = rest.indexOf('.');
        return dot > 0 ? rest.substring(0, dot + 1) + " " : "";
    }

    private static String stripTrailingEllipsis(String text) {
        String t = text == null ? "" : text.trim();
        while (t.endsWith("…") || t.endsWith("...")) t = t.substring(0, t.length() - 1).trim();
        return t;
    }

    private static boolean isBlank(String t) {
        return t == null || t.isBlank();
    }

    private static Connection open(String dbPath) throws SQLException {
        Connection c = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
        try (Statement s = c.createStatement()) {
            s.execute("PRAGMA busy_timeout = 8000");
        }
        return c;
    }

    private static long ownerOf(Connection c, long noteId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT space_id FROM notes WHERE id = ?")) {
            ps.setLong(1, noteId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new IllegalStateException("笔记不存在");
                long spaceId = rs.getLong(1);
                try (PreparedStatement m = c.prepareStatement("SELECT owner_id FROM spaces WHERE id = ?")) {
                    m.setLong(1, spaceId);
                    try (ResultSet r2 = m.executeQuery()) {
                        if (r2.next()) {
                            long owner = r2.getLong(1);
                            if (!r2.wasNull() && owner > 0) return owner;
                        }
                    }
                } catch (SQLException ignored) {
                    // 老库没有 owner_id 列，回落到最早的用户
                }
            }
        }
        try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT id FROM users ORDER BY id LIMIT 1")) {
            return rs.next() ? rs.getLong(1) : 1L;
        }
    }
}
