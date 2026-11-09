//! The packaged app's self-test hooks. Nothing here runs unless the test harness sets its variables.

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct SelfTest {
    pub vault: String,
    pub mode: String,
}

/// QA hook: when WAYMARK_SELFTEST_OUT is set, the frontend runs its in-app checks
/// against WAYMARK_SELFTEST_VAULT and reports back through `selftest_report`.
#[tauri::command]
pub fn selftest_config(app: AppHandle) -> Option<SelfTest> {
    std::env::var("WAYMARK_SELFTEST_OUT").ok()?;
    /* macOS throttles timers in hidden windows; a self-test runs in front so its timings are real. */
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    Some(SelfTest {
        vault: std::env::var("WAYMARK_SELFTEST_VAULT").ok()?,
        mode: std::env::var("WAYMARK_SELFTEST_MODE").unwrap_or_else(|_| "read".into()),
    })
}

#[tauri::command]
pub fn selftest_log(line: String) {
    eprintln!("[selftest] {line}");
}

#[tauri::command]
pub fn selftest_report(app: AppHandle, report: serde_json::Value) -> Result<(), String> {
    let out = std::env::var("WAYMARK_SELFTEST_OUT").map_err(|e| e.to_string())?;
    std::fs::write(
        out,
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if std::env::var("WAYMARK_SELFTEST_STAY").is_err() {
        app.exit(0);
    }
    Ok(())
}
