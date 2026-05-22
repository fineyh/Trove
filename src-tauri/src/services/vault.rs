//! In-memory vault state and on-disk metadata for the master password.
//!
//! Layout on disk:
//!   `<data_dir>/trove.db`        — the SQLite/SQLCipher database
//!   `<data_dir>/vault.json`      — exists only when a master password is set
//!
//! `vault.json` is plaintext metadata (KDF params, salt, verifier). The
//! verifier is an AEAD ciphertext over a known constant; if decryption
//! succeeds the password is correct, otherwise it isn't — without ever
//! touching the DB file.

use crate::services::crypto::{
    self, KdfParams, SecretKey, NONCE_LEN, SALT_LEN,
};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

const VERIFIER_PLAINTEXT: &[u8] = b"trove-vault-v1";
const VERIFIER_AAD: &[u8] = b"trove:vault:verifier:v1";
/// How long an unlocked conversation key stays cached after last use.
const CONV_KEY_TTL_SECS: u64 = 60 * 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultFile {
    version: u32,
    kdf_mem_kib: u32,
    kdf_iters: u32,
    kdf_parallelism: u32,
    salt_b64: String,
    /// nonce(12) || ciphertext+tag — AEAD over [VERIFIER_PLAINTEXT].
    verifier_b64: String,
}

impl VaultFile {
    fn params(&self) -> KdfParams {
        KdfParams {
            mem_kib: self.kdf_mem_kib,
            iters: self.kdf_iters,
            parallelism: self.kdf_parallelism,
        }
    }
}

struct CachedConvKey {
    key: SecretKey,
    last_used: Instant,
}

struct State {
    data_dir: PathBuf,
    /// Set whenever the vault is unlocked (or no master password is configured).
    /// `None` means locked.
    master_kek: Option<SecretKey>,
    /// True if a master password has been configured (vault.json exists).
    has_master: bool,
    /// conv_id → cached AES key, expired after [CONV_KEY_TTL_SECS].
    conv_keys: HashMap<i64, CachedConvKey>,
}

static STATE: OnceCell<RwLock<State>> = OnceCell::new();

/// Initialize the vault layer. Reads `vault.json` if present and reports
/// whether a master password is currently set.
pub fn init(data_dir: &Path) -> Result<bool> {
    let st = State {
        data_dir: data_dir.to_path_buf(),
        master_kek: None,
        has_master: vault_path(data_dir).is_file(),
        conv_keys: HashMap::new(),
    };
    let has_master = st.has_master;
    STATE
        .set(RwLock::new(st))
        .map_err(|_| anyhow!("vault already initialized"))?;
    Ok(has_master)
}

fn vault_path(data_dir: &Path) -> PathBuf {
    data_dir.join("vault.json")
}

fn read_state<R>(f: impl FnOnce(&State) -> R) -> R {
    let g = STATE.get().expect("vault not initialized").read();
    f(&g)
}

fn write_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut g = STATE.get().expect("vault not initialized").write();
    f(&mut g)
}

/// True if the user has configured a master password.
pub fn has_master_password() -> bool {
    read_state(|s| s.has_master)
}

/// The application data directory (where `trove.db` and `vault.json` live).
pub fn data_dir() -> PathBuf {
    read_state(|s| s.data_dir.clone())
}

/// True if the DB is currently usable (no master pwd, or vault unlocked).
pub fn is_unlocked() -> bool {
    read_state(|s| !s.has_master || s.master_kek.is_some())
}

#[allow(dead_code)]
pub fn master_kek() -> Option<SecretKey> {
    read_state(|s| s.master_kek.clone())
}

fn load_vault_file(data_dir: &Path) -> Result<VaultFile> {
    let raw = std::fs::read(vault_path(data_dir)).context("read vault.json")?;
    serde_json::from_slice(&raw).context("parse vault.json")
}

fn write_vault_file(data_dir: &Path, vf: &VaultFile) -> Result<()> {
    let p = vault_path(data_dir);
    let tmp = p.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(vf)?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

/// Build a vault file from a freshly derived KEK.
fn build_vault_file(kek: &SecretKey, salt: &[u8], params: KdfParams) -> Result<VaultFile> {
    let (nonce, ct) =
        crypto::aead_encrypt(kek, VERIFIER_PLAINTEXT, VERIFIER_AAD).context("seal verifier")?;
    let mut blob = Vec::with_capacity(nonce.len() + ct.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ct);
    Ok(VaultFile {
        version: 1,
        kdf_mem_kib: params.mem_kib,
        kdf_iters: params.iters,
        kdf_parallelism: params.parallelism,
        salt_b64: B64.encode(salt),
        verifier_b64: B64.encode(blob),
    })
}

fn check_verifier(kek: &SecretKey, vf: &VaultFile) -> Result<()> {
    let blob = B64.decode(&vf.verifier_b64).context("decode verifier")?;
    if blob.len() < NONCE_LEN + 16 {
        return Err(anyhow!("verifier too short"));
    }
    let (nonce, ct) = blob.split_at(NONCE_LEN);
    let pt = crypto::aead_decrypt(kek, nonce, ct, VERIFIER_AAD)
        .map_err(|_| anyhow!("incorrect password"))?;
    if pt != VERIFIER_PLAINTEXT {
        return Err(anyhow!("verifier mismatch"));
    }
    Ok(())
}

/// Derive a KEK from a candidate password against the on-disk salt/params,
/// then verify it against the on-disk verifier. Returns the KEK on success.
pub fn derive_and_verify(password: &str) -> Result<SecretKey> {
    let data_dir = read_state(|s| s.data_dir.clone());
    let vf = load_vault_file(&data_dir)?;
    let salt = B64.decode(&vf.salt_b64).context("decode salt")?;
    if salt.len() != SALT_LEN {
        return Err(anyhow!("bad salt length"));
    }
    let kek = crypto::derive_key(password, &salt, vf.params())?;
    check_verifier(&kek, &vf)?;
    Ok(kek)
}

/// Set the unlocked KEK in memory. Call after successfully verifying.
pub fn store_unlocked(kek: SecretKey) {
    write_state(|s| {
        s.master_kek = Some(kek);
    });
}

/// Wipe the in-memory KEK and all cached conversation keys.
pub fn forget_keys() {
    write_state(|s| {
        s.master_kek = None;
        s.conv_keys.clear();
    });
}

/// Build vault metadata for a fresh master password and write it to disk.
/// Returns the derived KEK so the DB layer can rekey.
pub fn create_master(password: &str) -> Result<SecretKey> {
    let data_dir = read_state(|s| s.data_dir.clone());
    let salt = crypto::random_salt();
    let params = KdfParams::default();
    let kek = crypto::derive_key(password, &salt, params)?;
    let vf = build_vault_file(&kek, &salt, params)?;
    write_vault_file(&data_dir, &vf)?;
    write_state(|s| {
        s.has_master = true;
        s.master_kek = Some(kek.clone());
    });
    Ok(kek)
}

/// Replace the on-disk salt + verifier with one derived from `new_password`.
/// Returns the new KEK so callers can rekey the DB.
pub fn rotate_master(new_password: &str) -> Result<SecretKey> {
    let data_dir = read_state(|s| s.data_dir.clone());
    let salt = crypto::random_salt();
    let params = KdfParams::default();
    let kek = crypto::derive_key(new_password, &salt, params)?;
    let vf = build_vault_file(&kek, &salt, params)?;
    write_vault_file(&data_dir, &vf)?;
    write_state(|s| {
        s.master_kek = Some(kek.clone());
    });
    Ok(kek)
}

/// Remove the master password entirely (after the DB has been rekeyed
/// to plaintext). Wipes vault.json and clears in-memory state.
pub fn drop_master() -> Result<()> {
    let data_dir = read_state(|s| s.data_dir.clone());
    let p = vault_path(&data_dir);
    if p.exists() {
        std::fs::remove_file(&p).context("remove vault.json")?;
    }
    write_state(|s| {
        s.has_master = false;
        s.master_kek = None;
        s.conv_keys.clear();
    });
    Ok(())
}

// ─── conversation-key cache ────────────────────────────────────────────────

fn gc_conv_keys(s: &mut State) {
    let now = Instant::now();
    s.conv_keys
        .retain(|_, v| now.duration_since(v.last_used).as_secs() < CONV_KEY_TTL_SECS);
}

pub fn cache_conv_key(conv_id: i64, key: SecretKey) {
    write_state(|s| {
        gc_conv_keys(s);
        s.conv_keys.insert(
            conv_id,
            CachedConvKey {
                key,
                last_used: Instant::now(),
            },
        );
    });
}

pub fn get_conv_key(conv_id: i64) -> Option<SecretKey> {
    write_state(|s| {
        gc_conv_keys(s);
        if let Some(c) = s.conv_keys.get_mut(&conv_id) {
            c.last_used = Instant::now();
            Some(c.key.clone())
        } else {
            None
        }
    })
}

pub fn forget_conv_key(conv_id: i64) {
    write_state(|s| {
        s.conv_keys.remove(&conv_id);
    });
}

pub fn unlocked_conv_ids() -> Vec<i64> {
    write_state(|s| {
        gc_conv_keys(s);
        s.conv_keys.keys().copied().collect()
    })
}

/// Convenience for derive + verify of a per-conversation password.
pub fn derive_conv_kek(password: &str, salt: &[u8], params: KdfParams) -> Result<SecretKey> {
    if salt.len() != SALT_LEN {
        return Err(anyhow!("conv salt has wrong length: {}", salt.len()));
    }
    crypto::derive_key(password, salt, params)
}

pub fn fresh_conv_kek_material(password: &str) -> Result<(SecretKey, [u8; SALT_LEN], KdfParams)> {
    let salt = crypto::random_salt();
    let params = KdfParams::default();
    let kek = crypto::derive_key(password, &salt, params)?;
    Ok((kek, salt, params))
}

/// Produce a fresh random conversation key (32 bytes) ready to wrap.
pub fn fresh_conv_key() -> SecretKey {
    SecretKey::random()
}
