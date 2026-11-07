-- Trove library schema (latest; see db/migrations.rs SCHEMA_LATEST).
-- Every library file has exactly this structure (ADR-038). The main library
-- additionally fills `libraries` and holds the app-wide `settings` / `identity`.

BEGIN;

CREATE TABLE volumes (
  id          INTEGER PRIMARY KEY,
  platform_id TEXT    NOT NULL UNIQUE,
  label       TEXT,
  last_mount  TEXT,
  -- Is the volume mounted right now? Runtime fact kept by volume_monitor;
  -- it decides "offline" for every media row on this volume (ADR-035).
  online      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  avatar_path     TEXT,
  kind            TEXT    NOT NULL CHECK (kind IN ('manual', 'folder_watch')),
  source_volume_id INTEGER REFERENCES volumes(id) ON DELETE SET NULL,
  source_relpath  TEXT,
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
  -- 'broken' = the file is missing although its volume is online. A file on
  -- an offline volume stays 'live': offline is the volume's fact, not ours.
  state       TEXT    NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'broken')),
  lat         REAL,
  lon         REAL,
  geo_scanned INTEGER NOT NULL DEFAULT 0,
  -- Thumbnail queue: 0 = to do, 1 = done, 2 = gave up (undecodable).
  thumb_scanned INTEGER NOT NULL DEFAULT 0,
  UNIQUE (volume_id, relpath)
);

CREATE INDEX idx_media_blake3 ON media(blake3);
CREATE INDEX idx_media_size ON media(size_bytes);
CREATE INDEX idx_media_geo ON media(lat, lon) WHERE lat IS NOT NULL;
CREATE INDEX idx_media_thumb_todo ON media(id) WHERE thumb_scanned = 0;

-- Thumbnails are a performance cache living next to their row (ADR-037):
-- same file, same key, same transaction, gone with the media row.
CREATE TABLE thumbs (
  media_id   INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  data       BLOB    NOT NULL,
  mime       TEXT    NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY,
  conv_id    INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  media_id   INTEGER REFERENCES media(id) ON DELETE SET NULL,
  caption    TEXT,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_conv_time ON messages(conv_id, created_at);
CREATE INDEX idx_messages_media ON messages(media_id);

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
  display_name      TEXT,
  picture_url       TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Names and order of all libraries. Only the main library's copy is used;
-- the keyring knows ids, never names.
CREATE TABLE libraries (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  icon       TEXT,
  color      TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT INTO settings(key, value) VALUES
  ('offline_content', 'show');

COMMIT;
