//! The Dock icon follows the theme family while the app runs. Catppuccin is the app's own icon.

use objc2::AllocAnyThread;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;

const ARTWORK: [(&str, &[u8]); 4] = [
    ("rose-pine", include_bytes!("../icons/themes/rose-pine.png")),
    ("gruvbox", include_bytes!("../icons/themes/gruvbox.png")),
    (
        "everforest",
        include_bytes!("../icons/themes/everforest.png"),
    ),
    ("ember", include_bytes!("../icons/themes/ember.png")),
];

/// The icon for a theme family. `None` means the icon in the app bundle.
fn artwork(family: &str) -> Result<Option<&'static [u8]>, String> {
    if family == "catppuccin" {
        return Ok(None);
    }
    ARTWORK
        .iter()
        .find(|(id, _)| *id == family)
        .map(|(_, png)| Some(*png))
        .ok_or_else(|| format!("No Dock icon for theme family {family}"))
}

/// Synchronous on purpose: Tauri runs these on the main thread, the only one AppKit allows here.
#[tauri::command]
pub fn set_dock_icon(family: String) -> Result<(), String> {
    let artwork = artwork(&family)?;
    let main_thread =
        MainThreadMarker::new().ok_or("The Dock icon can only change on the main thread")?;
    let image = match artwork {
        Some(png) => {
            let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(png));
            Some(image.ok_or("macOS could not read the Dock icon")?)
        }
        None => None,
    };
    unsafe {
        NSApplication::sharedApplication(main_thread).setApplicationIconImage(image.as_deref())
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catppuccin_uses_the_bundled_icon() {
        assert_eq!(artwork("catppuccin"), Ok(None));
    }

    #[test]
    fn every_other_family_has_png_artwork() {
        for (family, _) in ARTWORK {
            let png = artwork(family).unwrap().unwrap();
            assert_eq!(&png[1..4], b"PNG", "{family}");
        }
    }

    #[test]
    fn an_unknown_family_is_refused() {
        assert!(artwork("../../etc/passwd").is_err());
    }
}
