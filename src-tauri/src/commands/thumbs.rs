//! Thumbnail worker endpoints, called by the frontend's ThumbWorker.

use crate::services::thumbs::{self, ThumbJob};
use crate::{AppError, AppResult};
use tauri::ipc::{InvokeBody, Request};

#[tauri::command]
pub fn thumbs_next(lib: String, limit: Option<i64>) -> AppResult<Vec<ThumbJob>> {
    thumbs::next_batch(&lib, limit.unwrap_or(8).clamp(1, 64))
}

#[tauri::command]
pub fn thumbs_remaining(lib: String) -> AppResult<i64> {
    thumbs::remaining(&lib)
}

fn header<'a>(req: &'a Request<'_>, name: &str) -> Option<&'a str> {
    req.headers().get(name).and_then(|v| v.to_str().ok())
}

fn header_i64(req: &Request<'_>, name: &str) -> Option<i64> {
    header(req, name).and_then(|v| v.parse().ok())
}

/// Raw body = the encoded thumbnail; metadata travels in headers so the
/// bytes don't get inflated into a JSON number array.
#[tauri::command]
pub fn thumbs_put(request: Request<'_>) -> AppResult<()> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(AppError::InvalidArg("thumbs_put expects raw bytes".into()));
    };
    let lib = header(&request, "x-lib").ok_or_else(|| AppError::InvalidArg("x-lib".into()))?;
    let media_id = header_i64(&request, "x-media-id").ok_or_else(|| AppError::InvalidArg("x-media-id".into()))?;
    thumbs::put(
        lib,
        thumbs::Put {
            media_id,
            data,
            mime: header(&request, "x-mime").unwrap_or("image/webp"),
            width: header_i64(&request, "x-width").unwrap_or(0),
            height: header_i64(&request, "x-height").unwrap_or(0),
            orig_width: header_i64(&request, "x-orig-width"),
            orig_height: header_i64(&request, "x-orig-height"),
            duration_ms: header_i64(&request, "x-duration-ms"),
        },
    )
}

#[tauri::command]
pub fn thumbs_fail(lib: String, media_id: i64) -> AppResult<()> {
    thumbs::fail(&lib, media_id)
}
