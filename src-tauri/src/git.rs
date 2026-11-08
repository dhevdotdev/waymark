//! Git through the system `git` binary, so the user's own configuration,
//! credential helpers (macOS Keychain) and SSH agent apply unchanged.
//!
//! Safety rules: nothing here resets, stashes, force-pushes, rebases or creates
//! merge commits. Incoming changes apply only as fast-forwards, and every
//! write to history is an explicit user action.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

const NETWORK_TIMEOUT: Duration = Duration::from_secs(90);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Offline,
    Auth,
    Diverged,
    LocalChangesBlock,
    Rejected,
    NotARepo,
    NoUpstream,
    InProgress,
    Timeout,
    Other,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    pub kind: ErrorKind,
    pub message: String,
}

impl GitError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        GitError { kind, message: redact(&message.into()) }
    }
}

type GitResult<T> = Result<T, GitError>;

fn base_command(root: &Path, network: bool) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if network && !has_config(root, "core.sshCommand") && std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15");
    }
    cmd
}

/// Apps launched from Finder get a minimal PATH; credential helpers and git-lfs
/// usually live in Homebrew's prefix.
fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<&str> = current.split(':').filter(|p| !p.is_empty()).collect();
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        if !parts.contains(&extra) {
            parts.push(extra);
        }
    }
    parts.join(":")
}

fn has_config(root: &Path, key: &str) -> bool {
    Command::new("git")
        .current_dir(root)
        .args(["config", "--get", key])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

struct Output {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn run(root: &Path, args: &[&str], network: bool) -> GitResult<Output> {
    run_with_input(root, args, network, None)
}

fn run_with_input(root: &Path, args: &[&str], network: bool, input: Option<&str>) -> GitResult<Output> {
    let mut cmd = base_command(root, network);
    cmd.args(args);
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| GitError::new(ErrorKind::Other, format!("Could not start git: {e}")))?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        let _ = stdin.write_all(text.as_bytes());
    }
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.by_ref().take(MAX_OUTPUT as u64).read_to_end(&mut buf);
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });
    let limit = if network { NETWORK_TIMEOUT } else { LOCAL_TIMEOUT };
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitError::new(ErrorKind::Timeout, format!("git {} took longer than {}s and was stopped", args[0], limit.as_secs())));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(GitError::new(ErrorKind::Other, e.to_string())),
        }
    };
    Ok(Output {
        ok: status.success(),
        stdout: String::from_utf8_lossy(&out_reader.join().unwrap_or_default()).into_owned(),
        stderr: String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).into_owned(),
    })
}

fn checked(root: &Path, args: &[&str], network: bool) -> GitResult<String> {
    let out = run(root, args, network)?;
    if out.ok {
        Ok(out.stdout)
    } else {
        Err(classify(&out.stderr))
    }
}

pub fn classify(stderr: &str) -> GitError {
    let s = stderr.to_ascii_lowercase();
    let kind = if s.contains("not a git repository") {
        ErrorKind::NotARepo
    } else if s.contains("permission denied (publickey")
        || s.contains("authentication failed")
        || s.contains("could not read username")
        || s.contains("could not read password")
        || s.contains("terminal prompts disabled")
        || s.contains("the requested url returned error: 401")
        || s.contains("the requested url returned error: 403")
        || s.contains("host key verification failed")
    {
        ErrorKind::Auth
    } else if s.contains("could not resolve host")
        || s.contains("network is unreachable")
        || s.contains("connection timed out")
        || s.contains("operation timed out")
        || s.contains("failed to connect")
        || s.contains("connection refused")
        || s.contains("no route to host")
        || s.contains("could not resolve hostname")
    {
        ErrorKind::Offline
    } else if s.contains("would be overwritten by merge") || s.contains("your local changes to the following files") {
        ErrorKind::LocalChangesBlock
    } else if s.contains("not possible to fast-forward") || s.contains("diverging branches") {
        ErrorKind::Diverged
    } else if s.contains("[rejected]") || s.contains("non-fast-forward") || s.contains("fetch first") || s.contains("failed to push") {
        ErrorKind::Rejected
    } else if s.contains("no upstream") || s.contains("no tracking information") || s.contains("does not point to a branch") {
        ErrorKind::NoUpstream
    } else {
        ErrorKind::Other
    };
    let message = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("hint:"))
        .collect::<Vec<_>>()
        .join("\n");
    GitError::new(kind, if message.is_empty() { "git failed without a message".to_string() } else { message })
}

/// Removes credentials from URLs and masks common token shapes before text
/// reaches the UI or diagnostics.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find("://") {
        let (head, tail) = rest.split_at(idx + 3);
        out.push_str(head);
        let end = tail.find(|c: char| c.is_whitespace() || c == '/' || c == '\'' || c == '"').unwrap_or(tail.len());
        let authority = &tail[..end];
        match authority.rfind('@') {
            Some(at) => {
                out.push_str("***@");
                out.push_str(&authority[at + 1..]);
            }
            None => out.push_str(authority),
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    let prefixes = ["ghp_", "gho_", "ghu_", "ghs_", "github_pat_", "glpat-", "xoxb-", "xoxp-"];
    let mut masked = String::with_capacity(out.len());
    let mut i = 0;
    let bytes = out.as_bytes();
    while i < out.len() {
        if let Some(p) = prefixes.iter().find(|p| out[i..].starts_with(**p)) {
            masked.push_str(p);
            masked.push_str("***");
            i += p.len();
            while i < out.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
        } else {
            let ch = out[i..].chars().next().unwrap();
            masked.push(ch);
            i += ch.len_utf8();
        }
    }
    masked
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub orig_path: Option<String>,
    /// Staged state: one of M A D R C T, or "." when unchanged.
    pub staged: String,
    /// Working-tree state, or "?" for untracked files.
    pub unstaged: String,
    pub conflicted: bool,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub remote_url: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileChange>,
    /// "merge", "rebase", "cherry-pick" or "revert" when one is unfinished.
    pub operation: Option<String>,
}

pub fn status(root: &Path) -> GitResult<Status> {
    if !root.join(".git").exists() {
        return Ok(Status::default());
    }
    let raw = checked(root, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], false)?;
    let mut st = parse_status(&raw);
    st.is_repo = true;
    let git_dir = root.join(".git");
    st.operation = if git_dir.join("MERGE_HEAD").exists() {
        Some("merge".into())
    } else if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        Some("rebase".into())
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        Some("cherry-pick".into())
    } else if git_dir.join("REVERT_HEAD").exists() {
        Some("revert".into())
    } else {
        None
    };
    if let Some(upstream) = &st.upstream {
        let remote = upstream.split('/').next().unwrap_or("origin");
        if let Ok(url) = checked(root, &["remote", "get-url", remote], false) {
            st.remote_url = Some(redact(url.trim()));
        }
    } else if let Ok(url) = checked(root, &["remote", "get-url", "origin"], false) {
        st.remote_url = Some(redact(url.trim()));
    }
    Ok(st)
}

pub fn parse_status(raw: &str) -> Status {
    let mut st = Status::default();
    let mut records = raw.split('\0').peekable();
    while let Some(rec) = records.next() {
        if rec.is_empty() {
            continue;
        }
        if let Some(h) = rec.strip_prefix("# branch.head ") {
            st.branch = (h != "(detached)").then(|| h.to_string());
        } else if let Some(h) = rec.strip_prefix("# branch.oid ") {
            st.head = (h != "(initial)").then(|| h.to_string());
        } else if let Some(u) = rec.strip_prefix("# branch.upstream ") {
            st.upstream = Some(u.to_string());
        } else if let Some(ab) = rec.strip_prefix("# branch.ab ") {
            for part in ab.split(' ') {
                if let Some(n) = part.strip_prefix('+') {
                    st.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    st.behind = n.parse().unwrap_or(0);
                }
            }
        } else if let Some(path) = rec.strip_prefix("? ") {
            st.files.push(FileChange { path: path.into(), staged: ".".into(), unstaged: "?".into(), ..Default::default() });
        } else if rec.starts_with("1 ") || rec.starts_with("2 ") || rec.starts_with("u ") {
            let kind = &rec[..1];
            let fields_before_path = match kind {
                "1" => 8,
                "2" => 9,
                _ => 10,
            };
            let parts: Vec<&str> = rec.splitn(fields_before_path + 1, ' ').collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let path = parts.get(fields_before_path).copied().unwrap_or("").to_string();
            let orig_path = if kind == "2" { records.next().map(str::to_string) } else { None };
            st.files.push(FileChange {
                path,
                orig_path,
                staged: xy[..1].to_string(),
                unstaged: xy[1..2].to_string(),
                conflicted: kind == "u",
            });
        }
    }
    st
}

pub fn fetch(root: &Path) -> GitResult<Status> {
    let st = status(root)?;
    let remote = st
        .upstream
        .as_deref()
        .and_then(|u| u.split('/').next())
        .unwrap_or("origin")
        .to_string();
    checked(root, &["fetch", "--prune", "--no-recurse-submodules", &remote], true)?;
    status(root)
}

/// Applies incoming commits only when that is a fast-forward.
pub fn fast_forward(root: &Path) -> GitResult<Status> {
    let st = status(root)?;
    if let Some(op) = &st.operation {
        return Err(GitError::new(ErrorKind::InProgress, format!("A {op} is unfinished in this repository. Finish or abort it in a terminal first.")));
    }
    if st.upstream.is_none() {
        return Err(GitError::new(ErrorKind::NoUpstream, "This branch has no upstream branch to update from."));
    }
    if st.behind == 0 {
        return Ok(st);
    }
    if st.ahead > 0 {
        return Err(GitError::new(
            ErrorKind::Diverged,
            format!("Local and remote histories have diverged: {} local and {} remote commits. Waymark will not merge or rebase them.", st.ahead, st.behind),
        ));
    }
    checked(root, &["merge", "--ff-only", "--no-edit", "@{upstream}"], false)?;
    status(root)
}

pub fn push(root: &Path) -> GitResult<Status> {
    let st = status(root)?;
    if st.upstream.is_none() {
        return Err(GitError::new(ErrorKind::NoUpstream, "This branch has no upstream branch to push to."));
    }
    if st.behind > 0 {
        return Err(GitError::new(ErrorKind::Rejected, "The remote has commits you do not have. Update first; Waymark never force-pushes."));
    }
    checked(root, &["push", "--porcelain"], true)?;
    status(root)
}

pub fn stage(root: &Path, paths: &[String]) -> GitResult<Status> {
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    checked(root, &args, false)?;
    status(root)
}

/// Removes paths from the index only. The working tree is never touched.
pub fn unstage(root: &Path, paths: &[String]) -> GitResult<Status> {
    let st = status(root)?;
    let mut args: Vec<&str> = if st.head.is_some() { vec!["restore", "--staged", "--"] } else { vec!["rm", "--cached", "--quiet", "--"] };
    args.extend(paths.iter().map(String::as_str));
    checked(root, &args, false)?;
    status(root)
}

pub fn commit(root: &Path, message: &str) -> GitResult<Status> {
    let message = message.trim();
    if message.is_empty() {
        return Err(GitError::new(ErrorKind::Other, "A commit needs a message."));
    }
    let st = status(root)?;
    if !st.files.iter().any(|f| f.staged != "." && f.staged != "?") {
        return Err(GitError::new(ErrorKind::Other, "Nothing is staged."));
    }
    let out = run_with_input(root, &["commit", "--file=-"], false, Some(message))?;
    if !out.ok {
        return Err(classify(if out.stderr.trim().is_empty() { &out.stdout } else { &out.stderr }));
    }
    status(root)
}

pub fn diff_worktree(root: &Path, path: &str, staged: bool, untracked: bool) -> GitResult<String> {
    if untracked {
        let out = run(root, &["diff", "--no-index", "--", "/dev/null", path], false)?;
        return Ok(out.stdout);
    }
    let mut args = vec!["diff", "--no-color", "--find-renames"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    checked(root, &args, false)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
    /// The note's path at this commit, when following a renamed file.
    pub path: Option<String>,
}

pub fn log(root: &Path, path: Option<&str>, limit: u32, skip: u32) -> GitResult<Vec<Commit>> {
    let limit_arg = format!("-n{limit}");
    let skip_arg = format!("--skip={skip}");
    let mut args = vec!["log", "--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s", limit_arg.as_str(), skip_arg.as_str()];
    if let Some(p) = path {
        args.extend(["--follow", "--name-only", "--", p]);
    }
    let out = run(root, &args, false)?;
    if !out.ok {
        if out.stderr.contains("does not have any commits") {
            return Ok(vec![]);
        }
        return Err(classify(&out.stderr));
    }
    Ok(out
        .stdout
        .split('\u{1e}')
        .filter(|r| !r.trim().is_empty())
        .filter_map(|r| {
            let mut lines = r.lines();
            let header = lines.next()?;
            let f: Vec<&str> = header.split('\u{1f}').collect();
            let file = lines.map(str::trim).find(|l| !l.is_empty()).map(str::to_string);
            Some(Commit {
                sha: f.first()?.to_string(),
                short: f.get(1)?.to_string(),
                author: f.get(2)?.to_string(),
                date: f.get(3)?.to_string(),
                subject: f.get(4).unwrap_or(&"").to_string(),
                path: file,
            })
        })
        .collect())
}

fn valid_rev(rev: &str) -> GitResult<()> {
    if rev.len() >= 4 && rev.len() <= 64 && rev.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(GitError::new(ErrorKind::Other, "Invalid revision"))
    }
}

/// The patch a commit introduced, optionally limited to one path.
pub fn show_commit(root: &Path, sha: &str, path: Option<&str>) -> GitResult<String> {
    valid_rev(sha)?;
    let mut args = vec!["show", "--no-color", "--format=", "--find-renames", "--patch", sha];
    if let Some(p) = path {
        args.extend(["--", p]);
    }
    checked(root, &args, false)
}

pub fn file_at(root: &Path, sha: &str, path: &str) -> GitResult<String> {
    valid_rev(sha)?;
    let spec = format!("{sha}:{path}");
    checked(root, &["show", spec.as_str()], false)
}

pub fn diff_revs(root: &Path, from: &str, to: &str, path: &str) -> GitResult<String> {
    valid_rev(from)?;
    valid_rev(to)?;
    checked(root, &["diff", "--no-color", "--find-renames", from, to, "--", path], false)
}

/// Stores HTTPS credentials through the user's configured credential helper
/// (the macOS Keychain with Apple's git). Waymark never keeps them itself.
pub fn store_credential(root: &Path, url: &str, username: &str, secret: &str) -> GitResult<()> {
    let (protocol, rest) = url.split_once("://").ok_or_else(|| GitError::new(ErrorKind::Other, "Only HTTPS remotes use stored passwords"))?;
    if protocol != "https" {
        return Err(GitError::new(ErrorKind::Other, "Only HTTPS remotes use stored passwords; SSH remotes use your SSH agent"));
    }
    let host = rest.split('/').next().unwrap_or_default().rsplit('@').next().unwrap_or_default();
    if host.is_empty() || username.contains('\n') || secret.contains('\n') {
        return Err(GitError::new(ErrorKind::Other, "Invalid credential"));
    }
    let input = format!("protocol=https\nhost={host}\nusername={username}\npassword={secret}\n\n");
    let out = run_with_input(root, &["credential", "approve"], false, Some(&input))?;
    if out.ok { Ok(()) } else { Err(classify(&out.stderr)) }
}

pub fn clone(url: &str, dest: &Path, mut progress: impl FnMut(String)) -> GitResult<()> {
    if dest.exists() && std::fs::read_dir(dest).map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(GitError::new(ErrorKind::Other, "Choose an empty or new folder to clone into."));
    }
    let parent = dest.parent().ok_or_else(|| GitError::new(ErrorKind::Other, "Invalid destination"))?;
    std::fs::create_dir_all(parent).map_err(|e| GitError::new(ErrorKind::Other, e.to_string()))?;
    let mut cmd = base_command(parent, true);
    cmd.args(["clone", "--progress", "--", url]).arg(dest);
    let mut child = cmd.spawn().map_err(|e| GitError::new(ErrorKind::Other, format!("Could not start git: {e}")))?;
    let stderr = child.stderr.take().unwrap();
    let mut all = String::new();
    let mut reader = BufReader::new(stderr);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = reader.read_until(b'\r', &mut buf).unwrap_or(0);
        if n == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buf).into_owned();
        for line in chunk.split('\n') {
            let line = line.trim_matches(['\r', ' ']);
            if !line.is_empty() {
                progress(redact(line));
            }
        }
        all.push_str(&chunk);
    }
    let status = child.wait().map_err(|e| GitError::new(ErrorKind::Other, e.to_string()))?;
    if status.success() { Ok(()) } else { Err(classify(&all)) }
}

#[cfg(test)]
mod tests {
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
        git(tmp.path(), &["init", "--bare", "-b", "main", remote.to_str().unwrap()]);
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        git(tmp.path(), &["clone", remote.to_str().unwrap(), a.to_str().unwrap()]);
        for (k, v) in [("user.name", "T"), ("user.email", "t@example.com")] {
            git(&a, &["config", k, v]);
        }
        git(&a, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        write(&a, "Note.md", "one\n");
        git(&a, &["add", "."]);
        git(&a, &["commit", "-m", "first"]);
        git(&a, &["push", "-u", "origin", "main"]);
        git(tmp.path(), &["clone", remote.to_str().unwrap(), b.to_str().unwrap()]);
        for (k, v) in [("user.name", "T"), ("user.email", "t@example.com")] {
            git(&b, &["config", k, v]);
        }
        (tmp, a, b)
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
        assert_eq!(std::fs::read_to_string(b.join("Note.md")).unwrap(), "my unsaved edit\n");
    }

    #[test]
    fn stages_commits_and_pushes_only_on_request() {
        let (_t, a, _b) = fixture();
        write(&a, "New.md", "new\n");
        let st = status(&a).unwrap();
        assert!(st.files.iter().any(|f| f.path == "New.md" && f.unstaged == "?"));
        assert!(commit(&a, "nothing staged").is_err());
        stage(&a, &["New.md".into()]).unwrap();
        let st = unstage(&a, &["New.md".into()]).unwrap();
        assert!(st.files.iter().any(|f| f.path == "New.md" && f.unstaged == "?"));
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
        assert_eq!(commits.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["second", "first"]);
        assert_eq!(file_at(&a, &commits[1].sha, "Note.md").unwrap(), "one\n");
        let diff = diff_revs(&a, &commits[1].sha, &commits[0].sha, "Note.md").unwrap();
        assert!(diff.contains("-one") && diff.contains("+two"));
        assert!(show_commit(&a, "--output=/tmp/x", None).is_err());
    }

    #[test]
    fn reports_offline_remotes() {
        let (_t, a, _b) = fixture();
        git(&a, &["remote", "set-url", "origin", "https://folio-test.invalid/repo.git"]);
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
        assert_eq!(redact("fatal: https://me:s3cret@host.com/r.git failed"), "fatal: https://***@host.com/r.git failed");
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
}
