// Piwi Dashboard desktop shell.
//
// This wraps the *same* Nuxt/Nitro server that ships as the Docker image and the
// `@piwitests/server` npm package. On launch it:
//   1. resolves a per-user data directory (OS app-data dir, survives updates),
//   2. spawns the bundled server as a Node sidecar on a private loopback port,
//   3. waits for `GET /api/health` to return 200 (i.e. the DB has migrated),
//   4. points the window at the local server via a one-time token bootstrap.
// A tray icon offers "run in background" (keep serving after the window closes)
// and "start on login". Everything binds 127.0.0.1 — nothing is exposed to the
// network.

mod inspect;
mod mcp_clients;
mod mcp_stdio;
mod runner;
mod updates;
mod worktree;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Emitter as _, Manager, RunEvent, WindowEvent};

use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::{DialogExt as _, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_opener::OpenerExt as _;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt as _;
use tauri_plugin_store::StoreExt as _;

use inspect::desktop_inspect_folder;
use mcp_clients::{desktop_mcp_clients, desktop_mcp_connect, desktop_mcp_disconnect, desktop_mcp_reveal};
use updates::{desktop_check_update, desktop_install_update, desktop_restart_app};
use runner::{
    desktop_check_local_env, desktop_check_local_specs, desktop_get_project_link,
    desktop_pick_folder, desktop_run_local_tests, desktop_set_project_link,
    desktop_set_project_start_command, desktop_stop_local_tests,
};
use worktree::{desktop_bisect_here, desktop_reproduce_here};

pub(crate) const STORE_FILE: &str = "settings.json";
const RUN_BG_KEY: &str = "runInBackground";
const READY_TIMEOUT_SECS: u64 = 60;
/// Backoff before each auto-restart of a crashed server, capped at the last value.
const RESTART_BACKOFFS_SECS: [u64; 4] = [1, 2, 4, 8];
/// Stop auto-restarting once the server has crashed this many times inside
/// `RESTART_WINDOW_SECS` — a tight crash-loop is a real fault, not a transient one.
const MAX_RESTARTS_IN_WINDOW: u32 = 5;
const RESTART_WINDOW_SECS: u64 = 60;
/// Preferred loopback port — stable so the reporter can target it; falls back to
/// a free port if it's already in use (see `pick_port`).
const PREFERRED_PORT: u16 = 3000;
/// Home-relative location of the file the Playwright reporter — and this app's
/// own MCP stdio bridge — read to find this app: `~/.piwi/desktop.json` (see
/// `write_discovery_file`).
pub(crate) const DISCOVERY_DIR: &str = ".piwi";
pub(crate) const DISCOVERY_FILE: &str = "desktop.json";

/// Holds the running Node sidecar so it can be stopped cleanly on quit.
#[derive(Default)]
struct ServerProcess(Mutex<Option<CommandChild>>);

/// Set true when the app is intentionally shutting down, so the server
/// supervisor treats the deliberate `kill()` on quit as expected and does not
/// restart the server it is about to stop.
struct ShuttingDown(Arc<AtomicBool>);

/// Shared "keep serving after the window closes" flag (tray toggle + close handler).
struct RunInBackground(Arc<AtomicBool>);

/// Set once the user agrees to quit with local test runs still going. The
/// confirmed close reaches the close handler as a fresh request, and this is
/// what tells it apart from the one the user made.
#[derive(Default)]
struct QuitConfirmed(AtomicBool);

/// The user's data directory — used by the "Open data folder" tray item.
struct DataDir(PathBuf);

/// The reporter discovery file, removed on quit so it never outlives the server.
struct DiscoveryFile(PathBuf);

/// Archives handed to the app by the OS (drag onto the dock icon, "Open with",
/// a second launch with file arguments) that the dashboard has not collected
/// yet. The shell only ever queues and pokes; the dashboard drains the queue
/// over IPC, so a poke fired before the webview listens is never lost.
#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<String>>);

/// Keep only arguments that are real `.zip` files on disk; relative paths are
/// resolved against the directory the launching process ran from.
fn collect_zip_args<'a>(args: impl Iterator<Item = &'a str>, cwd: Option<&Path>) -> Vec<String> {
    args.filter(|a| a.to_lowercase().ends_with(".zip"))
        .filter_map(|a| {
            let p = PathBuf::from(a);
            let abs = if p.is_absolute() { p } else { cwd?.join(p) };
            abs.is_file().then(|| abs.to_string_lossy().to_string())
        })
        .collect()
}

fn queue_open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<PendingOpenFiles>() {
        state.0.lock().unwrap().extend(paths);
        let _ = app.emit("piwi:open-files", ());
    }
}

/// Drain the queue of archives the OS asked this app to open.
#[tauri::command]
fn desktop_take_pending_open_files(app: tauri::AppHandle) -> Vec<String> {
    app.try_state::<PendingOpenFiles>()
        .map(|s| std::mem::take(&mut *s.0.lock().unwrap()))
        .unwrap_or_default()
}

/// Ambient status while the window is hidden or unfocused: an unread count on
/// the dock/taskbar icon (where the platform supports a badge) and the tray
/// tooltip. Driven by the dashboard, which knows what fired; the shell only
/// renders. Count 0 clears everything.
#[tauri::command]
fn desktop_set_activity(app: tauri::AppHandle, count: u32, status: Option<String>) {
    let handle = app.clone();
    // Badge and tray mutations belong on the main thread on every platform.
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = handle.get_webview_window("main") {
            // Unsupported platforms (Windows) reject the call — that's fine,
            // the tray tooltip below still carries the count.
            let _ = w.set_badge_count(if count > 0 { Some(count as i64) } else { None });
        }
        if let Some(tray) = handle.tray_by_id("main") {
            let tooltip = match (count, status.as_deref()) {
                (0, _) => "Piwi Dashboard (click to open)".to_string(),
                (n, None) => format!("Piwi Dashboard — {n} unread"),
                (n, Some(s)) => format!("Piwi Dashboard — {n} unread — {s}"),
            };
            let _ = tray.set_tooltip(Some(tooltip));
        }
    });
}

fn random_hex_32() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Prefer a stable port (so the address is bookmarkable and the reporter can
/// target it) and fall back to any free loopback port if it's taken. A small
/// TOCTOU window remains between picking and the server binding; if the port is
/// lost in between the server fails to boot, surfacing as a readiness timeout.
fn pick_port() -> u16 {
    if std::net::TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).is_ok() {
        return PREFERRED_PORT;
    }
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .expect("failed to acquire a free loopback port")
}

/// Dependency-free readiness probe. `/api/health` returns 200 only after the
/// database has migrated, so a 200 means the app is ready to load.
fn health_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let req =
        format!("GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 128];
    match stream.read(&mut buf) {
        Ok(n) => String::from_utf8_lossy(&buf[..n]).contains(" 200 "),
        Err(_) => false,
    }
}

/// Restrict a file holding a secret to its owner (0600). Unix only — on Windows
/// the per-user profile is already ACL-protected and `std::fs` cannot express
/// ACLs. Best-effort: a filesystem that ignores modes must not block startup.
fn restrict_to_owner(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Read the persisted master encryption key, or generate + persist one on first
/// run. Kept stable so secrets stored in the DB (AI keys, SCM tokens) stay
/// readable across launches. Lives in the user-scoped app-data dir.
fn load_or_create_secret(app_data_dir: &PathBuf) -> String {
    let key_path = app_data_dir.join("secret.key");
    if let Ok(existing) = std::fs::read_to_string(&key_path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let secret = random_hex_32();
    let _ = std::fs::write(&key_path, &secret);
    restrict_to_owner(&key_path);
    secret
}

/// Read the persisted access token, or generate one on first run. Stable (not
/// per-launch) so the Playwright reporter can be configured once, and prefixed
/// `pd_` so the reporter's existing API-key path sends it as `Authorization:
/// Bearer`. Both the window (via cookie) and the reporter (via bearer) present
/// this same token; only someone who can open this app can read it.
fn load_or_create_token(app_data_dir: &PathBuf) -> String {
    let path = app_data_dir.join("reporter-token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let token = format!("pd_{}", random_hex_32());
    let _ = std::fs::write(&path, &token);
    restrict_to_owner(&path);
    token
}

/// Publish the loopback URL and access token to `~/.piwi/desktop.json` so the
/// Playwright reporter can find this app with no configuration at all — it reads
/// this file only when nothing else sets a server URL or API key.
///
/// Written on every launch because the port is not guaranteed (`pick_port` falls
/// back when 3000 is taken) and removed on quit, so the file's presence means
/// "this app is up at this address". Mode 0600: the token is a full-access local
/// credential, and `$HOME` itself is world-readable on most systems.
fn write_discovery_file(home: &Path, port: u16, token: &str) -> std::io::Result<PathBuf> {
    let dir = home.join(DISCOVERY_DIR);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(DISCOVERY_FILE);
    // 127.0.0.1 rather than localhost: the server binds v4 loopback only, and
    // localhost resolves to ::1 first on some systems.
    let body = json!({ "url": format!("http://127.0.0.1:{port}"), "token": token }).to_string();
    std::fs::write(&path, body)?;
    restrict_to_owner(&path);
    Ok(path)
}

/// Convert a path to a string Node can consume as a CLI arg / env value. On
/// Windows, Tauri's resource + app-data paths come back with the `\\?\` verbatim
/// prefix, which Node's module resolver mishandles (it splits `\\?\C:\...` wrong
/// and dies with `EISDIR: lstat 'C:'`) — strip it. No-op on other platforms.
pub(crate) fn node_path(p: &std::path::Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// Append a line to the server log. A release build is a windowed app with no
/// console, so the sidecar's output and any startup errors would otherwise be
/// invisible — this makes them readable via the data folder's `logs/server.log`.
fn append_log(path: &std::path::Path, line: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

/// Everything needed to (re)spawn the bundled Node server on the *same* loopback
/// port and desktop token, so a restart reconnects the already-loaded window
/// transparently — no re-navigation, and the reporter's discovery file stays valid.
struct ServerConfig {
    server_entry: PathBuf,
    db_path: PathBuf,
    storage_dir: PathBuf,
    secret: String,
    token: String,
    port: u16,
    log_path: PathBuf,
}

/// Spawn the bundled Node sidecar running the Nitro server. Returns its event
/// stream and child handle, or `None` when the sidecar is missing or the spawn
/// fails (both logged to the server log; the readiness probe then times out).
fn spawn_server_process(app: &AppHandle, cfg: &ServerConfig) -> Option<(Receiver<CommandEvent>, CommandChild)> {
    let cmd = match app.shell().sidecar("node") {
        Ok(cmd) => cmd,
        Err(e) => {
            append_log(&cfg.log_path, &format!("sidecar 'node' not found: {e}"));
            return None;
        }
    };
    let cmd = cmd
        .args([node_path(&cfg.server_entry)])
        .env("NODE_ENV", "production")
        .env("NITRO_HOST", "127.0.0.1")
        .env("NITRO_PORT", cfg.port.to_string())
        .env("PIWI_DATABASE_PATH", node_path(&cfg.db_path))
        .env("PIWI_STORAGE_PATH", node_path(&cfg.storage_dir))
        .env("PIWI_SECRET_KEY", cfg.secret.clone())
        .env("PIWI_DESKTOP_TOKEN", cfg.token.clone())
        // Tell the bundled Nuxt app it is running in the desktop shell so it hides
        // account/user management (single-user, auth off) and surfaces the local
        // connection details (data location, reporter token, MCP endpoint).
        .env("NUXT_PUBLIC_DESKTOP", "true");

    match cmd.spawn() {
        Ok(pair) => Some(pair),
        Err(e) => {
            append_log(&cfg.log_path, &format!("failed to spawn server: {e}"));
            None
        }
    }
}

/// Own the sidecar for the life of the app: tee its output to the log and, when
/// it exits without a deliberate quit (an OOM crash, say), restart it on the same
/// port and token with a capped backoff so the window is never left pointed at a
/// dead port. A tight crash-loop (`MAX_RESTARTS_IN_WINDOW` inside
/// `RESTART_WINDOW_SECS`) stops the loop rather than hammering. Runs on its own
/// thread and keeps `ServerProcess` pointing at the live child.
fn supervise_server(
    app: AppHandle,
    cfg: ServerConfig,
    initial: (Receiver<CommandEvent>, CommandChild),
    shutting_down: Arc<AtomicBool>,
) {
    let (mut rx, child) = initial;
    app.state::<ServerProcess>().0.lock().unwrap().replace(child);

    std::thread::spawn(move || {
        let mut restarts: u32 = 0;
        let mut window_start = Instant::now();

        loop {
            // Drain the sidecar's output (no console in a release build) until it
            // exits or the channel closes.
            while let Some(event) = rx.blocking_recv() {
                match event {
                    CommandEvent::Stdout(line) => append_log(
                        &cfg.log_path,
                        &format!("[server] {}", String::from_utf8_lossy(&line).trim_end()),
                    ),
                    CommandEvent::Stderr(line) => append_log(
                        &cfg.log_path,
                        &format!("[server:err] {}", String::from_utf8_lossy(&line).trim_end()),
                    ),
                    CommandEvent::Error(err) => append_log(&cfg.log_path, &format!("[server:proc] {err}")),
                    CommandEvent::Terminated(payload) => {
                        append_log(
                            &cfg.log_path,
                            &format!("[server] exited: code={:?} signal={:?}", payload.code, payload.signal),
                        );
                        break;
                    }
                    _ => {}
                }
            }

            // A deliberate quit killed the server — do not resurrect it.
            if shutting_down.load(Ordering::SeqCst) {
                break;
            }

            // A server that stayed up past the window has recovered; forget older
            // crashes so a much later, isolated crash still gets the full budget.
            if window_start.elapsed() > Duration::from_secs(RESTART_WINDOW_SECS) {
                restarts = 0;
                window_start = Instant::now();
            }
            if restarts >= MAX_RESTARTS_IN_WINDOW {
                append_log(
                    &cfg.log_path,
                    "[server] crashed repeatedly — stopping auto-restart; relaunch the app or check the logs.",
                );
                let _ = app.emit("server-status", "crashed");
                break;
            }

            let backoff = RESTART_BACKOFFS_SECS[(restarts as usize).min(RESTART_BACKOFFS_SECS.len() - 1)];
            restarts += 1;
            append_log(&cfg.log_path, &format!("[server] restarting in {backoff}s (attempt {restarts})"));
            let _ = app.emit("server-status", "restarting");
            std::thread::sleep(Duration::from_secs(backoff));

            if shutting_down.load(Ordering::SeqCst) {
                break;
            }

            match spawn_server_process(&app, &cfg) {
                Some((new_rx, new_child)) => {
                    app.state::<ServerProcess>().0.lock().unwrap().replace(new_child);
                    rx = new_rx;
                    let _ = app.emit("server-status", "ready");
                }
                None => {
                    let _ = app.emit("server-status", "crashed");
                    break;
                }
            }
        }
    });
}

// ── Desktop service settings, exposed to the in-app Settings UI over IPC ───────
// The bundled dashboard webview drives the same "run in background" and "start on
// login" options as the tray. window.__TAURI__ is injected into the desktop
// webview (withGlobalTauri) and reachable only there — a plain browser at the
// same loopback URL has no native IPC bridge — and the `remote` capability grants
// the loopback origin access. The webview feature-detects the bridge and falls
// back to pointing at the tray when it is absent.

#[derive(serde::Serialize)]
struct ServiceSettings {
    run_in_background: bool,
    start_on_login: bool,
}

#[tauri::command]
fn desktop_get_service_settings(app: tauri::AppHandle) -> ServiceSettings {
    let run_in_background = app
        .try_state::<RunInBackground>()
        .map(|s| s.0.load(Ordering::SeqCst))
        .unwrap_or(false);
    let start_on_login = app.autolaunch().is_enabled().unwrap_or(false);
    ServiceSettings {
        run_in_background,
        start_on_login,
    }
}

#[tauri::command]
fn desktop_set_run_in_background(app: tauri::AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<RunInBackground>() {
        state.0.store(enabled, Ordering::SeqCst);
    }
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(RUN_BG_KEY, json!(enabled));
        let _ = store.save();
    }
}

#[tauri::command]
fn desktop_set_start_on_login(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

// ── Webview-shell affordances the loopback dashboard drives over IPC ────────────
// A webview has no browser chrome, so external links, native notifications, and
// file downloads have to go through the shell. The bundled dashboard calls these
// (only in the desktop build) instead of relying on `target="_blank"`, the Web
// Notification API, or `download` links, none of which work inside the webview.

/// Open a web/mail link in the user's default browser. Scheme-restricted so a
/// stray call can't reveal a file path or launch an app URL.
#[tauri::command]
fn desktop_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let allowed = url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:");
    if !allowed {
        return Err("unsupported url scheme".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Show a native OS notification (the webview's own Notification API is
/// unavailable / permission-denied there).
#[tauri::command]
fn desktop_notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Decode standard base64 (with or without `=` padding) into raw bytes.
///
/// Binary downloads cross the IPC boundary as base64 because a `Vec<u8>` is
/// serialized as a JSON array of numbers, which costs several times the payload
/// size for an archive of any real weight.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn sextet(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a') as u32 + 26),
            b'0'..=b'9' => Ok((c - b'0') as u32 + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err("invalid base64 character".to_string()),
        }
    }

    let cleaned: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();

    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    for chunk in cleaned.chunks(4) {
        if chunk.len() == 1 {
            return Err("truncated base64 input".to_string());
        }
        let mut acc: u32 = 0;
        for (i, byte) in chunk.iter().enumerate() {
            acc |= sextet(*byte)? << (18 - 6 * i);
        }
        let produced = chunk.len() - 1;
        for i in 0..produced {
            out.push(((acc >> (16 - 8 * i)) & 0xff) as u8);
        }
    }
    Ok(out)
}

/// Write `bytes` into `dir` under `name` without ever overwriting an existing
/// file. Tries the plain name first, then inserts a ` (n)` counter before the
/// extension — the disambiguation a browser applies — retrying on collision.
/// `create_new` makes each attempt atomic (no check-then-write race), so the
/// caller-controlled bytes of a download can never replace a file already on
/// disk, e.g. clobber or trojan an installer/DLL the user already trusts.
fn write_new_download(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    use std::io::Write as _;
    let as_path = Path::new(name);
    let stem = as_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());
    let ext = as_path.extension().map(|e| e.to_string_lossy().to_string());
    for n in 0..=1000 {
        let candidate_name = if n == 0 {
            name.to_string()
        } else if let Some(ext) = &ext {
            format!("{stem} ({n}).{ext}")
        } else {
            format!("{stem} ({n})")
        };
        let candidate = dir.join(&candidate_name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(mut file) => {
                file.write_all(bytes).map_err(|e| e.to_string())?;
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("could not find an unused download filename".to_string())
}

/// Write a file the webview fetched to the user's Downloads folder and reveal it.
/// Returns the saved path. The name is reduced to its base component so a caller
/// can't traverse out of the Downloads directory, and an existing file is never
/// overwritten — a name collision is disambiguated with a ` (n)` suffix.
///
/// `encoding` selects how `contents` is interpreted: omitted or `"utf8"` writes
/// the string as-is, `"base64"` decodes it first so archives, PDFs and images
/// land on disk intact.
#[tauri::command]
fn desktop_save_download(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
    encoding: Option<String>,
) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let name = std::path::Path::new(&filename)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "download".to_string());

    let bytes = match encoding.as_deref() {
        Some("base64") => decode_base64(&contents)?,
        _ => contents.into_bytes(),
    };
    let target = write_new_download(&dir, &name, &bytes)?;

    let _ = app.opener().reveal_item_in_dir(&target);
    Ok(node_path(&target))
}

// ── Leaving the app while local test runs are in flight ───────────────────────

/// Every way out of the app kills the local test runs (see
/// `LocalRuns::kill_all`), so each exit path asks first while any is going:
/// `proceed` runs at once when nothing is active, and only on confirmation
/// otherwise. `verb` fills the question ("quitting" / "restarting"), and
/// `confirm_label` names its confirm button.
///
/// The callback form keeps the event loop free — a blocking dialog here would
/// freeze the very window the question is about.
pub(crate) fn confirm_stopping_local_runs(
    app: &AppHandle,
    title: &str,
    verb: &str,
    confirm_label: &str,
    proceed: impl FnOnce() + Send + 'static,
) {
    let active = app
        .try_state::<runner::LocalRuns>()
        .map(|runs| runs.active_count())
        .unwrap_or(0);
    if active == 0 {
        proceed();
        return;
    }
    app.dialog()
        .message(format!(
            "{active} local test run(s) are still running — {verb} stops them."
        ))
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            confirm_label.into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            if confirmed {
                proceed();
            }
        });
}

/// The window-close variant of the question above.
///
/// Reports whether the close has to be held back: `true` once the question is on
/// screen, `false` when the close may proceed — nothing is running, or the user
/// has already agreed to stop it. Confirming closes the window again, which runs
/// the normal exit path; `QuitConfirmed` is what tells that close apart from the
/// one the user made.
fn hold_close_for_local_runs(window: &tauri::Window) -> bool {
    let confirmed = window
        .try_state::<QuitConfirmed>()
        .is_some_and(|s| s.0.load(Ordering::SeqCst));
    if confirmed {
        return false;
    }
    let active = window
        .try_state::<runner::LocalRuns>()
        .map(|runs| runs.active_count())
        .unwrap_or(0);
    if active == 0 {
        return false;
    }

    let target = window.clone();
    confirm_stopping_local_runs(
        window.app_handle(),
        "Quit Piwi?",
        "quitting",
        "Quit",
        move || {
            if let Some(state) = target.try_state::<QuitConfirmed>() {
                state.0.store(true, Ordering::SeqCst);
            }
            let _ = target.close();
        },
    );
    true
}

/// e2e-only capability granting the Playwright plugin's `pw_result` callback
/// command to the loopback origin the dashboard is served from. Added at runtime
/// (see `add_capability`) so it never ships in production installers.
#[cfg(feature = "e2e-testing")]
const E2E_PLAYWRIGHT_CAPABILITY: &str = r#"{
  "identifier": "e2e-playwright",
  "description": "e2e test builds only: let the Playwright-driven dashboard post results back to the control plugin.",
  "windows": ["main"],
  "remote": { "urls": ["http://localhost:*", "http://127.0.0.1:*"] },
  "permissions": ["playwright:default"]
}"#;

pub fn run() {
    // Claude Desktop only loads stdio MCP servers, so its one-click setup points
    // it at this same binary in bridge mode: it proxies MCP over stdin/stdout to
    // the running app's /mcp endpoint. Handled before anything else — no window,
    // no tray icon, no second server, and no hand-off to the running instance.
    if std::env::args().skip(1).any(|a| mcp_stdio::is_bridge_arg(&a)) {
        mcp_stdio::run_bridge();
        return;
    }

    let launched_hidden = std::env::args().any(|a| a == "--hidden");

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // A second launch just focuses the running window (never a 2nd
            // server) — and forwards any archives it was asked to open.
            queue_open_files(app, collect_zip_args(args.iter().skip(1).map(String::as_str), Some(Path::new(&cwd))));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init());

    // e2e builds embed the Playwright control plugin so a test runner can drive
    // the real webview over a local socket. Gated behind the `e2e-testing`
    // feature so it is never present in shipped installers.
    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_playwright::init());
    }

    let context = tauri::generate_context!();

    // Update support exists only in builds made with the signing key: CI then
    // applies tauri.updater.conf.json, which is what puts an `updater` entry in
    // the compiled config. Without it the plugin stays out entirely and the
    // update commands report "unsupported".
    let updater_supported = context.config().plugins.0.contains_key("updater");
    if updater_supported {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            desktop_get_service_settings,
            desktop_set_run_in_background,
            desktop_set_start_on_login,
            desktop_open_external,
            desktop_notify,
            desktop_save_download,
            desktop_pick_folder,
            desktop_inspect_folder,
            desktop_get_project_link,
            desktop_set_project_link,
            desktop_run_local_tests,
            desktop_stop_local_tests,
            desktop_set_project_start_command,
            desktop_reproduce_here,
            desktop_bisect_here,
            desktop_check_local_specs,
            desktop_check_local_env,
            desktop_take_pending_open_files,
            desktop_mcp_clients,
            desktop_mcp_connect,
            desktop_mcp_disconnect,
            desktop_mcp_reveal,
            desktop_check_update,
            desktop_install_update,
            desktop_restart_app,
            desktop_set_activity
        ])
        .manage(ServerProcess::default())
        .manage(runner::LocalRuns::default())
        .manage(QuitConfirmed::default())
        .manage(PendingOpenFiles::default())
        .manage(updates::UpdaterSupport(updater_supported))
        .manage(updates::PendingUpdate::default())
        .setup(move |app| {
            // --- data locations (survive app updates; outside the read-only bundle) ---
            let app_data_dir = app.path().app_data_dir()?;
            let data_dir = app_data_dir.join(".data");
            let storage_dir = data_dir.join("storage");
            // Setting PIWI_DATABASE_PATH disables the server's own auto-mkdir, and
            // libSQL will not create the DB's parent dir — so create it here.
            std::fs::create_dir_all(&storage_dir)?;
            let db_path = data_dir.join("piwi.db");

            // Server logs go to a file so failures are visible in a windowed
            // (console-less) release build — read it via the "Open data folder"
            // tray item, under logs/server.log.
            let log_dir = app_data_dir.join("logs");
            let _ = std::fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("server.log");
            append_log(&log_path, "----- launch -----");

            let secret = load_or_create_secret(&app_data_dir);
            let token = load_or_create_token(&app_data_dir);
            let port = pick_port();

            app.manage(DataDir(data_dir.clone()));
            app.manage(mcp_clients::ServerInfo { port, token: token.clone() });

            // MCP client configs written on earlier launches embed the URL and
            // token — bring any that drifted (a different port this launch)
            // back in line before a client tries the dead address.
            mcp_clients::heal_configured_clients(app.handle());

            // --- publish connection details for the Playwright reporter ---
            match app.path().home_dir().map_err(|e| e.to_string()).and_then(|home| {
                write_discovery_file(&home, port, &token).map_err(|e| e.to_string())
            }) {
                Ok(path) => {
                    append_log(&log_path, &format!("reporter discovery file: {}", path.display()));
                    app.manage(DiscoveryFile(path));
                }
                // Not fatal: the reporter can still be pointed here by hand with
                // the URL and token shown in Settings.
                Err(e) => append_log(&log_path, &format!("failed to write reporter discovery file: {e}")),
            }

            // --- run-in-background flag (persisted across launches) ---
            let run_bg_initial = app
                .store(STORE_FILE)
                .ok()
                .and_then(|s| s.get(RUN_BG_KEY))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let run_bg = Arc::new(AtomicBool::new(run_bg_initial));
            app.manage(RunInBackground(run_bg.clone()));

            // Flipped on a deliberate quit so the server supervisor tells an
            // intentional shutdown apart from a crash worth restarting.
            let shutting_down = Arc::new(AtomicBool::new(false));
            app.manage(ShuttingDown(shutting_down.clone()));

            // --- resolve the bundled server entry (shipped unpacked via resources) ---
            // Tauri may place the resource at <res>/resources/app-server (preserving
            // the config-relative path) or <res>/app-server — accept either.
            let resource_dir = app.path().resource_dir()?;
            let candidates = [
                resource_dir
                    .join("resources")
                    .join("app-server")
                    .join(".output")
                    .join("server")
                    .join("index.mjs"),
                resource_dir
                    .join("app-server")
                    .join(".output")
                    .join("server")
                    .join("index.mjs"),
            ];
            let server_entry = candidates
                .iter()
                .find(|p| p.exists())
                .cloned()
                .unwrap_or_else(|| candidates[0].clone());
            append_log(
                &log_path,
                &format!(
                    "server entry: {} (exists: {}), port: {}",
                    server_entry.display(),
                    server_entry.exists(),
                    port
                ),
            );

            // --- spawn and supervise the Node sidecar running the Nitro server ---
            // A spawn failure is logged and surfaces as a readiness timeout (the
            // splash shows an error) instead of a silent panic. Once running, the
            // supervisor restarts the server if it exits unexpectedly (e.g. an OOM
            // crash) so the window is never left pointed at a dead port.
            let server_config = ServerConfig {
                server_entry: server_entry.clone(),
                db_path: db_path.clone(),
                storage_dir: storage_dir.clone(),
                secret,
                token: token.clone(),
                port,
                log_path: log_path.clone(),
            };
            if let Some(initial) = spawn_server_process(app.handle(), &server_config) {
                supervise_server(app.handle().clone(), server_config, initial, shutting_down.clone());
            }

            // --- when the server is ready, navigate the window to it ---
            let nav_handle = app.handle().clone();
            let ready_log = log_path.clone();
            let bootstrap_url = format!("http://127.0.0.1:{port}/__piwi/session?token={token}");
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(READY_TIMEOUT_SECS);
                let mut ready = false;
                while Instant::now() < deadline {
                    if health_ok(port) {
                        ready = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                append_log(
                    &ready_log,
                    if ready { "server ready" } else { "server NOT ready within timeout" },
                );
                let inner = nav_handle.clone();
                let _ = nav_handle.run_on_main_thread(move || {
                    if let Some(w) = inner.get_webview_window("main") {
                        if ready {
                            let _ =
                                w.eval(&format!("window.location.replace('{bootstrap_url}')"));
                        } else {
                            let _ = w.eval(
                                "var s=document.querySelector('.status');if(s){s.textContent='The server did not start in time. Quit and relaunch, or check the logs.';}",
                            );
                            let _ = w.show();
                        }
                    }
                });
            });

            // --- tray ---
            let open_i = MenuItemBuilder::with_id("open", "Open Piwi Dashboard").build(app)?;
            let folder_i = MenuItemBuilder::with_id("open_folder", "Open data folder").build(app)?;
            let bg_i = CheckMenuItemBuilder::with_id("run_bg", "Run in background")
                .checked(run_bg_initial)
                .build(app)?;
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let login_i = CheckMenuItemBuilder::with_id("autostart", "Start on login")
                .checked(autostart_enabled)
                .build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit Piwi Dashboard").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&open_i)
                .item(&folder_i)
                .separator()
                .item(&bg_i)
                .item(&login_i)
                .separator()
                .item(&quit_i)
                .build()?;

            let menu_run_bg = run_bg.clone();
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Piwi Dashboard (click to open)")
                .menu(&menu)
                // Left-click opens the window; right-click shows the menu. Without
                // this a left-click did nothing, so the tray looked inert (and on
                // Windows the icon hides in the overflow area by default).
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "open_folder" => {
                        let dir = app.state::<DataDir>().0.clone();
                        let _ = app
                            .opener()
                            .open_path(dir.to_string_lossy().to_string(), None::<&str>);
                    }
                    "run_bg" => {
                        let next = !menu_run_bg.load(Ordering::SeqCst);
                        menu_run_bg.store(next, Ordering::SeqCst);
                        let _ = bg_i.set_checked(next);
                        if let Ok(store) = app.store(STORE_FILE) {
                            store.set(RUN_BG_KEY, json!(next));
                            let _ = store.save();
                        }
                    }
                    "autostart" => {
                        let mgr = app.autolaunch();
                        let enabled = mgr.is_enabled().unwrap_or(false);
                        let _ = if enabled { mgr.disable() } else { mgr.enable() };
                        let _ = login_i.set_checked(!enabled);
                    }
                    "quit" => {
                        let handle = app.clone();
                        confirm_stopping_local_runs(app, "Quit Piwi?", "quitting", "Quit", move || {
                            handle.exit(0);
                        });
                    }
                    _ => {}
                })
                .build(app)?;

            // If autostarted with --hidden, stay in the tray instead of popping up.
            if launched_hidden {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // Archives passed on the very first launch ("Open with" while the
            // app was closed) — queued now, drained once the dashboard boots.
            let argv: Vec<String> = std::env::args().skip(1).collect();
            let launch_cwd = std::env::current_dir().ok();
            queue_open_files(
                app.handle(),
                collect_zip_args(argv.iter().map(String::as_str), launch_cwd.as_deref()),
            );

            // e2e builds: grant the Playwright plugin's result-callback command to
            // the loopback (remote) origin the dashboard runs at, so the driven
            // page can post results back. Added at runtime so the permission only
            // exists in test builds — the shipped ACL never references it.
            #[cfg(feature = "e2e-testing")]
            {
                let _ = app.handle().add_capability(E2E_PLAYWRIGHT_CAPABILITY);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // The dashboard window is the one whose close ends the app.
                if window.label() != "main" {
                    return;
                }
                let keep = window
                    .try_state::<RunInBackground>()
                    .map(|s| s.0.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if keep {
                    // Hide to tray and keep the server running.
                    let _ = window.hide();
                    api.prevent_close();
                    return;
                }
                if hold_close_for_local_runs(window) {
                    api.prevent_close();
                }
            }
        })
        .build(context)
        .expect("error while building the Piwi Dashboard app")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } => {
                // Tell the supervisor this stop is deliberate so it doesn't restart
                // the server we are about to kill.
                if let Some(flag) = app_handle.try_state::<ShuttingDown>() {
                    flag.0.store(true, Ordering::SeqCst);
                }
                // Best-effort: stop the bundled server so no orphan process lingers.
                if let Some(child) = app_handle.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
                // Local test runs die with the shell — never orphan a browser fleet.
                if let Some(runs) = app_handle.try_state::<runner::LocalRuns>() {
                    runs.kill_all();
                }
                // Withdraw the reporter discovery file with the server it points
                // at, so a later test run does not try a dead port.
                if let Some(discovery) = app_handle.try_state::<DiscoveryFile>() {
                    let _ = std::fs::remove_file(&discovery.0);
                }
            }
            // macOS delivers file-association opens as an event, not argv.
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .filter(|p| p.to_lowercase().ends_with(".zip"))
                    .collect();
                queue_open_files(app_handle, paths);
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::write_new_download;
    use std::fs;

    #[test]
    fn does_not_overwrite_an_existing_download() {
        let dir = std::env::temp_dir().join(format!("piwi-dl-a-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p1 = write_new_download(&dir, "report.zip", b"one").unwrap();
        assert_eq!(p1.file_name().unwrap(), "report.zip");
        // A second download of the same name must not overwrite the first.
        let p2 = write_new_download(&dir, "report.zip", b"two").unwrap();
        assert_ne!(p1, p2);
        assert_eq!(p2.file_name().unwrap(), "report (1).zip");
        assert_eq!(fs::read(&p1).unwrap(), b"one"); // original bytes intact
        assert_eq!(fs::read(&p2).unwrap(), b"two");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn disambiguates_extensionless_names() {
        let dir = std::env::temp_dir().join(format!("piwi-dl-b-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p1 = write_new_download(&dir, "LICENSE", b"a").unwrap();
        let p2 = write_new_download(&dir, "LICENSE", b"b").unwrap();
        assert_eq!(p1.file_name().unwrap(), "LICENSE");
        assert_eq!(p2.file_name().unwrap(), "LICENSE (1)");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn increments_counter_on_repeated_collisions() {
        let dir = std::env::temp_dir().join(format!("piwi-dl-c-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let _ = write_new_download(&dir, "a.txt", b"1").unwrap();
        let _ = write_new_download(&dir, "a.txt", b"2").unwrap();
        let p3 = write_new_download(&dir, "a.txt", b"3").unwrap();
        assert_eq!(p3.file_name().unwrap(), "a (2).txt");
        let _ = fs::remove_dir_all(&dir);
    }
}
