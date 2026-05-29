fn main() {
    load_oauth_env();
    tauri_build::build()
}

/// Inject the Google OAuth credentials at compile time from a gitignored
/// `src-tauri/.env` file (or the ambient environment, e.g. CI), so no secret
/// lives in tracked source.
///
/// Note on threat model: a Desktop-client secret necessarily ships inside the
/// distributed binary and is NOT a confidentiality boundary per Google's
/// native-app guidance — PKCE is the real protection. Keeping it out of git is
/// purely to stop secret scanners / scrapers from harvesting a live value from
/// the public repo. See notes/decisions.md.
fn load_oauth_env() {
    const KEYS: [&str; 2] = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"];

    println!("cargo:rerun-if-changed=.env");
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let Ok(contents) = std::fs::read_to_string(".env") else {
        // No .env: rely on ambient env. If a key is still unset, env!() in
        // auth.rs fails the build with a pointer to .env.example.
        return;
    };

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = line.split_once('=') {
            let key = key.trim();
            if KEYS.contains(&key) {
                let val = val.trim().trim_matches('"');
                println!("cargo:rustc-env={key}={val}");
            }
        }
    }
}
