//! Reading and writing the clipboard's text directly, because a web view's own API asks for permission on every read.

use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
use objc2_foundation::NSString;

fn text() -> String {
    let board = NSPasteboard::generalPasteboard();
    let value = unsafe { board.stringForType(NSPasteboardTypeString) };
    value.map(|s| s.to_string()).unwrap_or_default()
}

fn write(text: &str) -> bool {
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    unsafe { board.setString_forType(&NSString::from_str(text), NSPasteboardTypeString) }
}

#[tauri::command]
pub async fn clipboard_text() -> Result<String, String> {
    Ok(text())
}

#[tauri::command]
pub async fn clipboard_write(text: String) -> Result<(), String> {
    if write(&text) {
        Ok(())
    } else {
        Err("The clipboard could not be written.".to_string())
    }
}
