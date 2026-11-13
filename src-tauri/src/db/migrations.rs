use crate::{AppError, AppResult};
use rusqlite::Connection;

/// 全新建库用的完整 schema。注意它自带一对外层 `BEGIN; ... COMMIT;`
/// （见 [strip_outer_transaction]）。
const SCHEMA_SQL: &str = include_str!("schema.sql");

/// 当前代码能理解的最高 schema 版本。改 `schema.sql` 时必须同时 bump 这个常量
/// 并补一条 `V{N}_TO_V{N+1}`，否则老库升不上来、新库会被下面的守卫拒绝。
pub const SCHEMA_LATEST: i64 = 6;

const V1_TO_V2: &str = "
ALTER TABLE conversations ADD COLUMN enc_kdf_salt BLOB;
ALTER TABLE conversations ADD COLUMN enc_kdf_mem INTEGER;
ALTER TABLE conversations ADD COLUMN enc_kdf_iters INTEGER;
ALTER TABLE conversations ADD COLUMN enc_kdf_par INTEGER;
";

const V2_TO_V3: &str = "
ALTER TABLE identity ADD COLUMN picture_url TEXT;
";

const V3_TO_V4: &str = "
ALTER TABLE media ADD COLUMN lat REAL;
ALTER TABLE media ADD COLUMN lon REAL;
ALTER TABLE media ADD COLUMN geo_scanned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_media_geo ON media(lat, lon) WHERE lat IS NOT NULL;
";

/// v5 给 `media` 加「这一行的缩略图试过没有」标志位。
///
/// 这个版本号有一段前史，值得写在这里，因为它解释了为什么代码和用户的库会
/// 一度对不上：2026-11-03 有一版缩略图功能加了这个列并 bump 到 5，随后因
/// 「不想要缩略图明文保存」被回退 —— 但**只回退了代码，没回退数据库**，跑过那
/// 一版的库至今是 `user_version = 5`，带着这个列和一批指向已删除文件的
/// `thumb_path`。老代码的阶梯判断全是 `if version < N`，读到 5 一条都不触发，
/// 所以一直没显形；ADR-031 的向下兼容守卫一加上，它就正确地把那类库判成
/// 「更新版本的 Trove 建的」而拒绝打开。
///
/// 收尾选的是**认领 v5**（而不是清掉列、或者把库改回 4）：缩略图本来就是紧接着
/// 要做的下一件事（会做成加密落盘，见 decisions.md ADR-032 之后的计划），这个
/// 标志位正是那套实现需要的；认领它意味着已经在 v5 的库一个字节都不用动，
/// 也不必让版本号倒退或留空洞。
///
/// ⚠️ **给做缩略图的那个 session**：已经在 v5 的库里，这个列**不是干净的 0** ——
/// 那一版跑过的行是 1，而它们的缩略图文件随 `thumbs/` 一起被清空了，
/// `thumb_path` 也还留着死路径。真正开始做缩略图时，第一步应当是
/// `UPDATE media SET thumb_scanned = 0, thumb_path = NULL`（或在新 schema 版本
/// 里重置），否则那批行会被当成「已经处理过」而永远不生成缩略图。
const V4_TO_V5: &str = "
ALTER TABLE media ADD COLUMN thumb_scanned INTEGER NOT NULL DEFAULT 0;
";

/// 执行一步 migration：该步的 SQL 和对应的 `user_version` bump 在**同一个事务**
/// 里，要么都生效、要么都不生效。
///
/// 为什么这能成立 —— `PRAGMA user_version = N` 是否跟随事务回滚：
///
/// - 结论：**会回滚**。`user_version` 是 database header 偏移 60 的 4 字节字段，
///   写它就是改第 1 页；第 1 页和普通数据页一样走 rollback journal / WAL，
///   因此事务回滚时它恢复原值，事务提交时才落盘。
/// - 验证方式：不靠文档推断，用本文件的单测
///   `user_version_follows_the_transaction` 实测 —— 在事务里设成 7 再回滚，
///   读回来仍是 0；换成提交，读回来是 7。该测试就是这整套修复的前提，
///   如果哪天 SQLite 改了这个行为，它会第一个红。
///
/// 没有这条性质，就会退回到老的坏状态：「列已经 ADD 上了、但 `user_version`
/// 没 bump」→ 下次启动重跑 `ALTER TABLE ... ADD COLUMN` 报 duplicate column
/// → 数据库永久打不开。
/// v6 (2026-11): the library-file era (ADR-035~038).
/// - Session-level encryption is gone (the file itself is encrypted now).
/// - The old thumbnail columns never produced anything usable: `thumb_path`
///   points at files that were rolled back, and `thumb_scanned` is unreliable
///   (see the git history of V4_TO_V5), so the queue starts over.
/// - "Offline" moves from per-media state to the volume (`volumes.online`);
///   `missing_file_strategy` (hide|placeholder) becomes `offline_content`
///   (show|hide), defaulting to show because the meaning changed.
const V5_TO_V6: &str = "
ALTER TABLE conversations DROP COLUMN encrypted;
ALTER TABLE conversations DROP COLUMN enc_key_wrapped;
ALTER TABLE conversations DROP COLUMN enc_kdf_salt;
ALTER TABLE conversations DROP COLUMN enc_kdf_mem;
ALTER TABLE conversations DROP COLUMN enc_kdf_iters;
ALTER TABLE conversations DROP COLUMN enc_kdf_par;
ALTER TABLE messages DROP COLUMN caption_iv;
ALTER TABLE media DROP COLUMN thumb_path;
UPDATE media SET thumb_scanned = 0;
CREATE INDEX idx_media_thumb_todo ON media(id) WHERE thumb_scanned = 0;
CREATE INDEX idx_messages_media ON messages(media_id);
ALTER TABLE volumes ADD COLUMN online INTEGER NOT NULL DEFAULT 0;
CREATE TABLE thumbs (
  media_id   INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  data       BLOB    NOT NULL,
  mime       TEXT    NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE libraries (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  icon       TEXT,
  color      TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
DELETE FROM settings WHERE key IN ('missing_file_strategy', 'app_locked');
INSERT OR REPLACE INTO settings(key, value) VALUES ('offline_content', 'show');
";

fn step(conn: &Connection, to_version: i64, sql: &str) -> rusqlite::Result<()> {
    // `unchecked_transaction` 只要 `&Connection`（我们拿不到 `&mut`）。提前
    // return 时 `Transaction` 的 Drop 默认回滚，所以中途失败不会留下半成品。
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(sql)?;
    tx.execute_batch(&format!("PRAGMA user_version = {to_version};"))?;
    tx.commit()
}

/// 去掉 `schema.sql` 的外层 `BEGIN;` / `COMMIT;`。
///
/// `schema.sql` 自带这对标记是为了能直接 `sqlite3 trove.db < schema.sql` 手工
/// 建库时也保持原子；但我们在 [step] 里自己开事务，而 SQLite 不支持嵌套事务
/// （事务内再 `BEGIN` 会直接报错）。这里按行剥离：只删掉「整行就是 `BEGIN;`
/// 或 `COMMIT;`」的行。FTS 触发器体里的 `... AFTER INSERT ON messages BEGIN`
/// 不带分号、也不独占一行，不会被误删；触发器结尾是 `END;` 而不是 `COMMIT;`。
fn strip_outer_transaction(sql: &str) -> String {
    sql.lines()
        .filter(|line| {
            let t = line.trim();
            !t.eq_ignore_ascii_case("BEGIN;") && !t.eq_ignore_ascii_case("COMMIT;")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 把库升到 `SCHEMA_LATEST`。幂等：已经是最新版就什么都不做。
pub fn run(conn: &Connection) -> AppResult<()> {
    let mut version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    // 向下兼容守卫：这库是更新版本的 Trove 建的（用户装回了旧版本，或者导入了
    // 新版本产出的 .trovebackup）。此时 schema 里可能有我们不认识的约束，继续
    // 当 SCHEMA_LATEST 用会静默写坏数据，所以直接拒绝打开。
    //
    // 放在这一层（而不是 db/mod.rs）的理由：`user_version` 的读取和解释本来就
    // 全在这个文件里，mod.rs 的 `open_*` 已经 `?`-传播 AppResult，不需要改动。
    if version > SCHEMA_LATEST {
        return Err(AppError::Other(
            crate::error::NewerData { what: "库 schema", found: version, supported: SCHEMA_LATEST }.into(),
        ));
    }

    // 全新库：一次性落到最新 schema，建表和 user_version 同一个事务。
    if version == 0 {
        step(conn, SCHEMA_LATEST, &strip_outer_transaction(SCHEMA_SQL))?;
        return Ok(());
    }

    if version < 2 {
        step(conn, 2, V1_TO_V2)?;
        version = 2;
    }
    if version < 3 {
        step(conn, 3, V2_TO_V3)?;
        version = 3;
    }
    if version < 4 {
        step(conn, 4, V3_TO_V4)?;
    }
    if version < 5 {
        step(conn, 5, V4_TO_V5)?;
    }
    if version < 6 {
        step(conn, 6, V5_TO_V6)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The v5 schema exactly as shipped before the library-file era.
    const V5_SCHEMA: &str = include_str!("testdata/schema_v5.sql");

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
    }

    fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
        let mut names = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap());
        names.any(|n| n == column)
    }

    fn has_table(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = ?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    fn v5_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(V5_SCHEMA).unwrap();
        conn.execute_batch(
            "PRAGMA user_version = 5;
             INSERT INTO volumes (id, platform_id, label, last_mount, created_at)
               VALUES (1, 'vol', 'D', 'D:\', 0);
             INSERT INTO conversations (id, name, kind, created_at, updated_at)
               VALUES (1, '旅行', 'manual', 0, 0);
             INSERT INTO media (id, volume_id, relpath, size_bytes, mtime, blake3, kind,
                                thumb_path, thumb_scanned, state)
               VALUES (1, 1, 'a.jpg', 10, 0, 'h', 'image', 'thumbs/x.jpg', 1, 'broken');
             INSERT INTO messages (id, conv_id, media_id, caption, created_at)
               VALUES (1, 1, 1, 'a', 0);
             UPDATE settings SET value = 'hide' WHERE key = 'missing_file_strategy';",
        )
        .unwrap();
        conn
    }

    #[test]
    fn user_version_follows_the_transaction() {
        let conn = Connection::open_in_memory().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        tx.execute_batch("PRAGMA user_version = 7;").unwrap();
        assert_eq!(user_version(&tx), 7, "事务内应当读到新值");
        drop(tx);
        assert_eq!(user_version(&conn), 0, "回滚后 user_version 必须恢复原值");
    }

    #[test]
    fn a_fresh_database_lands_on_latest() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_LATEST);
        assert!(has_table(&conn, "thumbs"));
        assert!(has_table(&conn, "libraries"));
        assert!(has_column(&conn, "volumes", "online"));
        assert!(!has_column(&conn, "conversations", "encrypted"));
        run(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_LATEST);
    }

    #[test]
    fn v5_upgrades_to_v6_and_keeps_the_data() {
        let conn = v5_db();
        run(&conn).unwrap();
        assert_eq!(user_version(&conn), 6);
        for (t, c) in [
            ("conversations", "encrypted"),
            ("conversations", "enc_key_wrapped"),
            ("messages", "caption_iv"),
            ("media", "thumb_path"),
        ] {
            assert!(!has_column(&conn, t, c), "{t}.{c} 应当已删除");
        }
        let (name, caption, scanned): (String, String, i64) = conn
            .query_row(
                "SELECT c.name, m.caption, md.thumb_scanned FROM messages m
                 JOIN conversations c ON c.id = m.conv_id JOIN media md ON md.id = m.media_id",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((name.as_str(), caption.as_str(), scanned), ("旅行", "a", 0));
        let offline: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'offline_content'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(offline, "show");
        let old: i64 = conn
            .query_row("SELECT count(*) FROM settings WHERE key = 'missing_file_strategy'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(old, 0);
    }

    #[test]
    fn a_failed_step_rolls_back_and_can_be_retried() {
        let conn = v5_db();
        conn.execute_batch("CREATE TABLE thumbs (x);").unwrap();
        assert!(run(&conn).is_err());
        assert_eq!(user_version(&conn), 5, "失败后 user_version 必须停在 5");
        assert!(has_column(&conn, "conversations", "encrypted"), "DROP COLUMN 必须一起回滚");

        conn.execute_batch("DROP TABLE thumbs;").unwrap();
        run(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_LATEST);
    }

    #[test]
    fn a_newer_database_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_LATEST + 1)).unwrap();
        assert!(run(&conn).is_err());
    }
}
