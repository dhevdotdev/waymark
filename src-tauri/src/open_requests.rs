//! Notes handed to Waymark from outside: a Markdown file opened from Finder or `open`, or a
//! `waymark://open?path=…&heading=…` link. A request only ever navigates. Every part of a URL is
//! untrusted, so it is checked here and the frontend resolves a vault-relative path through its
//! index, never by reading the path it was given.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url};

const LONGEST_PARAMETER: usize = 4096;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpenRequest {
    /// A file on disk, by its resolved absolute path.
    File {
        path: String,
        heading: Option<String>,
    },
    /// A note named relative to whichever vault is open, as a path or as a link would name it.
    InVault {
        path: String,
        heading: Option<String>,
    },
    Refused {
        reason: String,
    },
}

/// Requests that arrived before the page could take them, as at a cold start.
#[derive(Default)]
pub struct Pending(Mutex<Vec<OpenRequest>>);

pub fn receive<R: Runtime>(app: &AppHandle<R>, urls: &[Url]) {
    let requests: Vec<OpenRequest> = urls.iter().map(parse).collect();
    if requests.is_empty() {
        return;
    }
    if let Some(pending) = app.try_state::<Pending>() {
        pending
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .extend(requests);
    }
    let _ = app.emit_to("main", "open-requests", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn take_open_requests(pending: State<'_, Pending>) -> Vec<OpenRequest> {
    std::mem::take(&mut *pending.0.lock().unwrap_or_else(|e| e.into_inner()))
}

fn refused(reason: impl Into<String>) -> OpenRequest {
    OpenRequest::Refused {
        reason: reason.into(),
    }
}

pub fn parse(url: &Url) -> OpenRequest {
    match url.scheme() {
        "file" => match url.to_file_path() {
            Ok(path) => file_request(&path, None),
            Err(()) => refused("Waymark could not read the file it was asked to open."),
        },
        "waymark" => parse_link(url),
        _ => refused("Waymark only opens Markdown files and waymark:// links."),
    }
}

fn parse_link(url: &Url) -> OpenRequest {
    if url.host_str() != Some("open") || !matches!(url.path(), "" | "/") {
        return refused("Waymark links start with waymark://open?path=");
    }
    let mut path = None;
    let mut heading = None;
    for (key, value) in url.query_pairs() {
        if value.len() > LONGEST_PARAMETER || value.chars().any(char::is_control) {
            return refused("This Waymark link is damaged, so nothing was opened.");
        }
        match key.as_ref() {
            "path" => path = Some(value.trim().to_string()),
            "heading" => heading = Some(value.trim().to_string()).filter(|h| !h.is_empty()),
            _ => {}
        }
    }
    let Some(path) = path.filter(|p| !p.is_empty()) else {
        return refused("This Waymark link names no note, so nothing was opened.");
    };
    if path.starts_with('/') {
        return file_request(Path::new(&path), heading);
    }
    if path.starts_with('~') {
        return refused("Give the note's full path, or its path inside the vault.");
    }
    OpenRequest::InVault { path, heading }
}

fn file_request(path: &Path, heading: Option<String>) -> OpenRequest {
    let is_markdown = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md"));
    if !is_markdown {
        return refused(format!(
            "Waymark opens Markdown notes, and “{}” is not one.",
            file_name(path)
        ));
    }
    match path.canonicalize() {
        Ok(found) if found.is_file() => OpenRequest::File {
            path: display(&found),
            heading,
        },
        _ => refused(format!("There is no note at {}.", display(path))),
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| display(path))
}

fn display(path: &Path) -> String {
    PathBuf::from(path).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    fn reason(request: OpenRequest) -> String {
        match request {
            OpenRequest::Refused { reason } => reason,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_vault_path_and_heading_pass_through_as_text() {
        assert_eq!(
            parse(&url(
                "waymark://open?path=Folder%2FA%20note.md&heading=Next%20steps"
            )),
            OpenRequest::InVault {
                path: "Folder/A note.md".into(),
                heading: Some("Next steps".into()),
            }
        );
        assert_eq!(
            parse(&url("waymark://open/?path=A+note")),
            OpenRequest::InVault {
                path: "A note".into(),
                heading: None,
            }
        );
    }

    #[test]
    fn an_absolute_path_is_resolved_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("Plan.md");
        std::fs::write(&note, "x").unwrap();
        let link = Url::parse_with_params(
            "waymark://open",
            [("path", note.to_str().unwrap()), ("heading", "")],
        )
        .unwrap();
        let expected = OpenRequest::File {
            path: display(&note.canonicalize().unwrap()),
            heading: None,
        };
        assert_eq!(parse(&link), expected);
        assert_eq!(parse(&Url::from_file_path(&note).unwrap()), expected);
    }

    #[test]
    fn a_missing_or_foreign_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let picture = dir.path().join("photo.png");
        std::fs::write(&picture, "x").unwrap();
        assert!(reason(parse(&Url::from_file_path(&picture).unwrap())).contains("photo.png"));
        assert!(
            reason(parse(
                &Url::from_file_path(dir.path().join("Gone.md")).unwrap()
            ))
            .contains("no note")
        );
        let folder = dir.path().join("Looks like.md");
        std::fs::create_dir(&folder).unwrap();
        assert!(reason(parse(&Url::from_file_path(&folder).unwrap())).contains("no note"));
    }

    #[test]
    fn malformed_links_open_nothing() {
        for link in [
            "waymark://open",
            "waymark://open?path=",
            "waymark://open?heading=Only",
            "waymark://write?path=A.md",
            "waymark://open/extra?path=A.md",
            "waymark://open?path=A%0A.md",
            "waymark://open?path=~/notes/A.md",
            "https://example.com/A.md",
        ] {
            assert!(
                matches!(parse(&url(link)), OpenRequest::Refused { .. }),
                "{link} was not refused"
            );
        }
        let long = format!("waymark://open?path={}", "a".repeat(LONGEST_PARAMETER + 1));
        assert!(matches!(parse(&url(&long)), OpenRequest::Refused { .. }));
    }
}
