//! Git through the system `git` binary, so the user's own configuration,
//! credential helpers (macOS Keychain) and SSH agent apply unchanged.
//!
//! Safety rules: nothing here resets, stashes, force-pushes, rebases or creates
//! merge commits. Incoming changes apply only as fast-forwards, and every
//! write to history is an explicit user action or a backup the user turned on.

use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::Serialize;

mod backup;
#[cfg(test)]
mod backup_tests;
mod runner;
#[cfg(test)]
mod tests;

pub use backup::{BackupReport, backup};
pub use runner::{ErrorKind, GitError, GitResult, redact};
use runner::{Mode, base_command, checked, classify, run, run_with_input};

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
    let raw = checked(
        root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
        Mode::Read,
    )?;
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
        if let Ok(url) = checked(root, &["remote", "get-url", "--", remote], Mode::Read) {
            st.remote_url = Some(redact(url.trim()));
        }
    } else if let Ok(url) = checked(root, &["remote", "get-url", "--", "origin"], Mode::Read) {
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
            st.files.push(FileChange {
                path: path.into(),
                staged: ".".into(),
                unstaged: "?".into(),
                ..Default::default()
            });
        } else if rec.starts_with("1 ") || rec.starts_with("2 ") || rec.starts_with("u ") {
            let kind = &rec[..1];
            let fields_before_path = match kind {
                "1" => 8,
                "2" => 9,
                _ => 10,
            };
            let parts: Vec<&str> = rec.splitn(fields_before_path + 1, ' ').collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let path = parts
                .get(fields_before_path)
                .copied()
                .unwrap_or("")
                .to_string();
            let orig_path = if kind == "2" {
                records.next().map(str::to_string)
            } else {
                None
            };
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

fn ensure_no_operation(st: &Status) -> GitResult<()> {
    match &st.operation {
        Some(op) => Err(GitError::new(
            ErrorKind::InProgress,
            format!(
                "A {op} is unfinished in this repository. Finish or abort it in a terminal first."
            ),
        )),
        None => Ok(()),
    }
}

pub fn fetch(root: &Path) -> GitResult<Status> {
    let st = status(root)?;
    let remote = st
        .upstream
        .as_deref()
        .and_then(|u| u.split('/').next())
        .unwrap_or("origin")
        .to_string();
    checked(
        root,
        &["fetch", "--prune", "--no-recurse-submodules", "--", &remote],
        Mode::Network,
    )?;
    status(root)
}

/// Applies incoming commits only when that is a fast-forward.
pub fn fast_forward(root: &Path) -> GitResult<Status> {
    let st = status(root)?;
    ensure_no_operation(&st)?;
    if st.upstream.is_none() {
        return Err(GitError::new(
            ErrorKind::NoUpstream,
            "This branch has no upstream branch to update from.",
        ));
    }
    if st.behind == 0 {
        return Ok(st);
    }
    if st.ahead > 0 {
        return Err(GitError::new(
            ErrorKind::Diverged,
            format!(
                "Local and remote histories have diverged: {} local and {} remote commits. Waymark will not merge or rebase them.",
                st.ahead, st.behind
            ),
        ));
    }
    checked(
        root,
        &["merge", "--ff-only", "--no-edit", "@{upstream}"],
        Mode::Write,
    )?;
    status(root)
}

pub fn push(root: &Path) -> GitResult<Status> {
    let st = status(root)?;
    if st.upstream.is_none() {
        return Err(GitError::new(
            ErrorKind::NoUpstream,
            "This branch has no upstream branch to push to.",
        ));
    }
    if st.behind > 0 {
        return Err(GitError::new(
            ErrorKind::Rejected,
            "The remote has commits you do not have. Update first; Waymark never force-pushes.",
        ));
    }
    checked(root, &["push", "--porcelain"], Mode::Network)?;
    status(root)
}

pub fn stage(root: &Path, paths: &[String]) -> GitResult<Status> {
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    checked(root, &args, Mode::Write)?;
    status(root)
}

/// Removes paths from the index only. The working tree is never touched.
pub fn unstage(root: &Path, paths: &[String]) -> GitResult<Status> {
    let st = status(root)?;
    let mut args: Vec<&str> = if st.head.is_some() {
        vec!["restore", "--staged", "--"]
    } else {
        vec!["rm", "--cached", "--quiet", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    checked(root, &args, Mode::Write)?;
    status(root)
}

pub fn commit(root: &Path, message: &str) -> GitResult<Status> {
    let message = message.trim();
    if message.is_empty() {
        return Err(GitError::new(ErrorKind::Other, "A commit needs a message."));
    }
    let st = status(root)?;
    ensure_no_operation(&st)?;
    if !st.files.iter().any(|f| f.staged != "." && f.staged != "?") {
        return Err(GitError::new(ErrorKind::Other, "Nothing is staged."));
    }
    let out = run_with_input(root, &["commit", "--file=-"], Mode::Write, Some(message))?;
    if !out.ok {
        return Err(classify(if out.stderr.trim().is_empty() {
            &out.stdout
        } else {
            &out.stderr
        }));
    }
    status(root)
}

pub fn diff_worktree(root: &Path, path: &str, staged: bool, untracked: bool) -> GitResult<String> {
    if untracked {
        let inside = crate::vault::relative_in_repo(root, path)
            .map_err(|e| GitError::new(ErrorKind::Other, e))?;
        let out = run(
            root,
            &[
                "diff",
                "--no-color",
                "--no-index",
                "--",
                "/dev/null",
                &inside,
            ],
            Mode::Read,
        )?;
        return Ok(out.stdout);
    }
    let mut args = vec!["diff", "--no-color", "--find-renames"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    checked(root, &args, Mode::Read)
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
    let mut args = vec![
        "log",
        "--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s",
        limit_arg.as_str(),
        skip_arg.as_str(),
    ];
    if let Some(p) = path {
        args.extend(["--follow", "--name-only", "--", p]);
    }
    let out = run(root, &args, Mode::Read)?;
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
            let file = lines
                .map(str::trim)
                .find(|l| !l.is_empty())
                .map(str::to_string);
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
    let mut args = vec![
        "show",
        "--no-color",
        "--format=",
        "--find-renames",
        "--patch",
        sha,
    ];
    if let Some(p) = path {
        args.extend(["--", p]);
    }
    checked(root, &args, Mode::Read)
}

pub fn file_at(root: &Path, sha: &str, path: &str) -> GitResult<String> {
    valid_rev(sha)?;
    let spec = format!("{sha}:{path}");
    checked(root, &["show", spec.as_str()], Mode::Read)
}

pub fn diff_revs(root: &Path, from: &str, to: &str, path: &str) -> GitResult<String> {
    valid_rev(from)?;
    valid_rev(to)?;
    checked(
        root,
        &["diff", "--no-color", "--find-renames", from, to, "--", path],
        Mode::Read,
    )
}

/// Stores HTTPS credentials through the user's configured credential helper
/// (the macOS Keychain with Apple's git). Waymark never keeps them itself.
pub fn store_credential(root: &Path, url: &str, username: &str, secret: &str) -> GitResult<()> {
    let (protocol, rest) = url.split_once("://").ok_or_else(|| {
        GitError::new(ErrorKind::Other, "Only HTTPS remotes use stored passwords")
    })?;
    if protocol != "https" {
        return Err(GitError::new(
            ErrorKind::Other,
            "Only HTTPS remotes use stored passwords; SSH remotes use your SSH agent",
        ));
    }
    let host = rest
        .split('/')
        .next()
        .unwrap_or_default()
        .rsplit('@')
        .next()
        .unwrap_or_default();
    if host.is_empty()
        || [url, username, secret]
            .iter()
            .any(|v| v.chars().any(char::is_control))
    {
        return Err(GitError::new(ErrorKind::Other, "Invalid credential"));
    }
    let input = format!("protocol=https\nhost={host}\nusername={username}\npassword={secret}\n\n");
    let out = run_with_input(root, &["credential", "approve"], Mode::Write, Some(&input))?;
    if out.ok {
        Ok(())
    } else {
        Err(classify(&out.stderr))
    }
}

pub fn clone(url: &str, dest: &Path, mut progress: impl FnMut(String)) -> GitResult<()> {
    if dest.exists()
        && std::fs::read_dir(dest)
            .map(|mut d| d.next().is_some())
            .unwrap_or(true)
    {
        return Err(GitError::new(
            ErrorKind::Other,
            "Choose an empty or new folder to clone into.",
        ));
    }
    let parent = dest
        .parent()
        .ok_or_else(|| GitError::new(ErrorKind::Other, "Invalid destination"))?;
    std::fs::create_dir_all(parent).map_err(|e| GitError::new(ErrorKind::Other, e.to_string()))?;
    let mut cmd = base_command(parent, Mode::Network);
    cmd.args(["clone", "--progress", "--", url]).arg(dest);
    let mut child = cmd
        .spawn()
        .map_err(|e| GitError::new(ErrorKind::Other, format!("Could not start git: {e}")))?;
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
    let status = child
        .wait()
        .map_err(|e| GitError::new(ErrorKind::Other, e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(classify(&all))
    }
}
