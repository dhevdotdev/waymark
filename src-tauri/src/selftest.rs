//! The packaged app's self-test hooks. Nothing here runs unless the test harness sets its variables.

use objc2::runtime::{AnyObject, Bool};
use objc2::{MainThreadMarker, msg_send};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSFloatingWindowLevel, NSWindow,
    NSWindowCollectionBehavior,
};
use serde::Serialize;
use tauri::{ActivationPolicy, App, AppHandle, Runtime, WebviewWindow};

#[derive(Serialize)]
pub struct SelfTest {
    pub vault: String,
    pub mode: String,
    pub drawn: bool,
}

/// True for a run that must leave the Mac alone: no window in sight and no focus taken.
/// `WAYMARK_SELFTEST_STAY` is the screenshot helper, which needs a window to capture.
pub fn unseen() -> bool {
    std::env::var_os("WAYMARK_SELFTEST_OUT").is_some()
        && std::env::var_os("WAYMARK_SELFTEST_STAY").is_none()
}

/// The harness asks for a drawn page only when nobody is using the Mac, because putting a window up can activate the app.
fn drawn() -> bool {
    std::env::var_os("WAYMARK_SELFTEST_DRAWN").is_some()
}

/// AppKit activates the app as it launches. The prohibited policy refuses that for the whole run,
/// and it must be set before the event loop starts. It also keeps the window off the screen.
pub fn stay_in_the_background(app: &mut App) {
    if unseen() && !drawn() {
        app.set_activation_policy(ActivationPolicy::Prohibited);
    }
}

pub fn show<R: Runtime>(window: &WebviewWindow<R>) {
    if drawn() {
        show_without_being_seen(window);
    } else {
        keep_timers_real(window);
    }
}

/// WebKit stretches the timers of a page nobody can see, which would make the run's timings meaningless.
fn keep_timers_real<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.with_webview(|webview| unsafe {
        let view = webview.inner() as *mut AnyObject;
        let configuration: *mut AnyObject = msg_send![view, configuration];
        let preferences: *mut AnyObject = msg_send![configuration, preferences];
        let _: () = msg_send![preferences, _setHiddenPageDOMTimerThrottlingEnabled: Bool::NO];
        let _: () = msg_send![preferences, _setHiddenPageDOMTimerThrottlingAutoIncreases: Bool::NO];
        let _: () =
            msg_send![preferences, _setPageVisibilityBasedProcessSuppressionEnabled: Bool::NO];
    });
}

/// Frames, CSS animations and editor measuring need a page that is drawn, so this window is on
/// screen above the others where nothing can cover it, but it draws nothing and takes no clicks.
fn show_without_being_seen<R: Runtime>(window: &WebviewWindow<R>) {
    let (Ok(pointer), Some(main_thread)) = (window.ns_window(), MainThreadMarker::new()) else {
        return;
    };
    NSApplication::sharedApplication(main_thread)
        .setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let window = unsafe { &*(pointer as *const NSWindow) };
    window.setAlphaValue(0.0);
    window.setIgnoresMouseEvents(true);
    window.setLevel(NSFloatingWindowLevel);
    window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    window.orderFrontRegardless();
}

/// QA hook: when WAYMARK_SELFTEST_OUT is set, the frontend runs its in-app checks
/// against WAYMARK_SELFTEST_VAULT and reports back through `selftest_report`.
#[tauri::command]
pub fn selftest_config() -> Option<SelfTest> {
    std::env::var("WAYMARK_SELFTEST_OUT").ok()?;
    Some(SelfTest {
        vault: std::env::var("WAYMARK_SELFTEST_VAULT").ok()?,
        mode: std::env::var("WAYMARK_SELFTEST_MODE").unwrap_or_else(|_| "read".into()),
        drawn: drawn() || !unseen(),
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
