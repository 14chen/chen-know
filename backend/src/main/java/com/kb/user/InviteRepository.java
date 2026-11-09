package com.kb.user;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class InviteRepository {

    private static final String COLUMNS = "code, created_by, created_at, expires_at, used_by, used_at";

    private static final RowMapper<Invite> MAPPER = (rs, rowNum) -> {
        long usedBy = rs.getLong("used_by");
        boolean usedByIsNull = rs.wasNull();
        return new Invite(
                rs.getString("code"),
                rs.getLong("created_by"),
                rs.getString("created_at"),
                rs.getString("expires_at"),
                usedByIsNull ? null : usedBy,
                rs.getString("used_at"));
    };

    private final JdbcTemplate jdbc;

    public InviteRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String code, long createdBy, String createdAt, String expiresAt) {
        jdbc.update("INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
                code, createdBy, createdAt, expiresAt);
    }

    public Optional<Invite> findByCode(String code) {
        List<Invite> rows = jdbc.query("SELECT " + COLUMNS + " FROM invites WHERE code = ?", MAPPER, code);
        return rows.stream().findFirst();
    }

    /** 原子占用：只有仍未被使用时才更新成功。 */
    public int claim(String code, long usedBy, String usedAt) {
        return jdbc.update(
                "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL",
                usedBy, usedAt, code);
    }

    public List<Invite> page(int limit, int offset) {
        return jdbc.query("SELECT " + COLUMNS + " FROM invites ORDER BY created_at DESC, code LIMIT ? OFFSET ?",
                MAPPER, limit, offset);
    }

    public long count() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM invites", Long.class);
        return count == null ? 0 : count;
    }

    public int deleteUnused(String code) {
        return jdbc.update("DELETE FROM invites WHERE code = ? AND used_by IS NULL", code);
    }
}
