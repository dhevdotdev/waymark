use super::backup::{BackupOutcome, BackupReport, backup};
use super::runner::ErrorKind;
use super::tests::{fixture, git, write};
use super::*;
use std::os::unix::fs::PermissionsExt;
use std::process::Command;
use std::sync::{Arc, Mutex};

const MESSAGE: &str = "vault backup: 2026-11-09 17:40:00";

fn run(root: &Path) -> BackupReport {
    backup(root, MESSAGE, &Mutex::new(())).unwrap()
}

fn output(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn remote_of(a: &Path) -> std::path::PathBuf {
    a.parent().unwrap().join("remote.git")
}

fn remote_log(a: &Path) -> Vec<String> {
    output(&remote_of(a), &["log", "--format=%s", "main"])
        .lines()
        .map(str::to_string)
        .collect()
}

fn count(dir: &Path) -> usize {
    output(dir, &["rev-list", "--count", "HEAD"])
        .parse()
        .unwrap()
}

/// Points the clone at an SSH remote whose transport always fails with `stderr`.
fn break_remote(a: &Path, stderr: &str) {
    let script = a.parent().unwrap().join("fake-ssh.sh");
    std::fs::write(
        &script,
        format!("#!/bin/sh\necho '{stderr}' >&2\nexit 255\n"),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    git(a, &["config", "core.sshCommand", script.to_str().unwrap()]);
    git(
        a,
        &[
            "remote",
            "set-url",
            "origin",
            "git@example.invalid:vault.git",
        ],
    );
}

fn repair_remote(a: &Path) {
    git(a, &["config", "--unset", "core.sshCommand"]);
    git(
        a,
        &[
            "remote",
            "set-url",
            "origin",
            remote_of(a).to_str().unwrap(),
        ],
    );
}

fn push_from_other_clone(b: &Path, name: &str) {
    git(b, &["pull", "--ff-only", "-q"]);
    write(b, name, "from the other machine\n");
    git(b, &["add", "."]);
    git(b, &["commit", "-qm", "remote work"]);
    git(b, &["push", "-q"]);
}

#[test]
fn nothing_changed_commits_and_pushes_nothing() {
    let (_tmp, a, _b) = fixture();
    let report = run(&a);
    assert_eq!(report.outcome, BackupOutcome::Nothing);
    assert_eq!(count(&a), 1);
    assert_eq!(remote_log(&a), ["first"]);
}

#[test]
fn a_change_reaches_the_remote_with_the_expected_message() {
    let (_tmp, a, _b) = fixture();
    write(&a, "Note.md", "two\n");
    write(&a, "New.md", "new\n");
    let report = run(&a);
    assert!(report.committed && report.pushed && report.problem.is_none());
    assert_eq!(remote_log(&a), [MESSAGE, "first"]);
    assert!(report.status.files.is_empty());
    assert_eq!(report.status.ahead, 0);
}

#[test]
fn it_commits_everything_git_tracks_and_respects_gitignore() {
    let (_tmp, a, _b) = fixture();
    std::fs::create_dir_all(a.join(".obsidian")).unwrap();
    write(&a, ".obsidian/app.json", "{}\n");
    write(&a, ".gitignore", "ignored.md\n");
    write(&a, "ignored.md", "private\n");
    write(&a, "figure.txt", "not a note\n");
    run(&a);
    let files = output(&remote_of(&a), &["ls-tree", "-r", "--name-only", "main"]);
    assert!(
        files.contains(".obsidian/app.json") && files.contains("figure.txt"),
        "{files}"
    );
    assert!(!files.contains("ignored.md"), "{files}");
    assert!(a.join("ignored.md").exists());
}

#[test]
fn offline_commits_here_and_a_later_run_pushes() {
    let (_tmp, a, _b) = fixture();
    write(&a, "Note.md", "written offline\n");
    break_remote(&a, "ssh: Could not resolve hostname example.invalid");
    let report = run(&a);
    assert!(report.committed && !report.pushed);
    assert_eq!(report.problem.unwrap().kind, ErrorKind::Offline);
    assert_eq!(count(&a), 2);
    assert_eq!(remote_log(&a), ["first"]);

    repair_remote(&a);
    let later = run(&a);
    assert!(!later.committed && later.pushed && later.problem.is_none());
    assert_eq!(remote_log(&a), [MESSAGE, "first"]);
}

#[test]
fn auth_failure_keeps_the_local_commit_and_says_so() {
    let (_tmp, a, _b) = fixture();
    write(&a, "Note.md", "two\n");
    break_remote(&a, "git@example.invalid: Permission denied (publickey).");
    let report = run(&a);
    assert!(report.committed && !report.pushed);
    assert_eq!(report.problem.unwrap().kind, ErrorKind::Auth);
    assert_eq!(count(&a), 2);
}

#[test]
fn incoming_commits_fast_forward_before_the_backup_commit() {
    let (_tmp, a, b) = fixture();
    push_from_other_clone(&b, "Other.md");
    write(&a, "Mine.md", "mine\n");
    let report = run(&a);
    assert!(report.committed && report.pushed && report.problem.is_none());
    assert_eq!(remote_log(&a), [MESSAGE, "remote work", "first"]);
    assert_eq!(
        output(&a, &["rev-list", "--merges", "--count", "HEAD"]),
        "0"
    );
    assert!(a.join("Other.md").exists());
}

#[test]
fn a_diverged_branch_stops_but_keeps_the_local_commit() {
    let (_tmp, a, b) = fixture();
    write(&a, "Local.md", "committed here\n");
    git(&a, &["add", "."]);
    git(&a, &["commit", "-qm", "local work"]);
    push_from_other_clone(&b, "Other.md");
    write(&a, "Note.md", "more local work\n");
    let before = output(&remote_of(&a), &["rev-parse", "main"]);
    let report = run(&a);
    assert!(report.committed && !report.pushed);
    assert_eq!(report.problem.unwrap().kind, ErrorKind::Diverged);
    assert_eq!(count(&a), 3);
    assert_eq!(output(&remote_of(&a), &["rev-parse", "main"]), before);
    assert_eq!(
        output(&a, &["rev-list", "--merges", "--count", "HEAD"]),
        "0"
    );
    assert_eq!(output(&a, &["stash", "list"]), "");
}

#[test]
fn incoming_commits_touching_an_edited_note_stop_after_the_local_commit() {
    let (_tmp, a, b) = fixture();
    git(&b, &["pull", "--ff-only", "-q"]);
    write(&b, "Note.md", "changed on the other machine\n");
    git(&b, &["commit", "-qam", "remote edit"]);
    git(&b, &["push", "-q"]);
    write(&a, "Note.md", "changed here\n");
    let report = run(&a);
    assert!(report.committed && !report.pushed);
    assert_eq!(report.problem.unwrap().kind, ErrorKind::Diverged);
    assert_eq!(remote_log(&a), ["remote edit", "first"]);
    assert_eq!(
        std::fs::read_to_string(a.join("Note.md")).unwrap(),
        "changed here\n"
    );
}

#[test]
fn an_unfinished_merge_is_left_exactly_as_it_was() {
    let (_tmp, a, b) = fixture();
    git(&b, &["pull", "--ff-only", "-q"]);
    write(&b, "Note.md", "theirs\n");
    git(&b, &["commit", "-qam", "remote edit"]);
    git(&b, &["push", "-q"]);
    write(&a, "Note.md", "ours\n");
    git(&a, &["commit", "-qam", "local edit"]);
    git(&a, &["fetch", "-q"]);
    let merged = Command::new("git")
        .current_dir(&a)
        .args(["merge", "origin/main"])
        .output()
        .unwrap();
    assert!(!merged.status.success());
    let head = output(&a, &["rev-parse", "HEAD"]);
    let report = run(&a);
    assert!(!report.committed && !report.pushed);
    assert_eq!(report.problem.unwrap().kind, ErrorKind::InProgress);
    assert_eq!(output(&a, &["rev-parse", "HEAD"]), head);
    assert!(a.join(".git/MERGE_HEAD").exists());
}

#[test]
fn an_index_lock_skips_the_run_and_the_next_one_works() {
    let (_tmp, a, _b) = fixture();
    write(&a, "Note.md", "two\n");
    write(&a, ".git/index.lock", "");
    let report = run(&a);
    assert_eq!(report.outcome, BackupOutcome::Locked);
    assert_eq!(count(&a), 1);
    assert_eq!(remote_log(&a), ["first"]);
    std::fs::remove_file(a.join(".git/index.lock")).unwrap();
    assert!(run(&a).pushed);
    assert_eq!(remote_log(&a), [MESSAGE, "first"]);
}

#[test]
fn no_upstream_commits_here_and_reports_it() {
    let (_tmp, a, _b) = fixture();
    git(&a, &["branch", "--unset-upstream"]);
    write(&a, "Note.md", "two\n");
    let report = run(&a);
    assert!(report.committed && !report.pushed);
    assert_eq!(report.problem.unwrap().kind, ErrorKind::NoUpstream);
}

#[test]
fn an_agent_committing_at_the_same_time_loses_nothing() {
    let (_tmp, a, _b) = fixture();
    let agent_dir = a.clone();
    let agent = std::thread::spawn(move || {
        let mut made = 0;
        for i in 0..25 {
            std::fs::write(agent_dir.join(format!("Agent {i}.md")), "agent\n").unwrap();
            let added = Command::new("git")
                .current_dir(&agent_dir)
                .args(["add", &format!("Agent {i}.md")])
                .output()
                .unwrap();
            let done = Command::new("git")
                .current_dir(&agent_dir)
                .args([
                    "-c",
                    "user.name=A",
                    "-c",
                    "user.email=a@example.com",
                    "commit",
                    "-qm",
                    &format!("agent {i}"),
                ])
                .output()
                .unwrap();
            if added.status.success() && done.status.success() {
                made += 1;
            }
        }
        made
    });
    let gate = Arc::new(Mutex::new(()));
    let mut unexpected = Vec::new();
    for i in 0..25 {
        write(&a, &format!("Mine {i}.md"), "mine\n");
        match backup(&a, MESSAGE, &gate) {
            Ok(report) => {
                if let Some(problem) = report.problem {
                    if !problem.message.contains("index.lock") {
                        unexpected.push(problem.message);
                    }
                }
            }
            Err(error) => unexpected.push(error.message),
        }
    }
    let agent_commits = agent.join().unwrap();
    assert!(unexpected.is_empty(), "{unexpected:?}");
    assert!(agent_commits > 0);
    while std::fs::metadata(a.join(".git/index.lock")).is_ok() {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    run(&a);
    let log = output(&a, &["log", "--format=%s"]);
    assert_eq!(
        log.lines().filter(|l| l.starts_with("agent ")).count(),
        agent_commits
    );
    assert_eq!(
        output(&a, &["rev-list", "--merges", "--count", "HEAD"]),
        "0"
    );
    assert_eq!(output(&a, &["status", "--porcelain"]), "");
    assert_eq!(
        output(&a, &["rev-parse", "HEAD"]),
        output(&remote_of(&a), &["rev-parse", "main"])
    );
}
