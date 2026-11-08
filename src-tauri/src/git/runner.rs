use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// How a git process may be supervised.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Mode {
    /// Reads the repository. Safe to stop if it hangs.
    Read,
    /// Changes the index or worktree. Never killed, since stopping it midway can leave a half-updated checkout.
    Write,
    /// Talks to a remote, with SSH prompts disabled.
    Network,
}

impl Mode {
    fn time_limit(self) -> Option<Duration> {
        match self {
            Mode::Read => Some(LOCAL_TIMEOUT),
            Mode::Write => None,
            Mode::Network => Some(NETWORK_TIMEOUT),
        }
    }
}

const NETWORK_TIMEOUT: Duration = Duration::from_secs(90);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const MAX_OUTPUT: usize = 4 * 1024 * 1024;

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
    /// An application error that did not come from git, so its text is not matched against git's messages.
    pub fn other(message: impl Into<String>) -> Self {
        GitError::new(ErrorKind::Other, message)
    }

    pub(super) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        GitError {
            kind,
            message: redact(&message.into()),
        }
    }
}

pub type GitResult<T> = Result<T, GitError>;

pub(super) fn base_command(root: &Path, mode: Mode) -> Command {
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
    if mode == Mode::Network
        && !has_config(root, "core.sshCommand")
        && std::env::var_os("GIT_SSH_COMMAND").is_none()
    {
        cmd.env(
            "GIT_SSH_COMMAND",
            "ssh -o BatchMode=yes -o ConnectTimeout=15",
        );
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

pub(super) struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

pub(super) fn run(root: &Path, args: &[&str], mode: Mode) -> GitResult<Output> {
    run_with_input(root, args, mode, None)
}

pub(super) fn run_with_input(
    root: &Path,
    args: &[&str],
    mode: Mode,
    input: Option<&str>,
) -> GitResult<Output> {
    let mut cmd = base_command(root, mode);
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
        let _ = stdout
            .by_ref()
            .take(MAX_OUTPUT as u64 + 1)
            .read_to_end(&mut buf);
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });
    let limit = mode.time_limit();
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if limit.is_some_and(|l| start.elapsed() > l) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitError::new(
                    ErrorKind::Timeout,
                    format!(
                        "git {} took longer than {}s and was stopped",
                        args[0],
                        limit.unwrap_or_default().as_secs()
                    ),
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(GitError::new(ErrorKind::Other, e.to_string())),
        }
    };
    let out = out_reader.join().unwrap_or_default();
    if out.len() > MAX_OUTPUT {
        return Err(GitError::new(
            ErrorKind::Other,
            format!("The output of git {} is too large to show.", args[0]),
        ));
    }
    Ok(Output {
        ok: status.success(),
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr: String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).into_owned(),
    })
}

pub(super) fn checked(root: &Path, args: &[&str], mode: Mode) -> GitResult<String> {
    let out = run(root, args, mode)?;
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
    } else if s.contains("would be overwritten by merge")
        || s.contains("your local changes to the following files")
    {
        ErrorKind::LocalChangesBlock
    } else if s.contains("not possible to fast-forward") || s.contains("diverging branches") {
        ErrorKind::Diverged
    } else if s.contains("[rejected]")
        || s.contains("non-fast-forward")
        || s.contains("fetch first")
        || s.contains("failed to push")
    {
        ErrorKind::Rejected
    } else if s.contains("no upstream")
        || s.contains("no tracking information")
        || s.contains("does not point to a branch")
    {
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
    GitError::new(
        kind,
        if message.is_empty() {
            "git failed without a message".to_string()
        } else {
            message
        },
    )
}

/// Removes credentials from URLs and masks common token shapes before text
/// reaches the UI or diagnostics.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find("://") {
        let (head, tail) = rest.split_at(idx + 3);
        out.push_str(head);
        let end = tail
            .find(|c: char| c.is_whitespace() || c == '\'' || c == '"')
            .unwrap_or(tail.len());
        let url = &tail[..end];
        let authority_end = url.find('/').unwrap_or(url.len());
        let authority = &url[..authority_end];
        // A password may itself contain "/", which ends the authority early but leaves "user:pa" before it.
        let userinfo_end = authority
            .rfind('@')
            .or_else(|| authority.contains(':').then(|| url.rfind('@')).flatten());
        match userinfo_end {
            Some(at) => {
                out.push_str("***@");
                out.push_str(&url[at + 1..]);
            }
            None => out.push_str(url),
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    let prefixes = [
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "github_pat_",
        "glpat-",
        "xoxb-",
        "xoxp-",
    ];
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
