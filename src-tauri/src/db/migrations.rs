use crate::{AppError, AppResult};
use anyhow::anyhow;
use rusqlite::Connection;

/// 全新建库用的完整 schema。注意它自带一对外层 `BEGIN; ... COMMIT;`
/// （见 [strip_outer_transaction]）。
const SCHEMA_SQL: &str = include_str!("schema.sql");

/// 当前代码能理解的最高 schema 版本。改 `schema.sql` 时必须同时 bump 这个常量
/// 并补一条 `V{N}_TO_V{N+1}`，否则老库升不上来、新库会被下面的守卫拒绝。
const SCHEMA_LATEST: i64 = 5;

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
        return Err(AppError::Other(anyhow!(
            "这个数据库由更新版本的 Trove 创建（数据库 schema 版本 v{version}，\
             当前 Trove 最高支持 v{SCHEMA_LATEST}）。请升级 Trove 后再打开。"
        )));
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
    }

    fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        let mut names = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap());
        names.any(|n| n == column)
    }

    fn has_index(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    /// 一个 v3 库：`media` 还没有 v4 的 lat / lon / geo_scanned。只建
    /// `V3_TO_V4` 碰得到的表就够了。
    fn v3_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE media (
               id         INTEGER PRIMARY KEY,
               relpath    TEXT NOT NULL,
               size_bytes INTEGER NOT NULL
             );
             INSERT INTO media (id, relpath, size_bytes) VALUES (1, 'a.jpg', 10);
             PRAGMA user_version = 3;",
        )
        .unwrap();
        conn
    }

    /// 整个修复的前提：`PRAGMA user_version` 跟随事务回滚 / 提交。
    /// 这是 [step] 文档注释里那个结论的实测来源。
    #[test]
    fn user_version_follows_the_transaction() {
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(user_version(&conn), 0);

        // 回滚：改动丢弃。
        let tx = conn.unchecked_transaction().unwrap();
        tx.execute_batch("PRAGMA user_version = 7;").unwrap();
        assert_eq!(user_version(&tx), 7, "事务内应当读到新值");
        drop(tx); // Transaction 的 Drop 默认回滚
        assert_eq!(user_version(&conn), 0, "回滚后 user_version 必须恢复原值");

        // 提交：改动保留。
        let tx = conn.unchecked_transaction().unwrap();
        tx.execute_batch("PRAGMA user_version = 7;").unwrap();
        tx.commit().unwrap();
        assert_eq!(user_version(&conn), 7);
    }

    /// 一步 migration 中途失败：已经执行的 DDL 和 `user_version` 一起回滚，
    /// 修掉失败原因后重跑能成功。这是老代码会把库永久弄坏的那个场景。
    #[test]
    fn a_failed_step_rolls_back_and_can_be_retried() {
        let conn = v3_db();
        // 占掉 `idx_media_geo` 这个名字，让 V3_TO_V4 的最后一句 CREATE INDEX
        // 失败 —— 此时前面三条 ALTER TABLE 已经执行过了。
        conn.execute_batch("CREATE TABLE idx_media_geo (x);").unwrap();

        let err = run(&conn).unwrap_err();
        assert!(
            err.to_string().contains("idx_media_geo"),
            "期待 CREATE INDEX 撞名失败，实际: {err}"
        );
        assert_eq!(user_version(&conn), 3, "失败后 user_version 必须停在 3");
        assert!(
            !has_column(&conn, "media", "lat"),
            "失败后已执行的 ALTER TABLE 必须一起回滚，否则重跑会 duplicate column"
        );

        // 修掉失败原因，重跑。
        conn.execute_batch("DROP TABLE idx_media_geo;").unwrap();
        run(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_LATEST);
        assert!(has_column(&conn, "media", "lat"));
        assert!(has_column(&conn, "media", "geo_scanned"));
        assert!(has_index(&conn, "idx_media_geo"));
    }

    /// v3 库走完整个阶梯到最新版：v4 的列、索引、版本号都对，原有行不丢。
    #[test]
    fn v3_upgrades_through_the_ladder() {
        let conn = v3_db();
        run(&conn).unwrap();

        assert_eq!(user_version(&conn), SCHEMA_LATEST);
        for col in ["lat", "lon", "geo_scanned"] {
            assert!(has_column(&conn, "media", col), "缺列 {col}");
        }
        assert!(has_index(&conn, "idx_media_geo"));
        let (relpath, geo_scanned): (String, i64) = conn
            .query_row("SELECT relpath, geo_scanned FROM media WHERE id = 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(relpath, "a.jpg");
        assert_eq!(geo_scanned, 0, "新列应当拿到 DEFAULT 0");
    }

    /// 全新建库直接落在最新版本，而且 `schema.sql` 的外层事务剥离没有剥坏
    /// （剥错了的话这里会炸在 "cannot start a transaction within a transaction"
    /// 或者少表上）。
    #[test]
    fn a_fresh_database_lands_on_latest() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();

        assert_eq!(user_version(&conn), SCHEMA_LATEST);
        // v2 / v3 / v4 的列在全新库里也必须在（schema.sql 是最新的全量）。
        assert!(has_column(&conn, "conversations", "enc_kdf_salt"));
        assert!(has_column(&conn, "identity", "picture_url"));
        assert!(has_column(&conn, "media", "lat"));
        assert!(has_index(&conn, "idx_media_geo"));
        // FTS5 虚表和触发器也要建起来。
        let objects: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master
                 WHERE name IN ('messages_fts', 'messages_fts_insert')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(objects, 2, "FTS 虚表 / 触发器应当建好");

        // 幂等：再跑一次不应出错也不应改版本。
        run(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_LATEST);
    }

    /// 已经滞留在 v5 的库（那一版被回退的缩略图功能跑过的库，也就是现实中
    /// 用户机器上的处境）：守卫不再拒绝它，而且**一个字节都不改** —— 认领 v5
    /// 这个取舍的全部意义就在这里。
    #[test]
    fn a_database_already_at_v5_is_left_untouched() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE media (
               id            INTEGER PRIMARY KEY,
               relpath       TEXT NOT NULL,
               size_bytes    INTEGER NOT NULL,
               thumb_path    TEXT,
               thumb_scanned INTEGER NOT NULL DEFAULT 0
             );
             INSERT INTO media (id, relpath, size_bytes, thumb_path, thumb_scanned)
               VALUES (1, 'a.jpg', 10, 'thumbs/aa.jpg', 1),
                      (2, 'b.jpg', 20, NULL, 0);
             PRAGMA user_version = 5;",
        )
        .unwrap();

        run(&conn).unwrap();

        assert_eq!(user_version(&conn), 5);
        assert!(has_column(&conn, "media", "thumb_scanned"));
        // 那批滞留值原样保留 —— 做缩略图的 session 负责重置它们，见 V4_TO_V5
        // 的注释。这里断言的是「迁移没有偷偷动用户数据」。
        let (path, scanned): (Option<String>, i64) = conn
            .query_row(
                "SELECT thumb_path, thumb_scanned FROM media WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(path.as_deref(), Some("thumbs/aa.jpg"));
        assert_eq!(scanned, 1);
    }

    /// v4 库补上 v5 的列。
    #[test]
    fn v4_upgrades_to_v5() {
        let conn = v3_db();
        run(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_LATEST);
        assert!(has_column(&conn, "media", "thumb_scanned"));
        // v4 的那几列也在。
        assert!(has_column(&conn, "media", "lat"));
        assert!(has_index(&conn, "idx_media_geo"));
    }

    /// 比当前代码更新的库：直接拒绝，错误文案告诉用户去升级。
    #[test]
    fn rejects_a_database_from_a_newer_trove() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA user_version = 99;").unwrap();

        let err = run(&conn).unwrap_err().to_string();
        assert!(err.contains("更新版本的 Trove"), "实际文案: {err}");
        assert!(err.contains("请升级 Trove"), "实际文案: {err}");
        assert!(err.contains("v99"), "文案应带上实际版本号: {err}");
        // 守卫必须在任何 DDL 之前生效。
        assert_eq!(user_version(&conn), 99);
        let tables: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tables, 0, "被拒绝的库不应被改动");
    }
}
