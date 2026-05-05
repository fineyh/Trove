-- Trove SQLite schema v1
-- See plans/1-telegram-trove-... for full design rationale.

BEGIN;

CREATE TABLE volumes (
  id          INTEGER PRIMARY KEY,
  platform_id TEXT    NOT NULL UNIQUE,
  label       TEXT,
  last_mount  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  avatar_path     TEXT,
  kind            TEXT    NOT NULL CHECK (kind IN ('manual', 'folder_watch')),
  source_volume_id INTEGER REFERENCES volumes(id) ON DELETE SET NULL,
  source_relpath  TEXT,
  encrypted       INTEGER NOT NULL DEFAULT 0,
  enc_key_wrapped BLOB,
  enc_kdf_salt    BLOB,
  enc_kdf_mem     INTEGER,
  enc_kdf_iters   INTEGER,
  enc_kdf_par     INTEGER,
  pinned          INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

CREATE TABLE media (
  id          INTEGER PRIMARY KEY,
  volume_id   INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  relpath     TEXT    NOT NULL,
  size_bytes  INTEGER NOT NULL,
  mtime       INTEGER NOT NULL,
  blake3      TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('image', 'video', 'other')),
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  thumb_path  TEXT,
  state       TEXT    NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'broken')),
  UNIQUE (volume_id, relpath)
);

CREATE INDEX idx_media_blake3 ON media(blake3);
CREATE INDEX idx_media_size ON media(size_bytes);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY,
  conv_id    INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  media_id   INTEGER REFERENCES media(id) ON DELETE SET NULL,
  caption    TEXT,
  caption_iv BLOB,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_conv_time ON messages(conv_id, created_at);

-- FTS5 mirror of caption + conversation name for search
CREATE VIRTUAL TABLE messages_fts USING fts5(
  caption,
  content='messages',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, caption) VALUES (new.id, new.caption);
END;
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, caption) VALUES('delete', old.id, old.caption);
END;
CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, caption) VALUES('delete', old.id, old.caption);
  INSERT INTO messages_fts(rowid, caption) VALUES (new.id, new.caption);
END;

CREATE TABLE broken_pointers (
  media_id           INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  detected_at        INTEGER NOT NULL,
  last_known_volume  INTEGER,
  last_known_relpath TEXT
);

CREATE TABLE identity (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  email             TEXT,
  google_sub        TEXT,
  refresh_token_enc BLOB,
  display_name      TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO settings(key, value) VALUES
  ('missing_file_strategy', 'hide'),
  ('app_locked', '0');

COMMIT;
