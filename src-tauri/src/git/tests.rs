use super::runner::{ErrorKind, MAX_OUTPUT, WRITE_PATIENCE};
use super::*;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "T")
        .env("GIT_AUTHOR_EMAIL", "t@example.com")
        .env("GIT_COMMITTER_NAME", "T")
        .env("GIT_COMMITTER_EMAIL", "t@example.com")
        .output()
        .unwrap()
        .status
        .success();
    assert!(ok, "git {args:?} failed");
}

fn write(dir: &Path, rel: &str, text: &str) {
    std::fs::write(dir.join(rel), text).unwrap();
}

/// A bare remote with two clones, so ahead/behind/diverged states are real.
fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let remote = tmp.path().join("remote.git");
    git(
        tmp.path(),
        &["init", "--bare", "-b", "main", remote.to_str().unwrap()],
    );
    let a = tmp.path().join("a");
    let b = tmp.path().join("b");
    git(
        tmp.path(),
        &["clone", remote.to_str().unwrap(), a.to_str().unwrap()],
    );
    for (k, v) in [("user.name", "T"), ("user.email", "t@example.com")] {
        git(&a, &["config", k, v]);
    }
    git(&a, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    write(&a, "Note.md", "one\n");
    git(&a, &["add", "."]);
    git(&a, &["commit", "-m", "first"]);
    git(&a, &["push", "-u", "origin", "main"]);
    git(
        tmp.path(),
        &["clone", remote.to_str().unwrap(), b.to_str().unwrap()],
    );
    for (k, v) in [("user.name", "T"), ("user.email", "t@example.com")] {
        git(&b, &["config", k, v]);
    }
    (tmp, a, b)
}

#[test]
fn untracked_diff_stays_inside_the_repository() {
    let (_tmp, a, _b) = fixture();
    write(&a, "new.md", "fresh note\n");
    assert!(
        diff_worktree(&a, "new.md", false, true)
            .unwrap()
            .contains("fresh note")
    );
    assert!(diff_worktree(&a, "/etc/hosts", false, true).is_err());
    assert!(diff_worktree(&a, "../outside", false, true).is_err());
    assert!(diff_worktree(&a, ".git/config", false, true).is_err());
}

#[test]
fn refuses_to_commit_during_an_unfinished_merge() {
    let (_tmp, a, _b) = fixture();
    write(&a, "staged.md", "x");
    git(&a, &["add", "staged.md"]);
    let head = status(&a).unwrap().head.unwrap();
    std::fs::write(a.join(".git/MERGE_HEAD"), format!("{head}\n")).unwrap();
    let err = commit(&a, "would conclude the merge").unwrap_err();
    assert_eq!(err.kind, ErrorKind::InProgress);
}

#[test]
fn oversized_output_is_an_error_not_a_truncated_success() {
    let (_tmp, a, _b) = fixture();
    write(&a, "huge.md", &"x".repeat(MAX_OUTPUT + 16));
    git(&a, &["add", "huge.md"]);
    git(&a, &["commit", "-qm", "huge"]);
    let sha = status(&a).unwrap().head.unwrap();
    assert!(file_at(&a, &sha, "huge.md").is_err());
}

#[test]
fn rejects_control_characters_in_credentials() {
    let (_tmp, a, _b) = fixture();
    assert!(store_credential(&a, "https://evil\tx/r", "u", "p").is_err());
    assert!(store_credential(&a, "https://host/r", "u\u{7}", "p").is_err());
    assert!(store_credential(&a, "https://host/r", "u", "p\r").is_err());
}

#[test]
fn fast_forwards_clean_incoming_changes() {
    let (_t, a, b) = fixture();
    write(&a, "Note.md", "two\n");
    git(&a, &["commit", "-am", "second"]);
    git(&a, &["push"]);
    let st = fetch(&b).unwrap();
    assert_eq!((st.ahead, st.behind), (0, 1));
    let st = fast_forward(&b).unwrap();
    assert_eq!(st.behind, 0);
    assert_eq!(std::fs::read_to_string(b.join("Note.md")).unwrap(), "two\n");
}

#[test]
fn refuses_to_merge_diverged_histories() {
    let (_t, a, b) = fixture();
    write(&a, "Note.md", "from a\n");
    git(&a, &["commit", "-am", "a"]);
    git(&a, &["push"]);
    write(&b, "Other.md", "from b\n");
    git(&b, &["add", "."]);
    git(&b, &["commit", "-m", "b"]);
    let st = fetch(&b).unwrap();
    assert_eq!((st.ahead, st.behind), (1, 1));
    let head_before = status(&b).unwrap().head;
    let err = fast_forward(&b).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Diverged);
    assert_eq!(status(&b).unwrap().head, head_before);
    assert_eq!(push(&b).unwrap_err().kind, ErrorKind::Rejected);
}

#[test]
fn keeps_local_edits_that_incoming_changes_would_overwrite() {
    let (_t, a, b) = fixture();
    write(&a, "Note.md", "remote edit\n");
    git(&a, &["commit", "-am", "edit"]);
    git(&a, &["push"]);
    write(&b, "Note.md", "my unsaved edit\n");
    fetch(&b).unwrap();
    let err = fast_forward(&b).unwrap_err();
    assert_eq!(err.kind, ErrorKind::LocalChangesBlock);
    assert_eq!(
        std::fs::read_to_string(b.join("Note.md")).unwrap(),
        "my unsaved edit\n"
    );
}

#[test]
fn stages_commits_and_pushes_only_on_request() {
    let (_t, a, _b) = fixture();
    write(&a, "New.md", "new\n");
    let st = status(&a).unwrap();
    assert!(
        st.files
            .iter()
            .any(|f| f.path == "New.md" && f.unstaged == "?")
    );
    assert!(commit(&a, "nothing staged").is_err());
    stage(&a, &["New.md".into()]).unwrap();
    let st = unstage(&a, &["New.md".into()]).unwrap();
    assert!(
        st.files
            .iter()
            .any(|f| f.path == "New.md" && f.unstaged == "?")
    );
    assert!(a.join("New.md").exists());
    stage(&a, &["New.md".into()]).unwrap();
    let st = commit(&a, "Add note").unwrap();
    assert_eq!(st.ahead, 1);
    let st = push(&a).unwrap();
    assert_eq!(st.ahead, 0);
}

#[test]
fn reads_history_and_revisions() {
    let (_t, a, _b) = fixture();
    write(&a, "Note.md", "two\n");
    git(&a, &["commit", "-am", "second"]);
    let commits = log(&a, Some("Note.md"), 10, 0).unwrap();
    assert_eq!(
        commits
            .iter()
            .map(|c| c.subject.as_str())
            .collect::<Vec<_>>(),
        ["second", "first"]
    );
    assert_eq!(file_at(&a, &commits[1].sha, "Note.md").unwrap(), "one\n");
    let diff = diff_revs(&a, &commits[1].sha, &commits[0].sha, "Note.md").unwrap();
    assert!(diff.contains("-one") && diff.contains("+two"));
    assert!(show_commit(&a, "--output=/tmp/x", None).is_err());
}

#[test]
fn reports_offline_remotes() {
    let (_t, a, _b) = fixture();
    git(
        &a,
        &[
            "remote",
            "set-url",
            "origin",
            "https://waymark-test.invalid/repo.git",
        ],
    );
    let err = fetch(&a).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Offline, "{}", err.message);
}

#[test]
fn clones_into_a_new_folder_only() {
    let (t, _a, _b) = fixture();
    let remote = t.path().join("remote.git");
    let dest = t.path().join("fresh");
    let mut lines = Vec::new();
    clone(remote.to_str().unwrap(), &dest, |l| lines.push(l)).unwrap();
    assert!(dest.join("Note.md").exists());
    let err = clone(remote.to_str().unwrap(), &dest, |_| {}).unwrap_err();
    assert!(err.message.contains("empty or new folder"));
}

#[test]
fn redacts_credentials() {
    assert_eq!(
        redact("see https://example.com:8443/docs/@release"),
        "see https://example.com:8443/docs/@release"
    );
    assert_eq!(
        redact("fatal: https://me:hunter/2@host.com/r.git failed"),
        "fatal: https://***@host.com/r.git failed"
    );
    assert_eq!(
        redact("fatal: https://me:s3cret@host.com/r.git failed"),
        "fatal: https://***@host.com/r.git failed"
    );
    assert_eq!(redact("token ghp_abcDEF123 leaked"), "token ghp_*** leaked");
    assert_eq!(redact("git@github.com:me/r.git"), "git@github.com:me/r.git");
}

#[test]
fn parses_renames_and_conflicts() {
    let raw = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
2 R. N... 100644 100644 100644 aaa bbb R100 New name.md\0Old name.md\0\
u UU N... 100644 100644 100644 100644 a b c Both.md\0? Untracked file.md\0";
    let st = parse_status(raw);
    assert_eq!((st.ahead, st.behind), (2, 1));
    assert_eq!(st.files[0].path, "New name.md");
    assert_eq!(st.files[0].orig_path.as_deref(), Some("Old name.md"));
    assert!(st.files[1].conflicted);
    assert_eq!(st.files[2].unstaged, "?");
}

#[test]
fn staged_paths_are_taken_literally() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path();
    git(repo, &["init", "-q"]);
    std::fs::write(repo.join("a.md"), "a").unwrap();
    std::fs::write(repo.join("b.md"), "b").unwrap();
    assert!(stage(repo, &["*.md".to_string()]).is_err());
    assert!(stage(repo, &[":/".to_string()]).is_err());
    let st = status(repo).unwrap();
    assert!(st.files.iter().all(|f| f.unstaged == "?"), "{:?}", st.files);
}

#[test]
fn a_stuck_commit_stops_the_wait_but_is_not_killed() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path();
    git(repo, &["init", "-q"]);
    git(repo, &["config", "user.name", "T"]);
    git(repo, &["config", "user.email", "t@example.invalid"]);
    std::fs::write(repo.join("a.md"), "a").unwrap();
    stage(repo, &["a.md".to_string()]).unwrap();
    let hook = repo.join(".git/hooks/pre-commit");
    std::fs::write(
        &hook,
        format!("#!/bin/sh\nsleep {}\n", WRITE_PATIENCE.as_secs() + 2),
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let started = std::time::Instant::now();
    let error = commit(repo, "slow").unwrap_err();
    assert_eq!(error.kind, ErrorKind::Timeout);
    assert!(started.elapsed() < WRITE_PATIENCE + std::time::Duration::from_secs(2));
    std::thread::sleep(std::time::Duration::from_secs(4));
    assert!(
        status(repo).unwrap().head.is_some(),
        "the commit should finish on its own"
    );
}
