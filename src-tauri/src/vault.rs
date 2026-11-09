use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

/// The open vault. Every file access goes through `resolve`, which keeps reads
/// inside the vault and away from dot-folders such as `.git` and `.obsidian`.
#[derive(Default)]
pub struct Vault {
    root: Mutex<Option<PathBuf>>,
    write_gate: Arc<Mutex<()>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
    pub is_git: bool,
}

impl Vault {
    pub fn set(&self, root: PathBuf) {
        *self.root.lock().unwrap() = Some(root);
    }

    pub fn root(&self) -> Result<PathBuf, String> {
        self.root
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "No vault is open".to_string())
    }

    /// Held while a command changes the repository, so two writes never race for Git's index lock.
    pub fn write_gate(&self) -> Arc<Mutex<()>> {
        self.write_gate.clone()
    }

    pub fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        resolve_in(&self.root()?, rel)
    }
}

/// Resolves a path inside the vault, refusing dot-folders whether named directly or reached through a symlink.
pub fn resolve_in(root: &Path, rel: &str) -> Result<PathBuf, String> {
    contained(root, rel, |part| !part.starts_with('.'))
}

/// A path relative to the repository, for files Git reports. Hidden files are allowed; `.git` is not.
pub fn relative_in_repo(root: &Path, rel: &str) -> Result<String, String> {
    let canonical = contained(root, rel, |part| part != ".git")?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let inside = canonical
        .strip_prefix(&canonical_root)
        .map_err(|e| e.to_string())?;
    Ok(inside.to_string_lossy().into_owned())
}

fn contained(root: &Path, rel: &str, allowed: fn(&str) -> bool) -> Result<PathBuf, String> {
    let refused = || format!("Refusing path outside the vault: {rel}");
    let parts_allowed = |path: &Path| {
        path.components()
            .all(|c| matches!(c, Component::Normal(part) if allowed(&part.to_string_lossy())))
    };
    let rel_path = Path::new(rel);
    if !parts_allowed(rel_path) {
        return Err(refused());
    }
    let canonical = root
        .join(rel_path)
        .canonicalize()
        .map_err(|_| format!("Not found: {rel}"))?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    match canonical.strip_prefix(&canonical_root) {
        Ok(inside) if parts_allowed(inside) => Ok(canonical),
        _ => Err(refused()),
    }
}

/// What happened to a note write. Anything but `Saved` left the disk untouched.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteOutcome {
    Saved,
    Changed { current: String },
    Missing,
}

/// Replaces a Markdown note, only if the file still holds `expected`. With no
/// `expected` the note must not exist yet, so a write can never land on text
/// the caller has not seen.
pub fn write_note(
    root: &Path,
    rel: &str,
    text: &str,
    expected: Option<&str>,
) -> Result<WriteOutcome, String> {
    let refused = || format!("Refusing to write outside the vault's notes: {rel}");
    let rel_path = Path::new(rel);
    let is_note = rel_path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("md"));
    let plain = rel_path
        .components()
        .all(|c| matches!(c, Component::Normal(part) if !part.to_string_lossy().starts_with('.')));
    if !is_note || !plain {
        return Err(refused());
    }
    let target = if root.join(rel_path).symlink_metadata().is_ok() {
        resolve_in(root, rel)?
    } else {
        if expected.is_some() {
            return Ok(WriteOutcome::Missing);
        }
        prepared_parent(root, rel_path)?.join(rel_path.file_name().ok_or_else(refused)?)
    };
    if target.exists() {
        let current =
            std::fs::read_to_string(&target).map_err(|e| format!("Could not read {rel}: {e}"))?;
        if expected != Some(current.as_str()) {
            return Ok(WriteOutcome::Changed { current });
        }
        if current == text {
            return Ok(WriteOutcome::Saved);
        }
    }
    replace_atomically(&target, text).map_err(|e| format!("Could not save {rel}: {e}"))?;
    Ok(WriteOutcome::Saved)
}

/// A crash between writing and renaming leaves a temporary file, which Git would otherwise offer to commit.
fn remove_leftover_temp_files(folder: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(".waymark-") && name.ends_with(".tmp") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Writes beside the note and renames over it, so a crash leaves the old text or the new, never half.
fn replace_atomically(target: &Path, text: &str) -> std::io::Result<()> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    if let Some(folder) = target.parent() {
        remove_leftover_temp_files(folder);
    }
    let temp = target.with_file_name(format!(".waymark-{}-{stamp}.tmp", std::process::id()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        if let Ok(existing) = std::fs::metadata(target) {
            std::fs::set_permissions(&temp, existing.permissions())?;
        }
        std::fs::rename(&temp, target)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// The Obsidian settings Waymark follows, so the vault keeps behaving the same in either app.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultSettings {
    pub attachment_folder: String,
    pub new_note_location: String,
    pub new_note_folder: String,
}

/// Read only. Waymark never writes to `.obsidian`.
pub fn settings(root: &Path) -> VaultSettings {
    let config: serde_json::Value = std::fs::read_to_string(root.join(".obsidian/app.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let field = |key: &str| config[key].as_str().unwrap_or_default().to_string();
    VaultSettings {
        attachment_folder: field("attachmentFolderPath"),
        new_note_location: field("newFileLocation"),
        new_note_folder: field("newFileFolderPath"),
    }
}

const ATTACHMENT_TYPES: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "pdf"];

fn plain_relative(path: &Path) -> bool {
    path.components()
        .all(|c| matches!(c, Component::Normal(part) if !part.to_string_lossy().starts_with('.')))
}

fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .is_some_and(|e| allowed.contains(&e.as_str()))
}

/// The folder a new file goes in, created if needed and confirmed to be inside the vault.
fn prepared_parent(root: &Path, rel: &Path) -> Result<PathBuf, String> {
    let Some(parent) = rel.parent().filter(|p| !p.as_os_str().is_empty()) else {
        return root.canonicalize().map_err(|e| e.to_string());
    };
    let mut existing = parent;
    while !root.join(existing).exists() {
        match existing.parent() {
            Some(up) if !up.as_os_str().is_empty() => existing = up,
            _ => {
                existing = Path::new("");
                break;
            }
        }
    }
    if !existing.as_os_str().is_empty() {
        resolve_in(root, &existing.to_string_lossy())?;
    }
    std::fs::create_dir_all(root.join(parent)).map_err(|e| e.to_string())?;
    resolve_in(root, &parent.to_string_lossy())
}

/// Renames or moves a note. Refuses to land on anything that already exists, apart from the same file in a different case.
pub fn rename_note(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let (from_path, to_path) = (Path::new(from), Path::new(to));
    let is_note = |p: &Path| plain_relative(p) && has_extension(p, &["md"]);
    if !is_note(from_path) || !is_note(to_path) {
        return Err(format!("Refusing to move outside the vault's notes: {to}"));
    }
    let source = resolve_in(root, from)?;
    let name = to_path.file_name().ok_or("That is not a note name")?;
    if root.join(to_path).symlink_metadata().is_ok() {
        let same = root.join(to_path).canonicalize().ok().as_ref() == Some(&source);
        if !same {
            return Err(format!("A note already exists at {to}"));
        }
    }
    let target = prepared_parent(root, to_path)?.join(name);
    std::fs::rename(source, target).map_err(|e| format!("Could not move {from}: {e}"))
}

/// Adds a new image or PDF to the vault. An existing file is never replaced.
pub fn write_attachment(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let path = Path::new(rel);
    if !plain_relative(path) || !has_extension(path, &ATTACHMENT_TYPES) {
        return Err(format!("Refusing to add this file to the vault: {rel}"));
    }
    let name = path.file_name().ok_or("That is not a file name")?;
    let target = prepared_parent(root, path)?.join(name);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| format!("Could not add {rel}: {e}"))?;
    file.write_all(bytes)
        .map_err(|e| format!("Could not add {rel}: {e}"))
}

pub fn info(root: &Path) -> VaultInfo {
    VaultInfo {
        root: root.to_string_lossy().into_owned(),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        is_git: root.join(".git").exists(),
    }
}

/// Lists vault files relative to the root, skipping dot-entries.
pub fn list(root: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if let (true, Ok(rel)) = (file_type.is_file(), path.strip_prefix(root)) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out.sort();
    Ok(out)
}

pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("md" | "txt" | "base") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_escapes_and_dot_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Notes")).unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join("Notes/a.md"), "x").unwrap();
        std::fs::write(dir.path().join(".git/config"), "secret").unwrap();
        assert!(resolve_in(dir.path(), "Notes/a.md").is_ok());
        assert!(resolve_in(dir.path(), "../etc/passwd").is_err());
        assert!(resolve_in(dir.path(), ".git/config").is_err());
        assert!(resolve_in(dir.path(), "/etc/passwd").is_err());
        assert!(resolve_in(dir.path(), "Notes/../.git/config").is_err());
    }

    #[test]
    fn refuses_symlinks_into_dot_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/config"), "secret").unwrap();
        std::os::unix::fs::symlink(dir.path().join(".git/config"), dir.path().join("Note.md"))
            .unwrap();
        assert!(resolve_in(dir.path(), "Note.md").is_err());
    }

    #[test]
    fn refuses_symlinks_that_leave_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), dir.path().join("link.md"))
            .unwrap();
        assert!(resolve_in(dir.path(), "link.md").is_err());
    }

    fn note(content: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        std::fs::write(&path, content).unwrap();
        (dir, path)
    }

    #[test]
    fn writes_only_over_the_text_it_expected() {
        let (dir, path) = note("old");
        assert_eq!(
            write_note(dir.path(), "a.md", "new", Some("old")),
            Ok(WriteOutcome::Saved)
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn a_change_on_disk_is_never_overwritten() {
        let (dir, path) = note("theirs");
        assert_eq!(
            write_note(dir.path(), "a.md", "mine", Some("what I saw")),
            Ok(WriteOutcome::Changed {
                current: "theirs".into()
            })
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "theirs");
    }

    #[test]
    fn creating_never_lands_on_an_existing_note() {
        let (dir, path) = note("theirs");
        assert!(matches!(
            write_note(dir.path(), "a.md", "mine", None),
            Ok(WriteOutcome::Changed { .. })
        ));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "theirs");
        assert_eq!(
            write_note(dir.path(), "b.md", "fresh", None),
            Ok(WriteOutcome::Saved)
        );
    }

    #[test]
    fn a_new_note_can_start_a_new_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            write_note(dir.path(), "In/box/a.md", "x", None),
            Ok(WriteOutcome::Saved)
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("In/box/a.md")).unwrap(),
            "x"
        );
    }

    #[test]
    fn a_deleted_note_is_reported_and_not_recreated() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            write_note(dir.path(), "gone.md", "mine", Some("old")),
            Ok(WriteOutcome::Missing)
        );
        assert!(!dir.path().join("gone.md").exists());
    }

    #[test]
    fn writes_are_confined_to_notes_in_the_vault() {
        let (dir, _) = note("x");
        std::fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        for path in [
            "../outside.md",
            "/tmp/outside.md",
            ".obsidian/a.md",
            "a.txt",
            "Notes/../../b.md",
            ".gitignore",
        ] {
            assert!(write_note(dir.path(), path, "y", None).is_err(), "{path}");
        }
    }

    #[test]
    fn writes_refuse_a_symlink_that_leaves_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.md");
        std::fs::write(&secret, "keep").unwrap();
        std::os::unix::fs::symlink(&secret, dir.path().join("link.md")).unwrap();
        assert!(write_note(dir.path(), "link.md", "y", Some("keep")).is_err());
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "keep");
    }

    #[test]
    fn a_save_clears_temp_files_left_by_a_crash() {
        let (dir, _) = note("old");
        std::fs::write(dir.path().join(".waymark-1-2.tmp"), "half").unwrap();
        write_note(dir.path(), "a.md", "new", Some("old")).unwrap();
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_save_keeps_permissions_and_leaves_no_temp_file() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, path) = note("old");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_note(dir.path(), "a.md", "new", Some("old")).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn renames_and_moves_a_note_creating_its_folder() {
        let (dir, _) = note("x");
        rename_note(dir.path(), "a.md", "Deep/er/b.md").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Deep/er/b.md")).unwrap(),
            "x"
        );
        assert!(!dir.path().join("a.md").exists());
    }

    #[test]
    fn a_rename_never_lands_on_another_note() {
        let (dir, path) = note("mine");
        std::fs::write(dir.path().join("b.md"), "theirs").unwrap();
        assert!(rename_note(dir.path(), "a.md", "b.md").is_err());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("b.md")).unwrap(),
            "theirs"
        );
        assert_eq!(std::fs::read_to_string(path).unwrap(), "mine");
    }

    #[test]
    fn a_rename_stays_among_the_vaults_notes() {
        let (dir, _) = note("x");
        for to in ["../out.md", ".obsidian/a.md", "b.txt", "/tmp/b.md"] {
            assert!(rename_note(dir.path(), "a.md", to).is_err(), "{to}");
        }
        assert!(dir.path().join("a.md").exists());
    }

    #[test]
    fn a_rename_refuses_a_folder_that_links_out_of_the_vault() {
        let (dir, path) = note("x");
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("away")).unwrap();
        assert!(rename_note(dir.path(), "a.md", "away/b.md").is_err());
        assert!(path.exists());
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[test]
    fn no_folder_is_created_through_a_link_out_of_the_vault() {
        let (dir, path) = note("x");
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("away")).unwrap();
        assert!(rename_note(dir.path(), "a.md", "away/new/b.md").is_err());
        assert!(!outside.path().join("new").exists());
        assert!(path.exists());
    }

    #[test]
    fn an_attachment_is_added_and_never_replaces_a_file() {
        let dir = tempfile::tempdir().unwrap();
        write_attachment(dir.path(), "Attachments/a.png", b"one").unwrap();
        assert!(write_attachment(dir.path(), "Attachments/a.png", b"two").is_err());
        assert_eq!(
            std::fs::read(dir.path().join("Attachments/a.png")).unwrap(),
            b"one"
        );
    }

    #[test]
    fn only_images_and_pdfs_can_be_added_inside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        for path in ["a.exe", "a.md", "../a.png", ".obsidian/a.png", "a"] {
            assert!(write_attachment(dir.path(), path, b"x").is_err(), "{path}");
        }
    }

    #[test]
    fn reads_obsidian_settings_and_copes_without_them() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(settings(dir.path()), VaultSettings::default());
        std::fs::create_dir(dir.path().join(".obsidian")).unwrap();
        std::fs::write(
            dir.path().join(".obsidian/app.json"),
            r#"{"attachmentFolderPath":"/Files","newFileLocation":"folder","newFileFolderPath":"/In"}"#,
        )
        .unwrap();
        let read = settings(dir.path());
        assert_eq!(read.attachment_folder, "/Files");
        assert_eq!(read.new_note_location, "folder");
        assert_eq!(read.new_note_folder, "/In");
        std::fs::write(dir.path().join(".obsidian/app.json"), "not json").unwrap();
        assert_eq!(settings(dir.path()), VaultSettings::default());
    }

    #[test]
    fn lists_files_without_dot_entries() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Notes")).unwrap();
        std::fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        std::fs::write(dir.path().join("Notes/a.md"), "x").unwrap();
        std::fs::write(dir.path().join(".obsidian/app.json"), "{}").unwrap();
        assert_eq!(list(dir.path()).unwrap(), vec!["Notes/a.md".to_string()]);
    }
}
