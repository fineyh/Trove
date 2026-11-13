//! The `trove://` protocol: how media reaches the WebView (ADR-037).
//!
//! URLs carry ids only — `/<lib>/thumb/<media_id>`, `/<lib>/media/<media_id>`,
//! `/<lib>/avatar/<conv_id>` — never a path, so nothing about where files
//! live ends up in the DOM, the WebView's history or its cache. A locked
//! library answers 423, and every response says `no-store`.
//!
//! This replaces the `asset://` protocol with its `scope: ["**"]`, which let
//! the WebView read any file on disk by absolute path.

use crate::db;
use crate::services::thumbs;
use rusqlite::OptionalExtension;
use std::io::{Read, Seek, SeekFrom};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::UriSchemeResponder;

/// Largest slice served for one ranged request; players ask for more.
const RANGE_CHUNK: u64 = 4 * 1024 * 1024;
/// Files above this are only ever served in ranges.
const WHOLE_FILE_MAX: u64 = 64 * 1024 * 1024;

type Resp = Response<Vec<u8>>;

/// Requests are served by a fixed set of workers (R4.10). A grid of
/// thumbnails used to start one thread per image, with no upper bound.
const WORKERS: usize = 8;

type Job = (Request<Vec<u8>>, UriSchemeResponder);

/// Queue a request for the worker pool. Every request gets a response:
/// a panic in a handler becomes a 500 instead of a request that never ends.
pub fn dispatch(req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    static POOL: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
    let tx = POOL.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..WORKERS {
            let rx = rx.clone();
            std::thread::Builder::new()
                .name(format!("trove-protocol-{i}"))
                .spawn(move || worker(rx))
                .expect("spawn protocol worker");
        }
        Mutex::new(tx)
    });
    let _ = tx.lock().unwrap_or_else(|e| e.into_inner()).send((req, responder));
}

fn worker(rx: Arc<Mutex<Receiver<Job>>>) {
    loop {
        let job = rx.lock().unwrap_or_else(|e| e.into_inner()).recv();
        let Ok((req, responder)) = job else { return };
        let resp = catch_unwind(AssertUnwindSafe(|| handle(req)))
            .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR));
        responder.respond(resp);
    }
}

fn status(code: StatusCode) -> Resp {
    base(Response::builder().status(code)).body(Vec::new()).unwrap()
}

fn base(b: tauri::http::response::Builder) -> tauri::http::response::Builder {
    b.header(header::CACHE_CONTROL, "no-store")
        // The page (tauri.localhost) and this scheme are different origins;
        // `fetch` and `<canvas>` (thumbnail generation) need CORS to read.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("X-Content-Type-Options", "nosniff")
}

pub fn handle(req: Request<Vec<u8>>) -> Resp {
    let path = req.uri().path().trim_start_matches('/').to_string();
    let parts: Vec<&str> = path.split('/').collect();
    let [lib, kind, id] = parts.as_slice() else {
        return status(StatusCode::NOT_FOUND);
    };
    let Ok(id) = id.parse::<i64>() else {
        return status(StatusCode::BAD_REQUEST);
    };
    if !db::is_open(lib) {
        return status(StatusCode::LOCKED);
    }
    match *kind {
        "thumb" => thumb(lib, id),
        "media" => media(lib, id, &req),
        "avatar" => avatar(lib, id, &req),
        _ => status(StatusCode::NOT_FOUND),
    }
}

fn thumb(lib: &str, media_id: i64) -> Resp {
    match thumbs::get(lib, media_id) {
        Ok(Some((data, mime))) => base(Response::builder())
            .header(header::CONTENT_TYPE, mime)
            .body(data)
            .unwrap(),
        Ok(None) => status(StatusCode::NOT_FOUND),
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

fn media_file(lib: &str, media_id: i64) -> Option<PathBuf> {
    db::with_lib(lib, |c| crate::commands::messages::media_abs_path(c, media_id))
        .ok()
        .flatten()
}

fn media(lib: &str, media_id: i64, req: &Request<Vec<u8>>) -> Resp {
    match media_file(lib, media_id) {
        Some(p) => serve_file(&p, req),
        None => status(StatusCode::NOT_FOUND),
    }
}

/// A conversation's avatar: either a media row (`media:<id>`, served as its
/// thumbnail) or a file the user picked.
fn avatar(lib: &str, conv_id: i64, req: &Request<Vec<u8>>) -> Resp {
    let v: Option<String> = db::with_lib(lib, |c| {
        Ok(c.query_row("SELECT avatar_path FROM conversations WHERE id = ?1", [conv_id], |r| {
            r.get::<_, Option<String>>(0)
        })
        .optional()?
        .flatten())
    })
    .ok()
    .flatten();
    match v {
        Some(s) if s.starts_with("media:") => match s[6..].parse::<i64>() {
            Ok(mid) => match thumbs::get(lib, mid) {
                Ok(Some(_)) => thumb(lib, mid),
                _ => media(lib, mid, req),
            },
            Err(_) => status(StatusCode::NOT_FOUND),
        },
        Some(p) => serve_file(&PathBuf::from(p), req),
        None => status(StatusCode::NOT_FOUND),
    }
}

fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    // An empty file has no byte to point at: every range is unsatisfiable.
    if len == 0 {
        return None;
    }
    let spec = h.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len.saturating_sub(1))
    } else {
        let s: u64 = a.parse().ok()?;
        let e = if b.is_empty() { len.saturating_sub(1) } else { b.parse::<u64>().ok()?.min(len - 1) };
        (s, e)
    };
    (start <= end && start < len).then_some((start, end))
}

fn serve_file(path: &std::path::Path, req: &Request<Vec<u8>>) -> Resp {
    let Ok(mut f) = std::fs::File::open(path) else {
        return status(StatusCode::NOT_FOUND);
    };
    let Ok(len) = f.metadata().map(|m| m.len()) else {
        return status(StatusCode::NOT_FOUND);
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|h| parse_range(h, len));

    let (start, end, partial) = match range {
        Some(Some((s, e))) => (s, e.min(s + RANGE_CHUNK - 1), true),
        Some(None) => {
            return base(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE))
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new())
                .unwrap()
        }
        None if len > WHOLE_FILE_MAX => (0, RANGE_CHUNK.min(len).saturating_sub(1), true),
        None => (0, len.saturating_sub(1), false),
    };
    let n = if len == 0 { 0 } else { end - start + 1 };
    let mut buf = vec![0u8; n as usize];
    if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let mut b = base(Response::builder())
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, n.to_string());
    if partial {
        b = b
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    b.body(buf).unwrap()
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }

    #[test]
    fn empty_file() {
        assert_eq!(parse_range("bytes=0-5", 0), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
        assert_eq!(parse_range("bytes=-10", 0), None);
    }
}
