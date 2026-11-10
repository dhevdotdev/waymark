//! The menu bar. Each item is a command from the app's registry, so a menu and a shortcut do the same thing.

use std::collections::HashMap;

use serde::Serialize;
use tauri::menu::{
    IsMenuItem, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

struct Item {
    id: &'static str,
    label: &'static str,
    keys: Option<&'static str>,
}

const fn item(id: &'static str, label: &'static str, keys: &'static str) -> Option<Item> {
    Some(Item {
        id,
        label,
        keys: Some(keys),
    })
}

const fn plain(id: &'static str, label: &'static str) -> Option<Item> {
    Some(Item {
        id,
        label,
        keys: None,
    })
}

/// `None` is a separator.
const FILE: &[Option<Item>] = &[
    item("new-note", "New Note", "CmdOrCtrl+N"),
    plain("new-folder", "New Folder"),
    item("new-tab", "New Tab", "CmdOrCtrl+T"),
    None,
    item("palette", "Go to Note…", "CmdOrCtrl+P"),
    item("reopen-tab", "Reopen Closed Tab", "CmdOrCtrl+Shift+T"),
    None,
    item("rename-note", "Rename Note", "F2"),
    plain("delete-note", "Move Note to Trash"),
    plain("reveal", "Reveal in Finder"),
    None,
    item("close-tab", "Close Tab", "CmdOrCtrl+W"),
];

const VIEW: &[Option<Item>] = &[
    item("edit", "Read or Edit", "CmdOrCtrl+E"),
    None,
    item("sidebar", "Toggle Sidebar", "CmdOrCtrl+\\"),
    item("rail", "Toggle Side Panel", "CmdOrCtrl+Alt+\\"),
    item("trail", "Show Trail", "CmdOrCtrl+Y"),
    item("graph", "Graph", "CmdOrCtrl+G"),
    None,
    item("text-bigger", "Larger Text", "CmdOrCtrl+="),
    item("text-smaller", "Smaller Text", "CmdOrCtrl+-"),
    item("text-reset", "Default Text Size", "CmdOrCtrl+0"),
    None,
];

const GO: &[Option<Item>] = &[
    item("back", "Back", "CmdOrCtrl+["),
    item("forward", "Forward", "CmdOrCtrl+]"),
    None,
    item("previous-tab", "Previous Tab", "CmdOrCtrl+Shift+["),
    item("next-tab", "Next Tab", "CmdOrCtrl+Shift+]"),
    None,
    item("files", "Files", "CmdOrCtrl+Shift+E"),
    item("search", "Search Notes", "CmdOrCtrl+Shift+F"),
    item("history", "Note History", "CmdOrCtrl+Shift+H"),
];

const FIND: Option<Item> = item("find", "Find in Note", "CmdOrCtrl+F");
const SETTINGS: Option<Item> = item("settings", "Settings…", "CmdOrCtrl+,");

fn every_item() -> impl Iterator<Item = &'static Item> {
    static SINGLES: [&Option<Item>; 2] = [&FIND, &SETTINGS];
    FILE.iter().chain(VIEW).chain(GO).chain(SINGLES).flatten()
}

/// The command items, so they can be enabled and disabled later.
#[derive(Default)]
pub struct Items(HashMap<&'static str, MenuItem<Wry>>);

fn make(app: &AppHandle, items: &mut Items, entry: &Item) -> tauri::Result<MenuItem<Wry>> {
    let made = MenuItem::with_id(app, entry.id, entry.label, true, entry.keys)?;
    items.0.insert(entry.id, made.clone());
    Ok(made)
}

fn submenu(
    app: &AppHandle,
    items: &mut Items,
    title: &str,
    entries: &[Option<Item>],
    extras: &[&dyn IsMenuItem<Wry>],
) -> tauri::Result<Submenu<Wry>> {
    let mut builder = SubmenuBuilder::new(app, title);
    for entry in entries {
        builder = match entry {
            Some(entry) => builder.item(&make(app, items, entry)?),
            None => builder.separator(),
        };
    }
    for extra in extras {
        builder = builder.item(*extra);
    }
    builder.build()
}

fn build(app: &AppHandle, items: &mut Items) -> tauri::Result<Menu<Wry>> {
    let settings = SETTINGS.as_ref().expect("settings is an item");
    let app_menu = SubmenuBuilder::new(app, "Waymark")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Waymark"),
            None,
        )?)
        .separator()
        .item(&make(app, items, settings)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let file = submenu(app, items, "File", FILE, &[])?;
    let find = FIND.as_ref().expect("find is an item");
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&make(app, items, find)?)
        .build()?;
    let full_screen = PredefinedMenuItem::fullscreen(app, None)?;
    let view = submenu(app, items, "View", VIEW, &[&full_screen])?;
    let go = submenu(app, items, "Go", GO, &[])?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &go, &window])
        .build()
}

/// Sets the menu bar and passes each choice to the page, which runs the command.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let mut items = Items::default();
    let menu = build(app, &mut items)?;
    app.set_menu(menu)?;
    app.manage(items);
    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        if every_item().any(|item| item.id == id) {
            let _ = app.emit("menu-command", id);
        }
    });
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuEntry {
    id: &'static str,
    keys: Option<&'static str>,
    enabled: bool,
}

#[tauri::command]
pub fn menu_items(items: State<'_, Items>) -> Vec<MenuEntry> {
    every_item()
        .map(|item| MenuEntry {
            id: item.id,
            keys: item.keys,
            enabled: items
                .0
                .get(item.id)
                .and_then(|made| made.is_enabled().ok())
                .unwrap_or(false),
        })
        .collect()
}

#[tauri::command]
pub fn set_menu_enabled(items: State<'_, Items>, states: HashMap<String, bool>) {
    for (id, enabled) in states {
        if let Some(made) = items.0.get(id.as_str()) {
            let _ = made.set_enabled(enabled);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn no_two_items_share_an_id_or_a_shortcut() {
        let mut ids = HashSet::new();
        let mut keys = HashSet::new();
        for item in every_item() {
            assert!(ids.insert(item.id), "{}", item.id);
            if let Some(chord) = item.keys {
                assert!(keys.insert(chord), "{chord}");
            }
        }
    }
}
