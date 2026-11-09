//! Renaming and trashing whole folders of a vault.

use std::path::{Path, PathBuf};

use crate::vault::{plain_relative, prepared_parent, resolve_in};

/// A real folder inside the vault: never the vault itself, a hidden folder or a link to somewhere else.
pub fn real_folder(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let refused = || format!("Refusing to change this folder: {rel}");
    if rel.is_empty() || !plain_relative(Path::new(rel)) {
        return Err(refused());
    }
    let resolved = resolve_in(root, rel)?;
    let is_folder = root
        .join(rel)
        .symlink_metadata()
        .is_ok_and(|meta| meta.is_dir());
    is_folder.then_some(resolved).ok_or_else(refused)
}

/// Renames or moves a folder with everything in it. Refuses to land on anything that already exists, apart from the same folder in a different case.
pub fn rename_folder(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let source = real_folder(root, from)?;
    let to_path = Path::new(to);
    if to.is_empty() || !plain_relative(to_path) || to_path.starts_with(from) {
        return Err(format!("Refusing to move this folder to {to}"));
    }
    let name = to_path.file_name().ok_or("That is not a folder name")?;
    if root.join(to_path).symlink_metadata().is_ok() {
        let same = root.join(to_path).canonicalize().ok().as_ref() == Some(&source);
        if !same {
            return Err(format!("Something already exists at {to}"));
        }
    }
    let target = prepared_parent(root, to_path)?.join(name);
    std::fs::rename(source, target).map_err(|e| format!("Could not rename {from}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Old/Sub")).unwrap();
        std::fs::write(dir.path().join("Old/Sub/a.md"), "x").unwrap();
        std::fs::write(dir.path().join("Old/pic.png"), "p").unwrap();
        dir
    }

    #[test]
    fn renames_a_folder_with_everything_in_it() {
        let dir = folder();
        rename_folder(dir.path(), "Old", "Deep/New").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Deep/New/Sub/a.md")).unwrap(),
            "x"
        );
        assert!(dir.path().join("Deep/New/pic.png").exists());
        assert!(!dir.path().join("Old").exists());
    }

    #[test]
    fn a_folder_can_change_only_its_case() {
        let dir = folder();
        rename_folder(dir.path(), "Old", "OLD").unwrap();
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["OLD"]);
    }

    #[test]
    fn a_folder_rename_never_lands_on_something_else() {
        let dir = folder();
        std::fs::create_dir(dir.path().join("Taken")).unwrap();
        std::fs::write(dir.path().join("file"), "keep").unwrap();
        for to in ["Taken", "file"] {
            assert!(rename_folder(dir.path(), "Old", to).is_err(), "{to}");
        }
        assert!(dir.path().join("Old/Sub/a.md").exists());
    }

    #[test]
    fn a_folder_rename_stays_inside_the_vault_and_out_of_itself() {
        let dir = folder();
        for to in ["", "../out", ".obsidian", "/tmp/out", "Old/Sub/In"] {
            assert!(rename_folder(dir.path(), "Old", to).is_err(), "{to:?}");
        }
        assert!(dir.path().join("Old/Sub/a.md").exists());
    }

    #[test]
    fn only_real_visible_folders_inside_the_vault_can_be_changed() {
        let dir = folder();
        std::fs::create_dir(dir.path().join(".obsidian")).unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("away")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("Old"), dir.path().join("inner")).unwrap();
        for rel in [
            "",
            ".",
            "..",
            ".obsidian",
            "away",
            "inner",
            "Old/pic.png",
            "Gone",
            "/tmp",
        ] {
            assert!(real_folder(dir.path(), rel).is_err(), "{rel:?}");
        }
        assert!(real_folder(dir.path(), "Old/Sub").is_ok());
    }
}
