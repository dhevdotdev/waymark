//! Deleting goes through the macOS Trash, so a note can always be put back.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use objc2_foundation::{NSFileManager, NSString, NSURL};

pub fn move_to_trash(path: &Path) -> Result<(), String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|error| error.localizedDescription().to_string())
}

fn is_note_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.contains(['/', '\\'])
        && name.to_ascii_lowercase().ends_with(".md")
}

/// Puts text in the Trash as a new file, so a version being replaced can still be recovered.
pub fn keep_text(name: &str, text: &str) -> Result<(), String> {
    if !is_note_file_name(name) {
        return Err("Not a note name".into());
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let folder = std::env::temp_dir().join(format!("waymark-kept-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let file = folder.join(name);
    let moved = fs::write(&file, text)
        .map_err(|e| e.to_string())
        .and_then(|()| move_to_trash(&file));
    let _ = fs::remove_file(&file);
    let _ = fs::remove_dir(&folder);
    moved
}

#[cfg(test)]
mod tests {
    use super::is_note_file_name;

    #[test]
    fn names_that_could_leave_the_folder_are_refused() {
        assert!(is_note_file_name("Plan (other version 2026-11-09 1740).md"));
        for bad in [
            "",
            ".hidden.md",
            "../up.md",
            "a/b.md",
            "a\\b.md",
            "plan.txt",
        ] {
            assert!(!is_note_file_name(bad), "{bad}");
        }
    }
}
