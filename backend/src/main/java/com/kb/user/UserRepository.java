package com.kb.user;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

    private static final String COLUMNS =
            "id, username, display_name, password_hash, role, disabled, created_at";

    private static final RowMapper<UserAccount> MAPPER = (rs, rowNum) -> new UserAccount(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("display_name"),
            rs.getString("password_hash"),
            rs.getString("role"),
            rs.getInt("disabled") != 0,
            rs.getString("created_at"));

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public UserRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    public Optional<UserAccount> findByUsername(String username) {
        List<UserAccount> rows = jdbc.query("SELECT " + COLUMNS + " FROM users WHERE username = ? COLLATE NOCASE",
                MAPPER, username);
        return rows.stream().findFirst();
    }

    public Optional<UserAccount> findById(long id) {
        List<UserAccount> rows = jdbc.query("SELECT " + COLUMNS + " FROM users WHERE id = ?", MAPPER, id);
        return rows.stream().findFirst();
    }

    public boolean existsByUsername(String username) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE username = ? COLLATE NOCASE",
                Integer.class, username);
        return count != null && count > 0;
    }

    public long count() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM users", Long.class);
        return count == null ? 0 : count;
    }

    public long countOtherEnabledAdmins(long excludedUserId) {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?",
                Long.class, excludedUserId);
        return count == null ? 0 : count;
    }

    /** 管理页列表：连带 space_id 一次查完，避免 N+1。 */
    public List<AdminUserResponse> pageAdmin(int limit, int offset) {
        return jdbc.query("""
                SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at, s.id AS space_id
                FROM users u
                LEFT JOIN spaces s ON s.owner_id = u.id
                ORDER BY u.id
                LIMIT ? OFFSET ?
                """, (rs, rowNum) -> {
            long spaceId = rs.getLong("space_id");
            boolean spaceIdIsNull = rs.wasNull();
            return new AdminUserResponse(
                    rs.getLong("id"),
                    rs.getString("username"),
                    rs.getString("display_name"),
                    rs.getString("role"),
                    rs.getInt("disabled") != 0,
                    rs.getString("created_at"),
                    spaceIdIsNull ? null : spaceId);
        }, limit, offset);
    }

    public long insert(String username, String displayName, String passwordHash, String role, String createdAt) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO users (username, display_name, password_hash, role, disabled, created_at)"
                            + " VALUES (?, ?, ?, ?, 0, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, username);
            ps.setString(2, displayName);
            ps.setString(3, passwordHash);
            ps.setString(4, role);
            ps.setString(5, createdAt);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入用户后未取得主键");
        }
        return key.longValue();
    }

    /** 只更新非 null 字段；列名全部来自白名单，值走绑定参数。 */
    public int update(long id, String displayName, String passwordHash, String role, Boolean disabled) {
        List<String> assignments = new ArrayList<>();
        MapSqlParameterSource params = new MapSqlParameterSource("id", id);
        if (displayName != null) {
            assignments.add("display_name = :displayName");
            params.addValue("displayName", displayName);
        }
        if (passwordHash != null) {
            assignments.add("password_hash = :passwordHash");
            params.addValue("passwordHash", passwordHash);
        }
        if (role != null) {
            assignments.add("role = :role");
            params.addValue("role", role);
        }
        if (disabled != null) {
            assignments.add("disabled = :disabled");
            params.addValue("disabled", disabled ? 1 : 0);
        }
        if (assignments.isEmpty()) {
            return 0;
        }
        return namedJdbc.update("UPDATE users SET " + String.join(", ", assignments) + " WHERE id = :id", params);
    }

    public int deleteById(long id) {
        return jdbc.update("DELETE FROM users WHERE id = ?", id);
    }
}
