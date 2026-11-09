mod dock_icon;
mod git;
mod trash;
mod vault;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer, notify::RecursiveMode};
use serde::Serialize;
use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

use git::{GitError, Status};
use vault::{Vault, VaultInfo};

static QUITTING: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
struct Watcher(Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

#[derive(Serialize, Clone)]
struct VaultChange {
    paths: Vec<String>,
}

type CmdResult<T> = Result<T, GitError>;

fn plain_err(message: impl Into<String>) -> GitError {
    GitError::other(message)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| plain_err(e.to_string()))?
}

#[tauri::command]
async fn open_vault(
    app: AppHandle,
    vault: State<'_, Vault>,
    watcher: State<'_, Watcher>,
    path: String,
) -> CmdResult<VaultInfo> {
    let handle = app.clone();
    let (root, debouncer) = blocking(move || {
        let root = PathBuf::from(&path)
            .canonicalize()
            .map_err(|_| plain_err(format!("Folder not found: {path}")))?;
        if !root.is_dir() {
            return Err(plain_err("Choose a folder"));
        }
        let debouncer = watch(&handle, &root).map_err(plain_err)?;
        Ok((root, debouncer))
    })
    .await?;
    vault.set(root.clone());
    *watcher.0.lock().unwrap() = Some(debouncer);
    Ok(vault::info(&root))
}

/// Watches the vault for edits made by other apps. `.git` and `.obsidian`
/// churn is ignored; Git state is refreshed separately.
fn watch(
    app: &AppHandle,
    root: &Path,
) -> Result<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>, String> {
    let handle = app.clone();
    let base = root.to_path_buf();
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let mut paths: Vec<String> = events
                .iter()
                .filter_map(|e| {
                    e.path
                        .strip_prefix(&base)
                        .ok()
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                })
                .filter(|p| {
                    !p.split('/').any(|part| part.starts_with('.'))
                        || p.starts_with(".git/") && is_git_signal(p)
                })
                .collect();
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                let _ = handle.emit("vault-changed", VaultChange { paths });
            }
        },
    )
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(debouncer)
}

fn is_git_signal(path: &str) -> bool {
    matches!(
        path,
        ".git/HEAD"
            | ".git/index"
            | ".git/FETCH_HEAD"
            | ".git/ORIG_HEAD"
            | ".git/packed-refs"
            | ".git/MERGE_HEAD"
            | ".git/CHERRY_PICK_HEAD"
            | ".git/REVERT_HEAD"
    ) || path.starts_with(".git/refs/")
        || path.starts_with(".git/rebase-merge")
        || path.starts_with(".git/rebase-apply")
}

#[tauri::command]
async fn list_files(vault: State<'_, Vault>) -> CmdResult<Vec<String>> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || vault::list(&root).map_err(plain_err)).await
}

#[tauri::command]
async fn read_text(vault: State<'_, Vault>, path: String) -> CmdResult<String> {
    let abs = vault.resolve(&path).map_err(plain_err)?;
    blocking(move || {
        std::fs::read_to_string(abs).map_err(|e| plain_err(format!("Could not read {path}: {e}")))
    })
    .await
}

#[tauri::command]
async fn read_many(vault: State<'_, Vault>, paths: Vec<String>) -> CmdResult<Vec<Option<String>>> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || {
        Ok(paths
            .iter()
            .map(|p| {
                vault::resolve_in(&root, p)
                    .ok()
                    .and_then(|abs| std::fs::read_to_string(abs).ok())
            })
            .collect())
    })
    .await
}

fn run_open(args: Vec<std::ffi::OsString>) -> CmdResult<()> {
    std::process::Command::new("open")
        .args(args)
        .status()
        .map_err(|e| plain_err(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn reveal(vault: State<'_, Vault>, path: Option<String>) -> CmdResult<()> {
    let target = match path {
        Some(p) => vault.resolve(&p),
        None => vault.root(),
    }
    .map_err(plain_err)?;
    blocking(move || run_open(vec!["-R".into(), target.into()])).await
}

/// The external route for problems Waymark will not resolve itself.
#[tauri::command]
async fn open_terminal(vault: State<'_, Vault>) -> CmdResult<()> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || run_open(vec!["-a".into(), "Terminal".into(), root.into()])).await
}

#[tauri::command]
async fn git_status(vault: State<'_, Vault>) -> CmdResult<Status> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || git::status(&root)).await
}

#[tauri::command]
async fn git_fetch(vault: State<'_, Vault>) -> CmdResult<Status> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        git::fetch(&root)
    })
    .await
}

#[tauri::command]
async fn git_fast_forward(vault: State<'_, Vault>) -> CmdResult<Status> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        git::fast_forward(&root)
    })
    .await
}

#[tauri::command]
async fn git_push(vault: State<'_, Vault>) -> CmdResult<Status> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        git::push(&root)
    })
    .await
}

#[tauri::command]
async fn write_note(
    vault: State<'_, Vault>,
    path: String,
    text: String,
    expected: Option<String>,
) -> CmdResult<vault::WriteOutcome> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        vault::write_note(&root, &path, &text, expected.as_deref()).map_err(plain_err)
    })
    .await
}

#[tauri::command]
async fn vault_settings(vault: State<'_, Vault>) -> CmdResult<vault::VaultSettings> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || Ok(vault::settings(&root))).await
}

#[tauri::command]
async fn rename_note(vault: State<'_, Vault>, from: String, to: String) -> CmdResult<()> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        vault::rename_note(&root, &from, &to).map_err(plain_err)
    })
    .await
}

#[tauri::command]
async fn trash_note(vault: State<'_, Vault>, path: String) -> CmdResult<()> {
    if !path.to_ascii_lowercase().ends_with(".md") {
        return Err(plain_err("Only notes can be moved to the Trash"));
    }
    let target = vault.resolve(&path).map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        trash::move_to_trash(&target).map_err(plain_err)
    })
    .await
}

/// Takes the file as a raw body, because an image sent as JSON would be several times its size.
#[tauri::command]
async fn write_attachment(
    vault: State<'_, Vault>,
    request: tauri::ipc::Request<'_>,
) -> CmdResult<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(plain_err("Expected the file's bytes"));
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            percent_encoding::percent_decode_str(value)
                .decode_utf8_lossy()
                .into_owned()
        })
        .ok_or_else(|| plain_err("No file name was given"))?;
    let bytes = bytes.clone();
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        vault::write_attachment(&root, &path, &bytes).map_err(plain_err)
    })
    .await
}

/// Called once the frontend has saved anything pending, so quitting can finish.
#[tauri::command]
fn finish_quit(app: AppHandle) {
    app.exit(0);
}

/// Gives the frontend a moment to save before the app goes away. The timer covers a frontend that never answers.
fn quit_after_saving(app: &AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit("save-before-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        handle.exit(0);
    });
}

#[tauri::command]
async fn git_stage(vault: State<'_, Vault>, paths: Vec<String>) -> CmdResult<Status> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        git::stage(&root, &paths)
    })
    .await
}

#[tauri::command]
async fn git_unstage(vault: State<'_, Vault>, paths: Vec<String>) -> CmdResult<Status> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        git::unstage(&root, &paths)
    })
    .await
}

#[tauri::command]
async fn git_commit(vault: State<'_, Vault>, message: String) -> CmdResult<Status> {
    let root = vault.root().map_err(plain_err)?;
    let gate = vault.write_gate();
    blocking(move || {
        let _writing = gate.lock().unwrap_or_else(|e| e.into_inner());
        git::commit(&root, &message)
    })
    .await
}

#[tauri::command]
async fn git_diff(
    vault: State<'_, Vault>,
    path: String,
    staged: bool,
    untracked: bool,
) -> CmdResult<String> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || git::diff_worktree(&root, &path, staged, untracked)).await
}

#[tauri::command]
async fn git_log(
    vault: State<'_, Vault>,
    path: Option<String>,
    limit: u32,
    skip: u32,
) -> CmdResult<Vec<git::Commit>> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || git::log(&root, path.as_deref(), limit, skip)).await
}

#[tauri::command]
async fn git_show(vault: State<'_, Vault>, sha: String, path: Option<String>) -> CmdResult<String> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || git::show_commit(&root, &sha, path.as_deref())).await
}

#[tauri::command]
async fn git_file_at(vault: State<'_, Vault>, sha: String, path: String) -> CmdResult<String> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || git::file_at(&root, &sha, &path)).await
}

#[tauri::command]
async fn git_diff_revs(
    vault: State<'_, Vault>,
    from: String,
    to: String,
    path: String,
) -> CmdResult<String> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || git::diff_revs(&root, &from, &to, &path)).await
}

#[tauri::command]
async fn git_store_credential(
    vault: State<'_, Vault>,
    url: String,
    username: String,
    secret: String,
) -> CmdResult<()> {
    let root = vault.root().map_err(plain_err)?;
    blocking(move || git::store_credential(&root, &url, &username, &secret)).await
}

#[tauri::command]
async fn git_clone(app: AppHandle, url: String, dest: String) -> CmdResult<()> {
    let dest = PathBuf::from(dest);
    blocking(move || {
        git::clone(&url, &dest, |line| {
            let _ = app.emit("clone-progress", line);
        })
    })
    .await
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("preferences.json"))
}

/// Preferences and per-vault state live in Application Support, never in the vault.
#[derive(Serialize)]
struct SelfTest {
    vault: String,
    mode: String,
}

/// QA hook: when WAYMARK_SELFTEST_OUT is set, the frontend runs its in-app checks
/// against WAYMARK_SELFTEST_VAULT and reports back through `selftest_report`.
#[tauri::command]
fn selftest_config(app: AppHandle) -> Option<SelfTest> {
    std::env::var("WAYMARK_SELFTEST_OUT").ok()?;
    /* macOS throttles timers in hidden windows; a self-test runs in front so its timings are real. */
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    Some(SelfTest {
        vault: std::env::var("WAYMARK_SELFTEST_VAULT").ok()?,
        mode: std::env::var("WAYMARK_SELFTEST_MODE").unwrap_or_else(|_| "read".into()),
    })
}

#[tauri::command]
fn selftest_log(line: String) {
    eprintln!("[selftest] {line}");
}

#[tauri::command]
fn selftest_report(app: AppHandle, report: serde_json::Value) -> Result<(), String> {
    let out = std::env::var("WAYMARK_SELFTEST_OUT").map_err(|e| e.to_string())?;
    std::fs::write(
        out,
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if std::env::var("WAYMARK_SELFTEST_STAY").is_err() {
        app.exit(0);
    }
    Ok(())
}

#[tauri::command]
async fn read_prefs(app: AppHandle) -> CmdResult<serde_json::Value> {
    blocking(move || {
        let path = prefs_path(&app).map_err(plain_err)?;
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Ok(serde_json::json!({}));
        };
        Ok(serde_json::from_str(&text).unwrap_or_else(|_| {
            // Keep a damaged file for inspection instead of overwriting it with defaults.
            let _ = std::fs::rename(&path, path.with_extension("json.corrupt"));
            serde_json::json!({})
        }))
    })
    .await
}

#[tauri::command]
async fn write_prefs(app: AppHandle, prefs: serde_json::Value) -> CmdResult<()> {
    blocking(move || {
        let path = prefs_path(&app).map_err(plain_err)?;
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(&prefs).map_err(|e| plain_err(e.to_string()))?;
        std::fs::write(&tmp, bytes).map_err(|e| plain_err(e.to_string()))?;
        std::fs::rename(tmp, path).map_err(|e| plain_err(e.to_string()))
    })
    .await
}

/// The standard Mac menus, without Close Window: ⌘W closes a tab in Waymark.
fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
    let app_menu = SubmenuBuilder::new(app, "Waymark")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Waymark"),
            None,
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &view, &window])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Vault::default())
        .manage(Watcher::default())
        .register_asynchronous_uri_scheme_protocol("vault", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let vault = app.state::<Vault>();
                let raw = request.uri().path().trim_start_matches('/');
                let rel = percent_encoding::percent_decode_str(raw)
                    .decode_utf8_lossy()
                    .into_owned();
                let response = match vault.resolve(&rel).and_then(|abs| {
                    std::fs::read(&abs)
                        .map(|b| (abs, b))
                        .map_err(|e| e.to_string())
                }) {
                    Ok((abs, bytes)) => Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", vault::mime_for(&abs))
                        .header("Cache-Control", "no-cache")
                        .body(bytes),
                    Err(_) => Response::builder()
                        .status(StatusCode::NOT_FOUND)
                        .body(Vec::new()),
                };
                responder.respond(response.unwrap());
            });
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            list_files,
            read_text,
            read_many,
            write_note,
            vault_settings,
            rename_note,
            trash_note,
            write_attachment,
            finish_quit,
            reveal,
            open_terminal,
            git_status,
            git_fetch,
            git_fast_forward,
            git_push,
            git_stage,
            git_unstage,
            git_commit,
            git_diff,
            git_log,
            git_show,
            git_file_at,
            git_diff_revs,
            git_store_credential,
            git_clone,
            read_prefs,
            write_prefs,
            dock_icon::set_dock_icon,
            selftest_config,
            selftest_report,
            selftest_log
        ])
        .build(tauri::generate_context!())
        .expect("error while running Waymark")
        .run(|app, event| match event {
            RunEvent::ExitRequested {
                code: None, api, ..
            } => {
                api.prevent_exit();
                quit_after_saving(app);
            }
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                quit_after_saving(app);
            }
            _ => {}
        });
}
