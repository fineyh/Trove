//! Viewing history (ADR-054). Called by every viewer, the popup windows too.

use crate::services::{stats, stats_report};
use crate::{db, events, AppError, AppResult};

/// Start a view. `None` when nothing is recorded (switched off, or not an
/// image / video).
#[tauri::command]
pub fn stats_view_begin(
    lib: String,
    message_id: i64,
    surface: String,
    started_at: i64,
    tz_offset: i64,
) -> AppResult<Option<i64>> {
    if !db::with_main(|c| stats::enabled(c))? {
        return Ok(None);
    }
    db::with_lib(&lib, |c| stats::begin(c, message_id, &surface, started_at, tz_offset))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn stats_view_tick(
    lib: String,
    view_id: i64,
    span_start: Option<i64>,
    span_end: Option<i64>,
    covered_ms: Option<i64>,
    last_pos_ms: Option<i64>,
    duration_ms: Option<i64>,
) -> AppResult<()> {
    let t = stats::Tick {
        span: span_start.zip(span_end),
        covered_ms,
        last_pos_ms,
        duration_ms,
    };
    let played = db::with_lib(&lib, |c| stats::tick(c, view_id, t, stats::now_ms()))?;
    if let Some(p) = played {
        events::emit_played(&lib, p.message_id, p.play_count);
    }
    Ok(())
}

#[tauri::command]
pub fn stats_presence_tick(lib: String, start_at: i64, end_at: i64, tz_offset: i64) -> AppResult<()> {
    if !db::with_main(|c| stats::enabled(c))? {
        return Ok(());
    }
    db::with_lib(&lib, |c| stats::presence(c, start_at, end_at, tz_offset, stats::now_ms()))
}

#[tauri::command]
pub fn stats_clear(lib: String) -> AppResult<()> {
    db::with_lib(&lib, stats::clear)
}

/// The statistics page (ADR-056). `edges`: bucket boundaries as wall-clock
/// ms; `utc_edges`: the same instants in real time.
#[tauri::command]
pub fn stats_overview(lib: String, edges: Vec<i64>, utc_edges: Vec<i64>) -> AppResult<stats_report::Overview> {
    if edges.len() < 2 || edges.len() != utc_edges.len() || edges.len() > 400 {
        return Err(AppError::InvalidArg("bad bucket edges".into()));
    }
    let hide = super::conversations::hide_offline(&lib)?;
    db::with_lib(&lib, |c| stats_report::overview(c, &edges, &utc_edges, hide))
}

/// One item's views (message right-click → 观看记录).
#[tauri::command]
pub fn stats_item_history(lib: String, message_id: i64) -> AppResult<stats_report::ItemHistory> {
    db::with_lib(&lib, |c| stats_report::item_history(c, message_id))
}
