//! Remembers where the window was, in Application Support, so it comes back there.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, Runtime, WebviewWindow, Window,
};

const LEAST: (f64, f64) = (560.0, 420.0);
const SAVE_AFTER: Duration = Duration::from_millis(500);
/// How far down the window a point must be on a screen for its title bar to be reachable.
const TITLE_BAR: f64 = 16.0;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Saved {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub fullscreen: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, PartialEq)]
pub struct Placement {
    pub width: f64,
    pub height: f64,
    /// None when the saved place is on a screen that has gone: the window is centred instead.
    pub position: Option<(f64, f64)>,
}

impl Screen {
    fn holds(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// Fits a saved window to the screens there are now.
pub fn place(saved: &Saved, screens: &[Screen]) -> Option<Placement> {
    let widest = screens.first()?;
    let middle = saved.x + saved.width / 2.0;
    let home = screens
        .iter()
        .find(|s| s.holds(middle, saved.y + TITLE_BAR));
    let limit = home.unwrap_or(widest);
    let width = saved.width.max(LEAST.0).min(limit.width.max(LEAST.0));
    let height = saved.height.max(LEAST.1).min(limit.height.max(LEAST.1));
    Some(Placement {
        width,
        height,
        position: home.map(|_| (saved.x, saved.y)),
    })
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("window.json"))
}

fn read(path: &Path) -> Option<Saved> {
    let saved: Saved = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    [saved.x, saved.y, saved.width, saved.height]
        .iter()
        .all(|n| n.is_finite())
        .then_some(saved)
}

fn write(path: &Path, saved: &Saved) {
    let Some(dir) = path.parent() else { return };
    let _ = std::fs::create_dir_all(dir);
    let tmp = path.with_extension("json.tmp");
    let Ok(bytes) = serde_json::to_vec_pretty(saved) else {
        return;
    };
    if std::fs::write(&tmp, bytes).is_ok() {
        let _ = std::fs::rename(tmp, path);
    }
}

fn screens<R: Runtime>(window: &WebviewWindow<R>) -> Vec<Screen> {
    let logical = |m: &Monitor| {
        let scale = m.scale_factor();
        let position = m.position().to_logical::<f64>(scale);
        let size = m.size().to_logical::<f64>(scale);
        Screen {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    };
    window
        .available_monitors()
        .map(|all| all.iter().map(logical).collect())
        .unwrap_or_default()
}

/// Sets the window's place while it is still hidden, then shows it.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>) {
    let saved = state_path(window.app_handle()).and_then(|path| read(&path));
    if let Some(saved) = saved {
        if let Some(placement) = place(&saved, &screens(window)) {
            let _ = window.set_size(LogicalSize::new(placement.width, placement.height));
            match placement.position {
                Some((x, y)) => {
                    let _ = window.set_position(LogicalPosition::new(x, y));
                }
                None => {
                    let _ = window.center();
                }
            }
        }
        let _ = window.show();
        if saved.fullscreen {
            let _ = window.set_fullscreen(true);
        }
        return;
    }
    let _ = window.show();
}

fn snapshot<R: Runtime>(window: &Window<R>, previous: Option<Saved>) -> Option<Saved> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    /* Full screen fills the display, so the size to come back to is the one from before it. */
    if window.is_fullscreen().unwrap_or(false) {
        return previous.map(|saved| Saved {
            fullscreen: true,
            ..saved
        });
    }
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Saved {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        fullscreen: false,
    })
}

static SAVE_PENDING: AtomicBool = AtomicBool::new(false);

/// Saves shortly after the window stops moving, so a drag writes the file once.
pub fn note_change<R: Runtime>(window: &Window<R>) {
    if SAVE_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_AFTER);
        SAVE_PENDING.store(false, Ordering::SeqCst);
        let Some(path) = state_path(window.app_handle()) else {
            return;
        };
        if let Some(saved) = snapshot(&window, read(&path)) {
            write(&path, &saved);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: Screen = Screen {
        x: 0.0,
        y: 0.0,
        width: 1512.0,
        height: 982.0,
    };
    const DESK: Screen = Screen {
        x: 1512.0,
        y: 0.0,
        width: 2560.0,
        height: 1440.0,
    };

    fn saved(x: f64, y: f64, width: f64, height: f64) -> Saved {
        Saved {
            x,
            y,
            width,
            height,
            fullscreen: false,
        }
    }

    #[test]
    fn a_window_on_a_present_screen_goes_back_exactly() {
        let placed = place(&saved(1800.0, 100.0, 1600.0, 900.0), &[LAPTOP, DESK]).unwrap();
        assert_eq!(
            placed,
            Placement {
                width: 1600.0,
                height: 900.0,
                position: Some((1800.0, 100.0))
            }
        );
    }

    #[test]
    fn a_window_on_a_screen_that_has_gone_is_centred_and_fits() {
        let placed = place(&saved(1800.0, 100.0, 2400.0, 1300.0), &[LAPTOP]).unwrap();
        assert_eq!(placed.position, None);
        assert_eq!((placed.width, placed.height), (1512.0, 982.0));
    }

    #[test]
    fn a_title_bar_above_every_screen_does_not_count_as_on_screen() {
        assert_eq!(
            place(&saved(100.0, -400.0, 1000.0, 800.0), &[LAPTOP])
                .unwrap()
                .position,
            None
        );
    }

    #[test]
    fn a_tiny_saved_size_is_raised_to_the_window_minimum() {
        let placed = place(&saved(10.0, 10.0, 100.0, 50.0), &[LAPTOP]).unwrap();
        assert_eq!((placed.width, placed.height), LEAST);
    }

    #[test]
    fn no_screens_means_no_placement() {
        assert_eq!(place(&saved(0.0, 0.0, 800.0, 600.0), &[]), None);
    }

    #[test]
    fn a_damaged_file_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("window.json");
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(read(&path), None);
        std::fs::write(&path, r#"{"x":0,"y":0,"width":1e999,"height":1}"#).unwrap();
        assert_eq!(read(&path), None);
    }

    #[test]
    fn what_is_written_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/window.json");
        let state = saved(1.0, 2.0, 900.0, 700.0);
        write(&path, &state);
        assert_eq!(read(&path), Some(state));
    }
}
