fn main() {
    // Re-run if .env changes so renamed/added/removed vars are picked up.
    println!("cargo:rerun-if-changed=.env");

    // Load .env file if present (local dev). CI sets these vars directly.
    if let Ok(iter) = dotenvy::dotenv_iter() {
        for item in iter.flatten() {
            println!("cargo:rustc-env={}={}", item.0, item.1);
        }
    }
    tauri_build::build()
}
