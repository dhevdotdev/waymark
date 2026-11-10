//! Deleting goes through the macOS Trash, so a note can always be put back.

use std::collections::HashMap;
use std::ffi::{CString, c_char, c_int, c_uint};
use std::fs;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use objc2::rc::Retained;
use objc2_foundation::{NSFileManager, NSString, NSURL};

const RENAME_EXCL: c_uint = 0x4;

unsafe extern "C" {
    fn renamex_np(from: *const c_char, to: *const c_char, flags: c_uint) -> c_int;
}

/// Moves a file or folder, failing rather than replacing anything already at `to`.
fn move_without_replacing(from: &Path, to: &Path) -> io::Result<()> {
    let c = |path: &Path| CString::new(path.as_os_str().as_bytes()).map_err(io::Error::other);
    let (from, to) = (c(from)?, c(to)?);
    match unsafe { renamex_np(from.as_ptr(), to.as_ptr(), RENAME_EXCL) } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

/// Returns where the item now sits in the Trash.
pub fn move_to_trash(path: &Path) -> Result<PathBuf, String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let mut resulting: Option<Retained<NSURL>> = None;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, Some(&mut resulting))
        .map_err(|error| error.localizedDescription().to_string())?;
    resulting
        .and_then(|url| url.path())
        .map(|path| PathBuf::from(path.to_string()))
        .ok_or_else(|| "The Trash did not say where the item went".to_string())
}

struct Trashed {
    original: PathBuf,
    in_trash: PathBuf,
}

/// What this session moved to the Trash, so it can be put back by a token and never by a path from the page.
#[derive(Default)]
pub struct TrashLog(Mutex<(u64, HashMap<u64, Trashed>)>);

impl TrashLog {
    pub fn record(&self, original: PathBuf, in_trash: PathBuf) -> u64 {
        let mut log = self.0.lock().unwrap_or_else(|e| e.into_inner());
        log.0 += 1;
        let token = log.0;
        log.1.insert(token, Trashed { original, in_trash });
        token
    }

    /// Puts an item back exactly where it was. Anything now at that place is left alone.
    pub fn restore(&self, token: u64) -> Result<(), String> {
        let mut log = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let entry = log.1.get(&token).ok_or("This can no longer be undone.")?;
        let name = entry
            .original
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let taken = || format!("Something named “{name}” is there now, so it stayed in the Trash.");
        if entry.original.symlink_metadata().is_ok() {
            return Err(taken());
        }
        if let Some(parent) = entry.original.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        move_without_replacing(&entry.in_trash, &entry.original).map_err(|e| match e.kind() {
            io::ErrorKind::AlreadyExists => taken(),
            io::ErrorKind::NotFound => format!("“{name}” is no longer in the Trash."),
            _ => e.to_string(),
        })?;
        log.1.remove(&token);
        Ok(())
    }
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
        .and_then(|()| move_to_trash(&file).map(|_| ()));
    let _ = fs::remove_file(&file);
    let _ = fs::remove_dir(&folder);
    moved
}

#[cfg(test)]
mod tests {
    use super::{TrashLog, is_note_file_name};
    use std::fs;

    fn parked(dir: &std::path::Path) -> (std::path::PathBuf, std::path::PathBuf) {
        let bin = dir.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let parked = bin.join("note.md");
        fs::write(&parked, "kept").unwrap();
        (dir.join("gone/deep/note.md"), parked)
    }

    #[test]
    fn undo_puts_an_item_back_and_can_recreate_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let (original, in_trash) = parked(dir.path());
        let log = TrashLog::default();
        let token = log.record(original.clone(), in_trash.clone());
        log.restore(token).unwrap();
        assert_eq!(fs::read_to_string(&original).unwrap(), "kept");
        assert!(!in_trash.exists(), "no copy is left behind");
        assert!(log.restore(token).is_err(), "a token works once");
    }

    #[test]
    fn undo_never_overwrites_what_is_there_now() {
        let dir = tempfile::tempdir().unwrap();
        let (original, in_trash) = parked(dir.path());
        fs::create_dir_all(original.parent().unwrap()).unwrap();
        fs::write(&original, "newer").unwrap();
        let log = TrashLog::default();
        let token = log.record(original.clone(), in_trash.clone());
        assert!(
            log.restore(token)
                .unwrap_err()
                .contains("stayed in the Trash")
        );
        assert_eq!(fs::read_to_string(&original).unwrap(), "newer");
        assert_eq!(fs::read_to_string(&in_trash).unwrap(), "kept");
    }

    #[test]
    fn undo_reports_an_item_emptied_from_the_trash() {
        let dir = tempfile::tempdir().unwrap();
        let (original, in_trash) = parked(dir.path());
        fs::remove_file(&in_trash).unwrap();
        let log = TrashLog::default();
        let token = log.record(original, in_trash);
        assert!(
            log.restore(token)
                .unwrap_err()
                .contains("no longer in the Trash")
        );
    }

    #[test]
    fn an_unknown_token_is_refused() {
        assert!(TrashLog::default().restore(7).is_err());
    }

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
