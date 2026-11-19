//! Every way of quitting saves first. ⌘Q, the menu and closing the window arrive as Tauri events. The
//! quit Apple event, sent by the Dock, `osascript`, logout and restart, goes to the app delegate's
//! `applicationShouldTerminate:`, which tao does not implement, so it is added here.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use objc2::MainThreadMarker;
use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::sel;
use objc2_app_kit::{NSApplication, NSApplicationTerminateReply};
use tauri::{AppHandle, Emitter, Manager};

static QUITTING: AtomicBool = AtomicBool::new(false);
/// AppKit is waiting for `replyToApplicationShouldTerminate:`. Replying, rather than exiting the
/// event loop, lets logout and restart carry on once the save is done.
static TERMINATE_PENDING: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();

const SAVE_LIMIT: Duration = Duration::from_secs(5);

/// Closing the capture window cancels the capture. Closing the main window quits, as the app has one.
pub(crate) fn close_requested(app: &AppHandle, label: &str) {
    if label == crate::capture::LABEL {
        crate::capture::capture_close(app.clone(), app.state(), 0, true);
    } else {
        quit_after_saving(app);
    }
}

/// Gives the frontend a moment to save before the app goes away. The timer covers a frontend that never answers.
pub(crate) fn quit_after_saving(app: &AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit("save-before-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_LIMIT);
        let main = handle.clone();
        if handle.run_on_main_thread(move || finish(&main)).is_err() {
            handle.exit(0);
        }
    });
}

/// Called once the frontend has saved anything pending, so quitting can finish.
#[tauri::command]
pub(crate) fn finish_quit(app: AppHandle) {
    finish(&app);
}

fn finish(app: &AppHandle) {
    if TERMINATE_PENDING.swap(false, Ordering::SeqCst)
        && let Some(main_thread) = MainThreadMarker::new()
    {
        NSApplication::sharedApplication(main_thread).replyToApplicationShouldTerminate(true);
        return;
    }
    app.exit(0);
}

/// Adds `applicationShouldTerminate:` to the delegate tao installed. Call once, on the main thread, after the app is built.
pub(crate) fn install(app: &AppHandle) {
    let Some(main_thread) = MainThreadMarker::new() else {
        return;
    };
    if APP.set(app.clone()).is_err() {
        return;
    }
    let Some(delegate) = NSApplication::sharedApplication(main_thread).delegate() else {
        return;
    };
    let class: &AnyClass = AsRef::<AnyObject>::as_ref(&*delegate).class();
    let reply: extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> NSApplicationTerminateReply =
        should_terminate;
    unsafe {
        let imp: Imp = std::mem::transmute::<
            extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> NSApplicationTerminateReply,
            Imp,
        >(reply);
        class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            sel!(applicationShouldTerminate:),
            imp,
            c"Q@:@".as_ptr(),
        );
    }
}

extern "C-unwind" fn should_terminate(
    _: &AnyObject,
    _: Sel,
    _: &AnyObject,
) -> NSApplicationTerminateReply {
    let Some(app) = APP.get() else {
        return NSApplicationTerminateReply::TerminateNow;
    };
    TERMINATE_PENDING.store(true, Ordering::SeqCst);
    quit_after_saving(app);
    NSApplicationTerminateReply::TerminateLater
}
