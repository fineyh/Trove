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
    crypto::{self, IDENTITY_REFRESH_AAD},
    oauth, vault,
};
use crate::{db, AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;

// Google Desktop OAuth client (project: trove-497317)
const GOOGLE_CLIENT_ID: &str =
    "535478304031-l1sf933j99g8rqp27agsc42lut40rv5s.apps.googleusercontent.com";
// Google's "Desktop client secret" is treated as public information per
// https://developers.google.com/identity/protocols/oauth2/native-app —
// it's sent in the token-exchange POST for API compatibility, not as
// a confidentiality boundary.
const GOOGLE_CLIENT_SECRET: &str = "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";
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPES: &[&str] = &["openid", "email", "profile"];

// Storage marker bytes: 0x01 = sealed (AES-GCM via master KEK), 0x00 = plaintext.
const STORAGE_VERSION_SEALED: u8 = 0x01;
const STORAGE_VERSION_PLAIN: u8 = 0x00;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub has_identity: bool,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub picture_url: Option<String>,
    /// Mirrors `vault::is_unlocked()` — frontend uses it to enable/disable buttons.
    pub vault_unlocked: bool,
}

#[tauri::command]
pub fn auth_status() -> AppResult<AuthStatus> {
    let vault_unlocked = vault::is_unlocked();
    if !vault_unlocked {
        return Ok(AuthStatus {
            has_identity: false,
            email: None,
            display_name: None,
            picture_url: None,
            vault_unlocked,
        });
    }
    db::with_conn(|conn| {
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
    if !vault::is_unlocked() {
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

    db::with_conn(|conn| {
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
    if !vault::is_unlocked() {
        return Err(AppError::InvalidArg("vault is locked".into()));
    }
    db::with_conn(|conn| {
        conn.execute("DELETE FROM identity WHERE id = 1", [])?;
        Ok(())
    })
}

fn encode_refresh_token(rt: &str) -> AppResult<Vec<u8>> {
    if let Some(kek) = vault::master_kek() {
        let sealed = crypto::seal_blob(&kek, rt.as_bytes(), IDENTITY_REFRESH_AAD)
            .map_err(AppError::from)?;
        let mut out = Vec::with_capacity(1 + sealed.len());
        out.push(STORAGE_VERSION_SEALED);
        out.extend_from_slice(&sealed);
        Ok(out)
    } else {
        let mut out = Vec::with_capacity(1 + rt.len());
        out.push(STORAGE_VERSION_PLAIN);
        out.extend_from_slice(rt.as_bytes());
        Ok(out)
    }
}

#[allow(dead_code)]
pub fn decode_refresh_token(blob: &[u8]) -> AppResult<String> {
    let (&tag, rest) = blob
        .split_first()
        .ok_or_else(|| AppError::InvalidArg("empty refresh blob".into()))?;
    let bytes = match tag {
        STORAGE_VERSION_SEALED => {
            let kek = vault::master_kek().ok_or_else(|| {
                AppError::InvalidArg("vault is locked — cannot decrypt refresh token".into())
            })?;
            crypto::open_blob(&kek, rest, IDENTITY_REFRESH_AAD).map_err(AppError::from)?
        }
        STORAGE_VERSION_PLAIN => rest.to_vec(),
        _ => return Err(AppError::InvalidArg(format!("unknown refresh blob tag: {tag:#x}"))),
    };
    String::from_utf8(bytes).map_err(|e| AppError::InvalidArg(format!("refresh utf8: {e}")))
}
