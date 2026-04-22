//! Tracing/profiling setup for development and production.
//!
//! - **Dev builds**: every `#[instrument]`-ed function logs its duration to stderr
//!   when it completes (via `FmtSpan::CLOSE`). Output looks like:
//!   ```text
//!   DEBUG prefetch_lib::commands::repo get_commits{limit=None}: close time.busy=18ms time.idle=0ns
//!   ```
//! - **Perfetto timeline**: set `PREFETCH_TRACE=1` env var to also write a Chrome
//!   trace JSON file. Open it in <https://ui.perfetto.dev> for a full visual timeline.
//! - **Release builds**: DEBUG/TRACE levels are compiled out entirely (zero cost)
//!   via `release_max_level_info` in Cargo.toml. Only INFO/WARN/ERROR remain.
//!
//! Filter with `RUST_LOG` env var, e.g. `RUST_LOG=prefetch_lib=trace,info`.

use tracing_subscriber::{
    fmt::{self, format::FmtSpan},
    prelude::*,
    EnvFilter, Registry,
};

/// Initialize the global tracing subscriber. Call once at startup before
/// any Tauri commands run.
pub fn init() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("prefetch_lib=debug,info"));

    // Log span close events with timing (time.busy / time.idle).
    // In release builds, DEBUG spans are compiled out so this is zero-cost.
    let fmt_layer = fmt::layer()
        .with_target(true)
        .with_span_events(FmtSpan::CLOSE)
        .with_ansi(true)
        .compact();

    // Optional: write Chrome trace JSON for Perfetto visualization.
    // Activate with PREFETCH_TRACE=1 env var.
    if std::env::var("PREFETCH_TRACE").is_ok() {
        let (chrome_layer, guard) = tracing_chrome::ChromeLayerBuilder::new()
            .include_args(true)
            .build();
        // Leak the guard so the trace file is written for the entire process lifetime.
        // It finalizes on drop (process exit).
        std::mem::forget(guard);

        Registry::default()
            .with(env_filter)
            .with(fmt_layer)
            .with(chrome_layer)
            .init();

        eprintln!("[tracing] Chrome trace output enabled — file will be written on exit");
    } else {
        Registry::default().with(env_filter).with(fmt_layer).init();
    }
}
