//! Cryptographic primitives: KDF, AEAD, and key wrapping.
//!
//! Layout:
//! - master password → Argon2id(salt, params) → 32-byte KEK
//! - KEK is fed to SQLCipher as the page key (whole-DB encryption)
//! - each encrypted conversation has its own random 32-byte conv key
//! - conv key is wrapped by AES-GCM(KEK, conv_kdf? else KEK directly)
//!
//! For conversation-level passwords we mirror the KDF: the conversation
//! has its own salt and the wrap key is derived from `conv_password`.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Context, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::{rngs::OsRng, RngCore};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;

/// 32-byte key material that wipes itself on drop.
#[derive(Clone, ZeroizeOnDrop)]
pub struct SecretKey(pub [u8; KEY_LEN]);

impl SecretKey {
    pub fn random() -> Self {
        let mut k = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut k);
        Self(k)
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    /// SQLCipher accepts a hex-encoded raw key via `PRAGMA key = "x'...'"`.
    pub fn to_sqlcipher_pragma(&self) -> String {
        format!("\"x'{}'\"", hex::encode(self.0))
    }
}

#[derive(Debug, Clone, Copy)]
pub struct KdfParams {
    pub mem_kib: u32,
    pub iters: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    /// ~64 MiB, 3 iterations, single thread — interactive desktop tier.
    fn default() -> Self {
        Self {
            mem_kib: 64 * 1024,
            iters: 3,
            parallelism: 1,
        }
    }
}

pub fn random_salt() -> [u8; SALT_LEN] {
    let mut s = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut s);
    s
}

pub fn random_nonce() -> [u8; NONCE_LEN] {
    let mut n = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut n);
    n
}

pub fn derive_key(password: &str, salt: &[u8], params: KdfParams) -> Result<SecretKey> {
    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(params.mem_kib, params.iters, params.parallelism, Some(KEY_LEN))
            .map_err(|e| anyhow!("argon2 params: {e}"))?,
    );
    let mut out = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| anyhow!("argon2 derive: {e}"))?;
    Ok(SecretKey(out))
}

/// Produce a (nonce, ciphertext) pair. Ciphertext includes the 16-byte tag.
pub fn aead_encrypt(key: &SecretKey, plaintext: &[u8], aad: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let nonce_bytes = random_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|e| anyhow!("aead encrypt: {e}"))?;
    Ok((nonce_bytes.to_vec(), ct))
}

pub fn aead_decrypt(
    key: &SecretKey,
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>> {
    if nonce.len() != NONCE_LEN {
        return Err(anyhow!("bad nonce length"));
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let nonce = Nonce::from_slice(nonce);
    cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|e| anyhow!("aead decrypt: {e}"))
}

/// Wrap a 32-byte conversation key under a wrap key (KEK or per-conv KEK2).
/// Output layout: nonce(12) || ciphertext(48 = 32 key + 16 tag).
pub fn wrap_key(wrap_key: &SecretKey, conv_key: &SecretKey, aad: &[u8]) -> Result<Vec<u8>> {
    let (nonce, ct) = aead_encrypt(wrap_key, conv_key.as_bytes(), aad)?;
    let mut out = Vec::with_capacity(nonce.len() + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn unwrap_key(wrap_key: &SecretKey, wrapped: &[u8], aad: &[u8]) -> Result<SecretKey> {
    if wrapped.len() < NONCE_LEN + KEY_LEN + 16 {
        return Err(anyhow!("wrapped key too short"));
    }
    let (nonce, ct) = wrapped.split_at(NONCE_LEN);
    let pt = aead_decrypt(wrap_key, nonce, ct, aad)?;
    if pt.len() != KEY_LEN {
        let mut z = pt;
        z.zeroize();
        return Err(anyhow!("unwrap produced wrong key length"));
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&pt);
    Ok(SecretKey(k))
}

/// Combined ciphertext layout for caption fields: nonce(12) || ciphertext+tag.
/// Stored in a single BLOB column (`caption_iv` already exists; we put the
/// nonce there and the ciphertext in `caption`).
pub fn encrypt_caption(key: &SecretKey, plaintext: &str) -> Result<(Vec<u8>, Vec<u8>)> {
    aead_encrypt(key, plaintext.as_bytes(), b"trove:caption:v1")
}

pub fn decrypt_caption(key: &SecretKey, nonce: &[u8], ciphertext: &[u8]) -> Result<String> {
    let pt = aead_decrypt(key, nonce, ciphertext, b"trove:caption:v1")?;
    String::from_utf8(pt).context("decrypted caption is not valid UTF-8")
}
