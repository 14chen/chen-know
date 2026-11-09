-- ============================================================================
-- 知识库数据库结构 —— 唯一真源：docs/SCHEMA.md（冻结版 v1）
-- 与契约的唯一差异：全部 DDL 追加 IF NOT EXISTS，使迁移幂等（语义不变）。
-- 由 com.kb.db.SchemaMigrator 在启动时执行，可重复执行。
-- ============================================================================

-- ========== 账号体系 ==========
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,                      -- BCrypt，强度 10
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT    PRIMARY KEY,                      -- 32 位随机十六进制
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT,                                     -- NULL = 永不过期
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at    TEXT
);

-- 一个用户一个空间；为将来「共享空间」预留 owner_id 语义
CREATE TABLE IF NOT EXISTS spaces (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

-- ========== 目录树 ==========
CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id   INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,   -- NULL = 根
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_folders_space ON folders(space_id, parent_id, deleted_at);

-- ========== 笔记 ==========
CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  folder_id   INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title       TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL DEFAULT '',            -- Markdown 原文
  excerpt     TEXT    NOT NULL DEFAULT '',            -- 剥离 Markdown 语法后的纯文本前 200 字
  search_blob TEXT    NOT NULL DEFAULT '',            -- 见 SCHEMA §2，供 FTS5 使用
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_space  ON notes(space_id, deleted_at, is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id, deleted_at);

CREATE TABLE IF NOT EXISTS note_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (note_id, version)
);
CREATE INDEX IF NOT EXISTS idx_versions_note ON note_versions(note_id, version DESC);

-- ========== 标签 ==========
CREATE TABLE IF NOT EXISTS tags (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  color    TEXT    NOT NULL DEFAULT '#6b7280',
  UNIQUE (space_id, name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

-- ========== 双向链接 ==========
-- 出链：从 source 笔记正文解析 [[目标标题]] 得到
CREATE TABLE IF NOT EXISTS links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id       INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_title   TEXT    NOT NULL,                     -- 原文标题，可能尚未创建
  target_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL,
  UNIQUE (source_note_id, target_title)
);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_note_id);
CREATE INDEX IF NOT EXISTS idx_links_title  ON links(space_id, target_title COLLATE NOCASE);

-- ========== 附件 ==========
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  note_id       INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  stored_name   TEXT    NOT NULL UNIQUE,               -- 磁盘相对路径，形如 "7/3f2a....png"
  original_name TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attach_space ON attachments(space_id, created_at DESC);

-- ========== 行为日志（最近浏览 / 统计） ==========
CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  action     TEXT    NOT NULL CHECK (action IN ('view','create','edit','delete','restore','import','export')),
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_user ON activities(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_note ON activities(user_id, note_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ========== 中文全文检索（SCHEMA §2）==========
-- CJK 逐字加空格 + unicode61 + 短语查询；不使用 trigram。
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  search_blob,
  content='notes',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, search_blob) VALUES ('delete', old.id, old.search_blob);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF search_blob ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, search_blob) VALUES ('delete', old.id, old.search_blob);
  INSERT INTO notes_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
END;
