//! Google PKCE login + identity table read/write.
//!
//! `identity` is a single-row table (CHECK id = 1). The refresh_token is
//! stored as a BLOB:
//!   - When a master password is set (vault unlocked), the BLOB is sealed
//!     with the master KEK (AES-GCM, AAD = "trove:identity:refresh:v1").
//!   - When no master password is set, the BLOB is the raw bytes — the
//!     whole DB is plaintext anyway, so layering another wrap would be
//!     misleading security theater.
//!
//! `is_encrypted_blob()` distinguishes the two by looking at length: a
//! sealed blob is at least NONCE_LEN + tag = 28 bytes longer than the
//! plaintext, and we tag with a 1-byte version prefix to be unambiguous.

use crate::services::{
    oauth, session,
};
use crate::{db, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;

// Google Desktop OAuth client (project: trove-497317).
//
// Injected at compile time from src-tauri/.env (gitignored) via build.rs.
// Google's "Desktop client secret" is treated as public information per
// https://developers.google.com/identity/protocols/oauth2/native-app — it is
// sent in the token-exchange POST for API compatibility, not as a
// confidentiality boundary (PKCE is). It necessarily ships inside the binary;
// we keep it out of tracked source only so secret scanners / scrapers can't
// harvest a live value from the public repo.
const GOOGLE_CLIENT_ID: &str = env!(
    "GOOGLE_OAUTH_CLIENT_ID",
    "missing GOOGLE_OAUTH_CLIENT_ID — copy src-tauri/.env.example to src-tauri/.env and fill it in"
);
const GOOGLE_CLIENT_SECRET: &str = env!(
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "missing GOOGLE_OAUTH_CLIENT_SECRET — copy src-tauri/.env.example to src-tauri/.env and fill it in"
);
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPES: &[&str] = &["openid", "email", "profile"];

// Storage marker bytes: 0x01 = sealed (AES-GCM via master KEK), 0x00 = plaintext.
const STORAGE_VERSION_PLAIN: u8 = 0x00;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub has_identity: bool,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub picture_url: Option<String>,
    /// Mirrors `session::is_app_unlocked()` — frontend uses it to enable/disable buttons.
    pub vault_unlocked: bool,
}

#[tauri::command]
pub fn auth_status() -> AppResult<AuthStatus> {
    let vault_unlocked = session::is_app_unlocked();
    if !vault_unlocked {
        return Ok(AuthStatus {
            has_identity: false,
            email: None,
            display_name: None,
            picture_url: None,
            vault_unlocked,
        });
    }
    db::with_main(|conn| {
        let row = conn
            .query_row(
                "SELECT email, display_name, picture_url FROM identity WHERE id = 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        Ok(match row {
            Some((email, display_name, picture_url)) => AuthStatus {
                has_identity: true,
                email,
                display_name,
                picture_url,
                vault_unlocked,
            },
            None => AuthStatus {
                has_identity: false,
                email: None,
                display_name: None,
                picture_url: None,
                vault_unlocked,
            },
        })
    })
}

#[tauri::command]
pub async fn google_login(app: AppHandle) -> AppResult<AuthStatus> {
    if !session::is_app_unlocked() {
        return Err(AppError::InvalidArg(
            "vault is locked — unlock the master password before logging in".into(),
        ));
    }

    let tokens = oauth::run_pkce_flow(
        &app,
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_AUTH_URL,
        GOOGLE_TOKEN_URL,
        SCOPES,
    )
    .await
    .map_err(|e| AppError::InvalidArg(format!("oauth: {e}")))?;

    let userinfo = oauth::fetch_userinfo(GOOGLE_USERINFO_URL, &tokens.access_token)
        .await
        .map_err(|e| AppError::InvalidArg(format!("userinfo: {e}")))?;

    let refresh_blob = match tokens.refresh_token.as_deref() {
        Some(rt) => Some(encode_refresh_token(rt)?),
        None => None,
    };

    db::with_main(|conn| {
        // Need to keep an existing refresh_token if Google didn't return a new one
        // (only the first authorization returns one unless prompt=consent forced it,
        // which we do — but be defensive).
        let preserved: Option<Vec<u8>> = if refresh_blob.is_none() {
            conn.query_row(
                "SELECT refresh_token_enc FROM identity WHERE id = 1",
                [],
                |r| r.get::<_, Option<Vec<u8>>>(0),
            )
            .optional()?
            .flatten()
        } else {
            None
        };
        conn.execute(
            "INSERT INTO identity(id, email, google_sub, refresh_token_enc, display_name, picture_url)
             VALUES (1, ?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                google_sub = excluded.google_sub,
                refresh_token_enc = COALESCE(excluded.refresh_token_enc, identity.refresh_token_enc),
                display_name = excluded.display_name,
                picture_url = excluded.picture_url",
            params![
                userinfo.email,
                userinfo.sub,
                refresh_blob.or(preserved),
                userinfo.name,
                userinfo.picture,
            ],
        )?;
        Ok(())
    })?;

    auth_status()
}

#[tauri::command]
pub fn logout() -> AppResult<()> {
    if !session::is_app_unlocked() {
        return Err(AppError::InvalidArg("vault is locked".into()));
    }
    db::with_main(|conn| {
        conn.execute("DELETE FROM identity WHERE id = 1", [])?;
        Ok(())
    })
}

/// The main library file is encrypted (ADR-036), so the token is stored as-is;
/// the old per-field seal with the master KEK is gone with the master KEK.
fn encode_refresh_token(rt: &str) -> AppResult<Vec<u8>> {
    let mut out = Vec::with_capacity(1 + rt.len());
    out.push(STORAGE_VERSION_PLAIN);
    out.extend_from_slice(rt.as_bytes());
    Ok(out)
}

#[allow(dead_code)]
pub fn decode_refresh_token(blob: &[u8]) -> AppResult<String> {
    let (&tag, rest) = blob
        .split_first()
        .ok_or_else(|| AppError::InvalidArg("empty refresh blob".into()))?;
    if tag != STORAGE_VERSION_PLAIN {
        return Err(AppError::InvalidArg("refresh token from the master-password era; log in again".into()));
    }
    String::from_utf8(rest.to_vec()).map_err(|e| AppError::InvalidArg(format!("refresh utf8: {e}")))
}
