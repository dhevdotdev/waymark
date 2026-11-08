use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

/// The open vault. Every file access goes through `resolve`, which keeps reads
/// inside the vault and away from dot-folders such as `.git` and `.obsidian`.
#[derive(Default)]
pub struct Vault {
    root: Mutex<Option<PathBuf>>,
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
        self.root.lock().unwrap().clone().ok_or_else(|| "No vault is open".to_string())
    }

    pub fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        resolve_in(&self.root()?, rel)
    }
}

pub fn resolve_in(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    for component in rel_path.components() {
        match component {
            Component::Normal(part) if !part.to_string_lossy().starts_with('.') => {}
            _ => return Err(format!("Refusing path outside the vault: {rel}")),
        }
    }
    let joined = root.join(rel_path);
    let canonical = joined.canonicalize().map_err(|_| format!("Not found: {rel}"))?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err(format!("Refusing path outside the vault: {rel}"));
    }
    Ok(canonical)
}

pub fn info(root: &Path) -> VaultInfo {
    VaultInfo {
        root: root.to_string_lossy().into_owned(),
        name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
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
            } else if file_type.is_file() {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

pub fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
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
    fn refuses_symlinks_that_leave_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), dir.path().join("link.md")).unwrap();
        assert!(resolve_in(dir.path(), "link.md").is_err());
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
