//! The keyring: which keys open which library (ADR-036).
//!
//! Every library file is a SQLCipher database keyed by its own random 32-byte
//! data key (DEK). The DEK never sits on disk in the clear; the keyring holds
//! it wrapped by one or more *slots*, and any one slot opens the library:
//!
//! - `app`      — wrapped by the application key (AK). Normal libraries.
//! - `password` — wrapped by Argon2id(password). Encrypted libraries, and the
//!                AK itself when a startup password is set.
//! - `recovery` — wrapped by a key derived from a high-entropy recovery code.
//! - `keyfile`  — wrapped by a key derived from a small random file the user
//!                keeps somewhere (e.g. inside a Cryptomator vault).
//!
//! The AK is stored in the clear when there is no startup password: the
//! library files are then still ciphertext, so syncing, indexing or opening
//! them in a SQLite tool gets nothing, but someone with the whole data
//! directory and knowledge of this format can open them. The UI calls that
//! "不公开", never "安全".
//!
//! Changing a password only rewrites a few dozen bytes here; the library file
//! is untouched. Every wrap is AES-256-GCM with an AAD binding the owner, the
//! slot type and (for passwords) the KDF parameters, so a slot can't be moved
//! to another library or downgraded to cheaper KDF settings.

use crate::services::crypto::{self, KdfParams, SecretKey, KEY_LEN, SALT_LEN};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

pub const FILE_NAME: &str = "keyring.json";
const VERSION: u32 = 1;
/// Owner tag for the application key's own slots.
const APP_OWNER: &str = "app";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyring {
    pub version: u32,
    /// Id of the main library. Opaque, like every other id in here; names
    /// live inside the (encrypted) main library.
    pub main: String,
    pub app: AppKey,
    pub libraries: Vec<LibraryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum AppKey {
    /// No startup password: the AK is stored as-is.
    Open { key: String },
    /// Startup password set: the AK is only reachable through a slot.
    Sealed { slots: Vec<Slot> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub id: String,
    pub slots: Vec<Slot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Slot {
    App {
        wrapped: String,
    },
    Password {
        salt: String,
        mem_kib: u32,
        iters: u32,
        par: u32,
        wrapped: String,
    },
    Recovery {
        wrapped: String,
    },
    Keyfile {
        /// Where the key file was put, as (volume platform id, path relative
        /// to that volume) — survives drive-letter changes — plus the last
        /// absolute path it was seen at, as a fallback.
        volume: String,
        relpath: String,
        last_path: String,
        wrapped: String,
    },
}

impl Slot {
    pub fn kind(&self) -> SlotKind {
        match self {
            Slot::App { .. } => SlotKind::App,
            Slot::Password { .. } => SlotKind::Password,
            Slot::Recovery { .. } => SlotKind::Recovery,
            Slot::Keyfile { .. } => SlotKind::Keyfile,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotKind {
    App,
    Password,
    Recovery,
    Keyfile,
}

impl SlotKind {
    fn tag(self) -> &'static str {
        match self {
            SlotKind::App => "app",
            SlotKind::Password => "password",
            SlotKind::Recovery => "recovery",
            SlotKind::Keyfile => "keyfile",
        }
    }
}

/// What the user typed (or which file appeared) to open something.
pub enum Secret<'a> {
    Password(&'a str),
    Recovery(&'a str),
    Keyfile(&'a [u8]),
}

// ─── wrapping ───────────────────────────────────────────────────────────────

fn aad(owner: &str, kind: SlotKind, extra: &str) -> Vec<u8> {
    format!("trove:keyring:v1|{owner}|{}|{extra}", kind.tag()).into_bytes()
}

fn password_extra(salt: &str, p: KdfParams) -> String {
    format!("argon2id m={} t={} p={} s={salt}", p.mem_kib, p.iters, p.parallelism)
}

fn wrap(kek: &SecretKey, key: &SecretKey, aad: &[u8]) -> Result<String> {
    Ok(B64.encode(crypto::wrap_key(kek, key, aad)?))
}

fn unwrap(kek: &SecretKey, wrapped: &str, aad: &[u8]) -> Result<SecretKey> {
    let blob = B64.decode(wrapped).context("decode wrapped key")?;
    crypto::unwrap_key(kek, &blob, aad)
}

/// Recovery codes and key files are already high-entropy, so a fast KDF is
/// enough; Argon2 there would only slow the user down.
fn fast_kek(context: &str, material: &[u8]) -> SecretKey {
    SecretKey(blake3::derive_key(context, material))
}
const RECOVERY_CONTEXT: &str = "trove 2026-11 recovery code v1";
const KEYFILE_CONTEXT: &str = "trove 2026-11 key file v1";

pub fn password_slot(owner: &str, password: &str, key: &SecretKey) -> Result<Slot> {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let params = KdfParams::default();
    let salt_b64 = B64.encode(salt);
    let kek = crypto::derive_key(password, &salt, params)?;
    let wrapped = wrap(
        &kek,
        key,
        &aad(owner, SlotKind::Password, &password_extra(&salt_b64, params)),
    )?;
    Ok(Slot::Password {
        salt: salt_b64,
        mem_kib: params.mem_kib,
        iters: params.iters,
        par: params.parallelism,
        wrapped,
    })
}

/// Returns the slot and the code to show the user (once).
pub fn recovery_slot(owner: &str, key: &SecretKey) -> Result<(Slot, String)> {
    let mut raw = Zeroizing::new([0u8; RECOVERY_BYTES]);
    OsRng.fill_bytes(raw.as_mut());
    let kek = fast_kek(RECOVERY_CONTEXT, raw.as_ref());
    let wrapped = wrap(&kek, key, &aad(owner, SlotKind::Recovery, ""))?;
    Ok((Slot::Recovery { wrapped }, format_recovery(raw.as_ref())))
}

pub fn app_slot(owner: &str, ak: &SecretKey, key: &SecretKey) -> Result<Slot> {
    Ok(Slot::App {
        wrapped: wrap(ak, key, &aad(owner, SlotKind::App, ""))?,
    })
}

pub fn keyfile_slot(
    owner: &str,
    file_bytes: &[u8],
    key: &SecretKey,
    volume: String,
    relpath: String,
    last_path: String,
) -> Result<Slot> {
    let kek = fast_kek(KEYFILE_CONTEXT, file_bytes);
    Ok(Slot::Keyfile {
        volume,
        relpath,
        last_path,
        wrapped: wrap(&kek, key, &aad(owner, SlotKind::Keyfile, ""))?,
    })
}

/// Try `secret` against every matching slot of `owner`. `ak` is needed for
/// `app` slots and may be `None` when the caller only holds a user secret.
fn open_slots(owner: &str, slots: &[Slot], secret: &Secret, ak: Option<&SecretKey>) -> Result<SecretKey> {
    let mut tried = false;
    for slot in slots {
        let got = match (slot, secret) {
            (
                Slot::Password { salt, mem_kib, iters, par, wrapped },
                Secret::Password(pw),
            ) => {
                tried = true;
                let salt_bytes = B64.decode(salt).context("decode salt")?;
                let params = KdfParams { mem_kib: *mem_kib, iters: *iters, parallelism: *par };
                let kek = crypto::derive_key(pw, &salt_bytes, params)?;
                unwrap(&kek, wrapped, &aad(owner, SlotKind::Password, &password_extra(salt, params)))
            }
            (Slot::Recovery { wrapped }, Secret::Recovery(code)) => {
                tried = true;
                let raw = parse_recovery(code)?;
                let kek = fast_kek(RECOVERY_CONTEXT, raw.as_ref());
                unwrap(&kek, wrapped, &aad(owner, SlotKind::Recovery, ""))
            }
            (Slot::Keyfile { wrapped, .. }, Secret::Keyfile(bytes)) => {
                tried = true;
                let kek = fast_kek(KEYFILE_CONTEXT, bytes);
                unwrap(&kek, wrapped, &aad(owner, SlotKind::Keyfile, ""))
            }
            _ => continue,
        };
        if let Ok(k) = got {
            return Ok(k);
        }
    }
    let _ = ak;
    if !tried {
        bail!(WrongSecret::NoSuchSlot);
    }
    bail!(WrongSecret::Mismatch);
}

/// Marker error so commands can tell "wrong password" apart from I/O trouble.
#[derive(Debug, thiserror::Error)]
pub enum WrongSecret {
    #[error("密码或恢复密钥不正确")]
    Mismatch,
    #[error("这个库没有这种解锁方式")]
    NoSuchSlot,
}

// ─── recovery code text form ───────────────────────────────────────────────

/// 160 bits: plenty against guessing, still only 32 characters to copy down.
const RECOVERY_BYTES: usize = 20;
/// Crockford base32: no I, L, O, U, so a hand-copied code can't be misread.
const B32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn format_recovery(raw: &[u8]) -> String {
    let mut bits: u64 = 0;
    let mut nbits = 0;
    let mut chars = Vec::with_capacity(32);
    for &b in raw {
        bits = (bits << 8) | b as u64;
        nbits += 8;
        while nbits >= 5 {
            nbits -= 5;
            chars.push(B32[((bits >> nbits) & 31) as usize]);
        }
    }
    chars
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

fn parse_recovery(code: &str) -> Result<Zeroizing<[u8; RECOVERY_BYTES]>> {
    let mut out = Zeroizing::new([0u8; RECOVERY_BYTES]);
    let mut bits: u64 = 0;
    let mut nbits = 0;
    let mut n = 0;
    for ch in code.chars() {
        let c = match ch.to_ascii_uppercase() {
            '-' | ' ' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        let v = B32
            .iter()
            .position(|&x| x as char == c)
            .ok_or_else(|| anyhow!(WrongSecret::Mismatch))?;
        bits = (bits << 5) | v as u64;
        nbits += 5;
        if nbits >= 8 {
            nbits -= 8;
            if n >= RECOVERY_BYTES {
                bail!(WrongSecret::Mismatch);
            }
            out[n] = ((bits >> nbits) & 0xff) as u8;
            n += 1;
        }
    }
    if n != RECOVERY_BYTES {
        bail!(WrongSecret::Mismatch);
    }
    Ok(out)
}

// ─── the keyring itself ────────────────────────────────────────────────────

pub fn random_id() -> String {
    let mut b = [0u8; 8];
    OsRng.fill_bytes(&mut b);
    hex::encode(b)
}

pub fn new_key_file_bytes() -> Vec<u8> {
    let mut b = vec![0u8; KEY_LEN];
    OsRng.fill_bytes(&mut b);
    b
}

impl Keyring {
    /// A brand-new keyring with an open AK and one main library.
    /// Returns the keyring, the AK and the main library's DEK.
    pub fn fresh() -> Result<(Self, SecretKey, SecretKey)> {
        let ak = SecretKey::random();
        let dek = SecretKey::random();
        let main = random_id();
        let kr = Keyring {
            version: VERSION,
            main: main.clone(),
            app: AppKey::Open { key: B64.encode(ak.as_bytes()) },
            libraries: vec![LibraryEntry {
                id: main.clone(),
                slots: vec![app_slot(&main, &ak, &dek)?],
            }],
        };
        Ok((kr, ak, dek))
    }

    pub fn path(data_dir: &Path) -> PathBuf {
        data_dir.join(FILE_NAME)
    }

    pub fn load(data_dir: &Path) -> Result<Option<Self>> {
        let p = Self::path(data_dir);
        if !p.is_file() {
            return Ok(None);
        }
        let raw = std::fs::read(&p).context("read keyring")?;
        let kr: Keyring = serde_json::from_slice(&raw).context("parse keyring")?;
        if kr.version != VERSION {
            bail!("keyring 版本 v{} 不受支持，请升级 Trove", kr.version);
        }
        Ok(Some(kr))
    }

    /// Write-then-rename so a crash never leaves a half-written keyring —
    /// losing it would lose every library.
    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let p = Self::path(data_dir);
        let tmp = p.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, &p)?;
        Ok(())
    }

    pub fn has_app_password(&self) -> bool {
        matches!(self.app, AppKey::Sealed { .. })
    }

    pub fn app_has_recovery(&self) -> bool {
        match &self.app {
            AppKey::Sealed { slots } => slots.iter().any(|s| s.kind() == SlotKind::Recovery),
            AppKey::Open { .. } => false,
        }
    }

    /// The AK when no startup password is set.
    pub fn open_app_key(&self) -> Option<SecretKey> {
        match &self.app {
            AppKey::Open { key } => {
                let raw = B64.decode(key).ok()?;
                (raw.len() == KEY_LEN).then(|| {
                    let mut k = [0u8; KEY_LEN];
                    k.copy_from_slice(&raw);
                    SecretKey(k)
                })
            }
            AppKey::Sealed { .. } => None,
        }
    }

    pub fn unlock_app(&self, secret: &Secret) -> Result<SecretKey> {
        match &self.app {
            AppKey::Open { .. } => self.open_app_key().ok_or_else(|| anyhow!("bad app key")),
            AppKey::Sealed { slots } => open_slots(APP_OWNER, slots, secret, None),
        }
    }

    /// Turn on the startup password. Returns the recovery code.
    pub fn seal_app(&mut self, ak: &SecretKey, password: &str) -> Result<String> {
        let pw = password_slot(APP_OWNER, password, ak)?;
        let (rec, code) = recovery_slot(APP_OWNER, ak)?;
        self.app = AppKey::Sealed { slots: vec![pw, rec] };
        Ok(code)
    }

    /// For a backup copy of the keyring: password only, no recovery code
    /// (nobody would ever see it).
    pub fn seal_app_without_recovery(&mut self, ak: &SecretKey, password: &str) -> Result<()> {
        self.app = AppKey::Sealed { slots: vec![password_slot(APP_OWNER, password, ak)?] };
        Ok(())
    }

    pub fn change_app_password(&mut self, ak: &SecretKey, password: &str) -> Result<()> {
        let AppKey::Sealed { slots } = &mut self.app else {
            bail!("没有设置启动密码");
        };
        slots.retain(|s| s.kind() != SlotKind::Password);
        slots.insert(0, password_slot(APP_OWNER, password, ak)?);
        Ok(())
    }

    pub fn reset_app_recovery(&mut self, ak: &SecretKey) -> Result<String> {
        let AppKey::Sealed { slots } = &mut self.app else {
            bail!("没有设置启动密码");
        };
        slots.retain(|s| s.kind() != SlotKind::Recovery);
        let (rec, code) = recovery_slot(APP_OWNER, ak)?;
        slots.push(rec);
        Ok(code)
    }

    pub fn unseal_app(&mut self, ak: &SecretKey) {
        self.app = AppKey::Open { key: B64.encode(ak.as_bytes()) };
    }

    pub fn library(&self, id: &str) -> Option<&LibraryEntry> {
        self.libraries.iter().find(|l| l.id == id)
    }

    pub fn library_mut(&mut self, id: &str) -> Result<&mut LibraryEntry> {
        self.libraries
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or_else(|| anyhow!("unknown library {id}"))
    }

    /// Libraries that open together with the app.
    pub fn app_libraries(&self) -> Vec<String> {
        self.libraries
            .iter()
            .filter(|l| l.is_normal())
            .map(|l| l.id.clone())
            .collect()
    }

    pub fn unwrap_with_app(&self, id: &str, ak: &SecretKey) -> Result<SecretKey> {
        let lib = self.library(id).ok_or_else(|| anyhow!("unknown library {id}"))?;
        for s in &lib.slots {
            if let Slot::App { wrapped } = s {
                return unwrap(ak, wrapped, &aad(id, SlotKind::App, ""));
            }
        }
        bail!(WrongSecret::NoSuchSlot)
    }

    pub fn unwrap_with(&self, id: &str, secret: &Secret) -> Result<SecretKey> {
        let lib = self.library(id).ok_or_else(|| anyhow!("unknown library {id}"))?;
        open_slots(id, &lib.slots, secret, None)
    }
}

impl LibraryEntry {
    /// "Normal" = opens with the app (has an `app` slot).
    pub fn is_normal(&self) -> bool {
        self.slots.iter().any(|s| s.kind() == SlotKind::App)
    }
    pub fn has(&self, kind: SlotKind) -> bool {
        self.slots.iter().any(|s| s.kind() == kind)
    }
    pub fn keyfile(&self) -> Option<(&str, &str, &str)> {
        self.slots.iter().find_map(|s| match s {
            Slot::Keyfile { volume, relpath, last_path, .. } => {
                Some((volume.as_str(), relpath.as_str(), last_path.as_str()))
            }
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_code_round_trips_and_forgives_typos() {
        let raw = [7u8; RECOVERY_BYTES];
        let code = format_recovery(&raw);
        assert_eq!(code.len(), 32 + 7, "8 groups of 4 with dashes: {code}");
        let back = parse_recovery(&code.to_lowercase().replace('0', "o")).unwrap();
        assert_eq!(back.as_ref(), &raw);
        assert!(parse_recovery("ABCD").is_err());
    }

    #[test]
    fn app_key_open_then_sealed() {
        let (mut kr, ak, dek) = Keyring::fresh().unwrap();
        let main = kr.main.clone();
        assert_eq!(kr.open_app_key().unwrap().0, ak.0);
        assert_eq!(kr.unwrap_with_app(&main, &ak).unwrap().0, dek.0);

        let code = kr.seal_app(&ak, "correct horse").unwrap();
        assert!(kr.open_app_key().is_none());
        assert_eq!(kr.unlock_app(&Secret::Password("correct horse")).unwrap().0, ak.0);
        assert_eq!(kr.unlock_app(&Secret::Recovery(&code)).unwrap().0, ak.0);
        assert!(kr.unlock_app(&Secret::Password("wrong")).is_err());

        // A slot copied to another owner must not open.
        let other = LibraryEntry { id: "other".into(), slots: match &kr.app {
            AppKey::Sealed { slots } => slots.clone(),
            _ => unreachable!(),
        }};
        kr.libraries.push(other);
        assert!(kr.unwrap_with("other", &Secret::Password("correct horse")).is_err());

        kr.unseal_app(&ak);
        assert_eq!(kr.open_app_key().unwrap().0, ak.0);
    }

    #[test]
    fn keyfile_slot_opens_only_with_the_same_bytes() {
        let dek = SecretKey::random();
        let bytes = new_key_file_bytes();
        let slot = keyfile_slot("lib1", &bytes, &dek, "vol".into(), "k.trovekey".into(), "X:\\k".into()).unwrap();
        let kr_lib = LibraryEntry { id: "lib1".into(), slots: vec![slot] };
        let got = open_slots("lib1", &kr_lib.slots, &Secret::Keyfile(&bytes), None).unwrap();
        assert_eq!(got.0, dek.0);
        assert!(open_slots("lib1", &kr_lib.slots, &Secret::Keyfile(&[0u8; 32]), None).is_err());
    }
}
