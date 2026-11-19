//! Quick capture: a global shortcut shows a small window for writing something down over any app.
//! The page in that window hands the text to the main window, which saves it as a note, so this
//! module owns only the shortcut, the window and giving the focus back.

use std::str::FromStr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use tauri::plugin::TauriPlugin;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, TitleBarStyle, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Wry,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const LABEL: &str = "capture";
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 152.0;
/// How far down the screen the window sits, as a share of its height, near where the eye already is.
const FROM_TOP: f64 = 0.22;
const LONGEST_LINGER_MS: u64 = 3000;

#[derive(Default)]
pub struct Capture {
    shortcut: Mutex<Option<Shortcut>>,
    /// The app that was in front when the shortcut was pressed, which gets the focus back afterwards.
    previous: Mutex<Option<i32>>,
    /// Counts showings, so a hide left over from one capture leaves the next alone.
    shown: AtomicU64,
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let ours = app
                .state::<Capture>()
                .shortcut
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                == Some(shortcut);
            if ours && event.state == ShortcutState::Pressed {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || show(&handle));
            }
        })
        .build()
}

/// Registers the shortcut, or turns capture off for an empty one. A shortcut that cannot be had
/// leaves the one before it working and says why.
#[tauri::command]
pub async fn set_capture_shortcut(
    app: AppHandle,
    capture: State<'_, Capture>,
    accelerator: String,
) -> Result<(), String> {
    let wanted = match accelerator.trim() {
        "" => None,
        text => Some(
            Shortcut::from_str(text)
                .map_err(|_| format!("“{text}” is not a shortcut Waymark can use."))?,
        ),
    };
    let shortcuts = app.global_shortcut();
    let before = {
        let mut current = capture.shortcut.lock().unwrap_or_else(|e| e.into_inner());
        if *current == wanted {
            return Ok(());
        }
        current.take()
    };
    if let Some(old) = before {
        let _ = shortcuts.unregister(old);
    }
    let Some(new) = wanted else {
        return Ok(());
    };
    if shortcuts.register(new).is_err() {
        let kept = before.filter(|old| shortcuts.register(*old).is_ok());
        *capture.shortcut.lock().unwrap_or_else(|e| e.into_inner()) = kept;
        return Err("Another app already uses this shortcut.".into());
    }
    *capture.shortcut.lock().unwrap_or_else(|e| e.into_inner()) = Some(new);
    if app.get_webview_window(LABEL).is_none() {
        build(&app).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hides the window. With `return_focus` the app that was in front before gets the focus back at
/// once, while the window stays up for `linger_ms` so a confirmation can be read.
#[tauri::command]
pub fn capture_close(
    app: AppHandle,
    capture: State<'_, Capture>,
    linger_ms: u64,
    return_focus: bool,
) {
    let previous = capture
        .previous
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if let Some(pid) = previous.filter(|_| return_focus) {
        activate(pid);
    }
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if linger_ms == 0 {
        let _ = window.hide();
        return;
    }
    let _ = window.set_ignore_cursor_events(true);
    let showing = capture.shown.load(Ordering::SeqCst);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(linger_ms.min(LONGEST_LINGER_MS)));
        if app.state::<Capture>().shown.load(Ordering::SeqCst) == showing {
            let _ = window.hide();
        }
    });
}

pub fn has_focus(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
}

fn show(app: &AppHandle) {
    let capture = app.state::<Capture>();
    capture.shown.fetch_add(1, Ordering::SeqCst);
    let front = frontmost_other_app();
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => match build(app) {
            Ok(window) => window,
            Err(error) => {
                eprintln!("[capture] window not built: {error}");
                return;
            }
        },
    };
    if !window.is_visible().unwrap_or(false) {
        *capture.previous.lock().unwrap_or_else(|e| e.into_inner()) = front;
        place(app, &window);
    }
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit_to(LABEL, "capture-open", ());
}

/// Built once and kept hidden, so the field is ready the moment the shortcut is pressed.
fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("capture.html".into()))
        .title("Quick Capture")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .visible(false)
        .build()?;
    /* AppKit throws when a window is touched off the main thread, and the shortcut command runs on a worker. */
    let target = window.clone();
    window.run_on_main_thread(move || hide_window_buttons(&target))?;
    Ok(window)
}

/// The window keeps its rounded corners and shadow from the title bar style, without the three buttons.
fn hide_window_buttons(window: &WebviewWindow) {
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = ns_window as *mut AnyObject;
    for kind in 0usize..3 {
        unsafe {
            let button: *mut AnyObject = msg_send![ns_window, standardWindowButton: kind];
            if !button.is_null() {
                let _: () = msg_send![button, setHidden: true];
            }
        }
    }
}

/// Centred on the screen under the pointer, a little above the middle.
fn place(app: &AppHandle, window: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|at| app.monitor_from_point(at.x, at.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, window.outer_size()) else {
        let _ = window.center();
        return;
    };
    let origin = monitor.position();
    let screen = monitor.size();
    let x = origin.x + (i64::from(screen.width) - i64::from(size.width)).max(0) as i32 / 2;
    let y = origin.y + (f64::from(screen.height) * FROM_TOP) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn frontmost_other_app() -> Option<i32> {
    unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let front: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if front.is_null() {
            return None;
        }
        let pid: i32 = msg_send![front, processIdentifier];
        (u32::try_from(pid).ok() != Some(std::process::id())).then_some(pid)
    }
}

fn activate(pid: i32) {
    unsafe {
        let app: *mut AnyObject = msg_send![
            class!(NSRunningApplication),
            runningApplicationWithProcessIdentifier: pid
        ];
        if !app.is_null() {
            let _: bool = msg_send![app, activateWithOptions: 0usize];
        }
    }
}
