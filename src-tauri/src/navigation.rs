//! The app's page must never be replaced: not by a dropped file, a link, or the web view's own menu.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};

/// The app's own page, the PDF frames it embeds, and the blank frames the web view makes.
pub fn is_allowed(url: &Url, dev: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "vault" => {
            url.host_str() == Some("localhost") && url.path().to_ascii_lowercase().ends_with(".pdf")
        }
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        _ => dev.is_some_and(|dev| dev.origin() == url.origin()),
    }
}

/// Refuses every other navigation. A web address goes to the default browser instead.
pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let config = webview.app_handle().config();
            let dev = config
                .build
                .dev_url
                .as_ref()
                .filter(|_| cfg!(debug_assertions));
            if is_allowed(url, dev) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https") {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALLOWED: &[&str] = &[
        "tauri://localhost",
        "tauri://localhost/index.html#part",
        "vault://localhost/Papers/One.PDF",
        "about:blank",
        "about:srcdoc",
    ];
    const REFUSED: &[&str] = &[
        "https://example.com/",
        "http://localhost:5178/",
        "file:///etc/hosts",
        "vault://localhost/Note.md",
        "vault://elsewhere/a.pdf",
        "tauri://evil/",
        "javascript:alert(1)",
        "data:text/html,x",
    ];

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn only_the_app_and_its_frames_may_load() {
        for text in ALLOWED {
            assert!(is_allowed(&url(text), None), "{text}");
        }
        for text in REFUSED {
            assert!(!is_allowed(&url(text), None), "{text}");
        }
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_named() {
        let dev = url("http://localhost:5178");
        assert!(is_allowed(&url("http://localhost:5178/x"), Some(&dev)));
        assert!(!is_allowed(&url("http://localhost:9999/"), Some(&dev)));
    }
}
