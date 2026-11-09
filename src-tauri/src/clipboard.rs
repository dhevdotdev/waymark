//! Reading the clipboard's text directly, because a web view's own API asks for permission on every read.

use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};

pub fn text() -> String {
    let board = NSPasteboard::generalPasteboard();
    let value = unsafe { board.stringForType(NSPasteboardTypeString) };
    value.map(|s| s.to_string()).unwrap_or_default()
}
