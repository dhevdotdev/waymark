//! The optional scheduled backup. It only ever commits, fast-forwards and pushes,
//! with the same limits as a manual sync: no force-push, reset, stash, rebase or merge.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use super::runner::{Mode, checked};
use super::{ErrorKind, GitError, GitResult, Status, commit, fast_forward, fetch, push, status};

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum BackupOutcome {
    /// Another Git process holds the index, so this run did nothing.
    Locked,
    /// Nothing to commit and nothing to push.
    Nothing,
    Ran,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub outcome: BackupOutcome,
    pub committed: bool,
    pub pushed: bool,
    pub problem: Option<GitError>,
    pub status: Status,
}

fn index_is_locked(root: &Path) -> GitResult<bool> {
    let out = checked(root, &["rev-parse", "--git-path", "index.lock"], Mode::Read)?;
    Ok(root.join(out.trim()).exists())
}

/// Another Git process, such as an agent committing in this vault, got there first.
fn lost_the_lock(error: &GitError) -> bool {
    let message = error.message.to_ascii_lowercase();
    message.contains("index.lock")
        || message.contains("cannot lock ref")
        || (message.contains("unable to create") && message.contains(".lock"))
}

fn report(outcome: BackupOutcome, status: Status) -> BackupReport {
    BackupReport {
        outcome,
        committed: false,
        pushed: false,
        problem: None,
        status,
    }
}

fn already_committed(error: &GitError) -> bool {
    error.message == "Nothing is staged."
        || error.message.contains("nothing added to commit")
        || error.message.contains("nothing to commit")
        || error.message.contains("no changes added to commit")
}

/// Stages everything Git would track and commits it. False means no change survived staging.
fn commit_everything(root: &Path, message: &str) -> GitResult<(bool, Status)> {
    checked(root, &["add", "-A"], Mode::Write)?;
    let staged = status(root)?;
    if !staged
        .files
        .iter()
        .any(|f| f.staged != "." && f.staged != "?")
    {
        return Ok((false, staged));
    }
    match commit(root, message) {
        Ok(after) => Ok((true, after)),
        /* Another process committed what was just staged, so the work is already safe. */
        Err(error) if already_committed(&error) => Ok((false, status(root)?)),
        Err(error) => Err(error),
    }
}

/**
 * One backup run. Incoming commits are brought in first when that is a
 * fast-forward, because committing first would turn every remote change into
 * a divergence that only a terminal can resolve. Whatever happens on the
 * network, local work is still committed, unless an unfinished operation means
 * a commit would complete it.
 *
 * `gate` serialises local writes with note saves, and is released for the
 * network so that saving a note never waits on the remote.
 */
pub fn backup(root: &Path, message: &str, gate: &Mutex<()>) -> GitResult<BackupReport> {
    let locked = |status: Status| Ok(report(BackupOutcome::Locked, status));
    let st = status(root)?;
    if !st.is_repo {
        return Err(GitError::new(
            ErrorKind::NotARepo,
            "This vault is not a Git repository.",
        ));
    }
    if index_is_locked(root)? {
        return locked(st);
    }
    if st.operation.is_some() || st.files.iter().any(|f| f.conflicted) {
        let what = st.operation.clone().unwrap_or_else(|| "merge".into());
        let problem = GitError::new(
            ErrorKind::InProgress,
            format!("A {what} is unfinished, so the backup did not commit anything."),
        );
        let mut stopped = report(BackupOutcome::Ran, st);
        stopped.problem = Some(problem);
        return Ok(stopped);
    }
    if st.files.is_empty() && st.ahead == 0 {
        return Ok(report(BackupOutcome::Nothing, st));
    }

    let mut problem = None;
    let mut current = st;
    if current.upstream.is_some() {
        match fetch(root) {
            Ok(fetched) => current = fetched,
            Err(error) => problem = Some(error),
        }
    } else {
        problem = Some(GitError::new(
            ErrorKind::NoUpstream,
            "This branch has no upstream branch to back up to.",
        ));
    }

    if problem.is_none() && current.behind > 0 && current.ahead == 0 {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        match fast_forward(root) {
            Ok(updated) => current = updated,
            Err(error) if lost_the_lock(&error) => return locked(current),
            /* Incoming commits touch notes changed here. Committing keeps the work, and the divergence is reported below. */
            Err(error) if error.kind == ErrorKind::LocalChangesBlock => {}
            Err(error) => problem = Some(error),
        }
    }

    let mut committed = false;
    if !current.files.is_empty() {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        match commit_everything(root, message) {
            Ok((made, after)) => {
                committed = made;
                current = after;
            }
            Err(error) if lost_the_lock(&error) => return locked(current),
            Err(error) => problem = Some(error),
        }
    }

    let mut pushed = false;
    if problem.is_none() && current.upstream.is_some() {
        if current.behind > 0 && current.ahead > 0 {
            problem = Some(GitError::new(
                ErrorKind::Diverged,
                format!(
                    "Local and remote histories have diverged: {} local and {} remote commits.",
                    current.ahead, current.behind
                ),
            ));
        } else if current.ahead > 0 {
            match push(root) {
                Ok(after) => {
                    current = after;
                    pushed = true;
                }
                Err(error) => problem = Some(error),
            }
        }
    }

    Ok(BackupReport {
        outcome: BackupOutcome::Ran,
        committed,
        pushed,
        problem,
        status: current,
    })
}
