//! Google OAuth 2.0 with PKCE — local loopback flow.
//!
//! Bind a TCP listener on `127.0.0.1:<random>`, build the authorize URL
//! pointing back to that address, open the user's browser via the Tauri
//! shell plugin, accept exactly one HTTP GET, parse `code` + `state` from
//! the query string, and exchange the code for tokens. No HTTP framework
//! — the response is a one-shot canned HTML.

use anyhow::{anyhow, bail, Context, Result};
use oauth2::basic::{BasicClient, BasicTokenResponse};
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointNotSet, EndpointSet,
    PkceCodeChallenge, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::Deserialize;
use std::time::Duration;
use tauri::AppHandle;
#[allow(deprecated)]
use tauri_plugin_shell::{open::Program, ShellExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
const CALLBACK_HTML: &[u8] = b"\
HTTP/1.1 200 OK\r\n\
Content-Type: text/html; charset=utf-8\r\n\
Connection: close\r\n\
\r\n\
<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>Trove \xe7\x99\xbb\xe5\xbd\x95\xe6\x88\x90\xe5\x8a\x9f</title>\
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}\
.card{background:#1a1d24;border:1px solid #2a2f3a;border-radius:12px;padding:32px 40px;text-align:center;}\
h1{margin:0 0 8px;font-size:18px;}p{margin:0;color:#9aa0a8;font-size:13px;}</style></head>\
<body><div class=\"card\"><h1>\xe7\x99\xbb\xe5\xbd\x95\xe6\x88\x90\xe5\x8a\x9f</h1>\
<p>\xe5\x8f\xaf\xe4\xbb\xa5\xe5\x85\xb3\xe9\x97\xad\xe6\xad\xa4\xe7\xaa\x97\xe5\x8f\xa3\xe5\xb9\xb6\xe5\x9b\x9e\xe5\x88\xb0 Trove</p>\
</div></body></html>";
const CALLBACK_ERROR_HTML: &[u8] = b"\
HTTP/1.1 400 Bad Request\r\n\
Content-Type: text/html; charset=utf-8\r\n\
Connection: close\r\n\
\r\n\
<!doctype html><html><body style=\"font-family:system-ui;padding:32px\">\
<h1>\xe7\x99\xbb\xe5\xbd\x95\xe5\xa4\xb1\xe8\xb4\xa5</h1><p>\xe8\xaf\xb7\xe5\x9b\x9e Trove \xe9\x87\x8d\xe8\xaf\x95</p></body></html>";

#[derive(Debug, Clone)]
pub struct LoginTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserInfo {
    pub sub: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub picture: Option<String>,
}

/// Run the full PKCE flow: bind loopback listener, open browser, accept
/// callback, exchange code for tokens. Times out after [CALLBACK_TIMEOUT].
pub async fn run_pkce_flow(
    app: &AppHandle,
    client_id: &str,
    client_secret: &str,
    auth_url: &str,
    token_url: &str,
    scopes: &[&str],
) -> Result<LoginTokens> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("bind loopback listener")?;
    let port = listener.local_addr()?.port();
    let redirect = format!("http://127.0.0.1:{port}");

    let client: BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet> =
        BasicClient::new(ClientId::new(client_id.to_string()))
            .set_client_secret(ClientSecret::new(client_secret.to_string()))
            .set_auth_uri(AuthUrl::new(auth_url.to_string()).context("auth url")?)
            .set_token_uri(TokenUrl::new(token_url.to_string()).context("token url")?)
            .set_redirect_uri(RedirectUrl::new(redirect.clone()).context("redirect url")?);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let mut auth_builder = client.authorize_url(CsrfToken::new_random);
    for s in scopes {
        auth_builder = auth_builder.add_scope(Scope::new(s.to_string()));
    }
    let (auth_url, csrf_token) = auth_builder
        .set_pkce_challenge(pkce_challenge)
        // request offline access so Google issues a refresh_token
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .url();

    // Open the browser via the shell plugin. Failure here means the user
    // doesn't have a default browser configured — surface it as an error.
    // `shell().open()` is deprecated in favor of tauri-plugin-opener; keeping
    // the dependency lean for now — the warning is intentional.
    #[allow(deprecated)]
    app.shell()
        .open(auth_url.to_string(), None::<Program>)
        .map_err(|e| anyhow!("open browser: {e}"))?;

    let (code, state) = timeout(CALLBACK_TIMEOUT, accept_callback(&listener))
        .await
        .map_err(|_| anyhow!("oauth: timeout waiting for callback"))?
        .context("oauth callback")?;

    if state.as_deref() != Some(csrf_token.secret().as_str()) {
        bail!("oauth: state mismatch (possible CSRF)");
    }

    let http = reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("build http client")?;

    let token: BasicTokenResponse = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http)
        .await
        .context("exchange code")?;

    Ok(LoginTokens {
        access_token: token.access_token().secret().clone(),
        refresh_token: token.refresh_token().map(|t| t.secret().clone()),
    })
}

/// Accept exactly one TCP connection, parse `code` + `state` from the GET
/// query string, return them. Replies with a canned HTML "you can close
/// this window" page.
async fn accept_callback(listener: &TcpListener) -> Result<(String, Option<String>)> {
    let (mut sock, _) = listener.accept().await.context("accept callback")?;
    let mut buf = [0u8; 8192];
    let mut total = 0usize;
    // Read until we see end-of-headers or buffer fills — a GET with no body
    // is short, so this loop almost always exits on the first read.
    loop {
        let n = sock.read(&mut buf[total..]).await.context("read request")?;
        if n == 0 {
            break;
        }
        total += n;
        if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") || total == buf.len() {
            break;
        }
    }
    let req = String::from_utf8_lossy(&buf[..total]);
    let target = parse_request_target(&req)
        .ok_or_else(|| anyhow!("malformed http request"))?;
    let (code, state) = parse_callback_query(target);
    let body = if code.is_some() {
        CALLBACK_HTML
    } else {
        CALLBACK_ERROR_HTML
    };
    let _ = sock.write_all(body).await;
    let _ = sock.shutdown().await;
    code.map(|c| (c, state))
        .ok_or_else(|| anyhow!("callback missing `code` parameter"))
}

/// Extract the path+query from `GET /path?... HTTP/1.1`.
fn parse_request_target(req: &str) -> Option<&str> {
    let line = req.lines().next()?;
    let mut parts = line.split_whitespace();
    let _method = parts.next()?;
    parts.next()
}

fn parse_callback_query(target: &str) -> (Option<String>, Option<String>) {
    let query = match target.find('?') {
        Some(i) => &target[i + 1..],
        None => return (None, None),
    };
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let k = kv.next().unwrap_or("");
        let v = kv.next().unwrap_or("");
        let decoded = url_decode(v);
        match k {
            "code" => code = Some(decoded),
            "state" => state = Some(decoded),
            _ => {}
        }
    }
    (code, state)
}

/// Minimal `application/x-www-form-urlencoded` decoder for query values.
fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                if let Ok(byte) =
                    u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
                {
                    out.push(byte as char);
                    i += 3;
                } else {
                    out.push(bytes[i] as char);
                    i += 1;
                }
            }
            b => {
                out.push(b as char);
                i += 1;
            }
        }
    }
    out
}

/// Fetch the OpenID Connect userinfo endpoint with the bearer access_token.
pub async fn fetch_userinfo(userinfo_url: &str, access_token: &str) -> Result<UserInfo> {
    let http = reqwest::Client::new();
    let resp = http
        .get(userinfo_url)
        .bearer_auth(access_token)
        .send()
        .await
        .context("userinfo request")?
        .error_for_status()
        .context("userinfo status")?;
    let info: UserInfo = resp.json().await.context("userinfo body")?;
    Ok(info)
}
