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
  -- NULL = default (first letter / folder glyph); 'media:<id>' = that media
  -- row's thumbnail; 'blob' = the picture in avatar_data. Anything else is a
  -- file path from before v7, taken in by the WebView on sight (ADR-050).
  avatar_path     TEXT,
  avatar_data     BLOB,
  avatar_mime     TEXT,
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
  kind        TEXT    NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'other')),
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  -- 'broken' = the file is missing although its volume is online. A file on
  -- an offline volume stays 'live': offline is the volume's fact, not ours.
  state       TEXT    NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'broken')),
  lat         REAL,
  lon         REAL,
  -- 1 once the file's own metadata (GPS + capture time) has been read.
  meta_scanned INTEGER NOT NULL DEFAULT 0,
  -- Thumbnail queue: 0 = to do, 1 = done, 2 = gave up (undecodable).
  -- Audio uses it for its waveform (ADR-058).
  thumb_scanned INTEGER NOT NULL DEFAULT 0,
  -- Capture time (ADR-053): UTC ms for ordering, plus the UTC offset in
  -- minutes of the place it was taken, so it shows the clock time there.
  taken_at     INTEGER,
  taken_offset INTEGER,
  -- Audio: loudness bars for the bubble, one byte each (ADR-058).
  peaks        BLOB,
  -- Favorite since (UTC ms); NULL = not a favorite. On the file, not the
  -- message: the same file in two conversations is one favorite (ADR-063).
  favorited_at INTEGER,
  UNIQUE (volume_id, relpath)
);

CREATE INDEX idx_media_blake3 ON media(blake3);
CREATE INDEX idx_media_size ON media(size_bytes);
CREATE INDEX idx_media_geo ON media(lat, lon) WHERE lat IS NOT NULL;
CREATE INDEX idx_media_thumb_todo ON media(id) WHERE thumb_scanned = 0;
CREATE INDEX idx_media_meta_todo ON media(id) WHERE meta_scanned = 0;
CREATE INDEX idx_media_favorite ON media(favorited_at) WHERE favorited_at IS NOT NULL;

-- Tags the user puts on files (ADR-063). A tag lives while some file has it.
CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE TABLE media_tags (
  media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (media_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX idx_media_tags_tag ON media_tags(tag_id);

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

-- Viewing history (ADR-054). A view is one item open in a viewer; its spans
-- are the stretches actually watched. Deleting content keeps the time
-- (SET NULL), so totals stay true.
CREATE TABLE views (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  media_id    INTEGER REFERENCES media(id) ON DELETE SET NULL,
  conv_id     INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('video', 'image', 'audio')),
  -- 'inline': an audio message played in the message list (ADR-058).
  surface     TEXT    NOT NULL CHECK (surface IN ('viewer', 'popup', 'map', 'inline')),
  started_at  INTEGER NOT NULL,
  -- Local UTC offset (minutes) at the time: days and hours are bucketed by
  -- the clock where it was watched.
  tz_offset   INTEGER NOT NULL,
  watch_ms    INTEGER NOT NULL DEFAULT 0,   -- sum of its spans
  covered_ms  INTEGER,                      -- content seen (video.played)
  last_pos_ms INTEGER,
  duration_ms INTEGER,
  counted     INTEGER NOT NULL DEFAULT 0    -- reached "one play"
);

CREATE INDEX idx_views_time ON views(started_at);
CREATE INDEX idx_views_message ON views(message_id);
CREATE INDEX idx_views_media ON views(media_id);
CREATE INDEX idx_views_conv ON views(conv_id);

CREATE TABLE view_spans (
  view_id  INTEGER NOT NULL REFERENCES views(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL,
  end_at   INTEGER NOT NULL,
  PRIMARY KEY (view_id, start_at)
) WITHOUT ROWID;

CREATE INDEX idx_view_spans_time ON view_spans(start_at);

-- Main window in front and in use, per library.
CREATE TABLE presence (
  start_at  INTEGER PRIMARY KEY,
  end_at    INTEGER NOT NULL,
  tz_offset INTEGER NOT NULL
);

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
