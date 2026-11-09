package com.kb.user;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/** {@code spaces}：一个用户一个空间，owner_id 唯一（SCHEMA §1）。 */
@Repository
public class SpaceRepository {

    private static final RowMapper<Long> ID_MAPPER = (rs, rowNum) -> rs.getLong("id");

    private final JdbcTemplate jdbc;

    public SpaceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public long insert(long ownerId, String name, String createdAt) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO spaces (owner_id, name, created_at) VALUES (?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, ownerId);
            ps.setString(2, name);
            ps.setString(3, createdAt);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入空间后未取得主键");
        }
        return key.longValue();
    }

    public Optional<Long> findIdByOwner(long ownerId) {
        List<Long> ids = jdbc.query("SELECT id FROM spaces WHERE owner_id = ?", ID_MAPPER, ownerId);
        return ids.stream().findFirst();
    }
}
