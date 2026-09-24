// In-app updates via the Tauri updater.
//
// Only release builds made with the signing key support updates: CI applies an
// updater overlay (`tauri.updater.conf.json` for the .msi channel,
// `tauri.updater.nsis.conf.json` for the per-user .exe channel) when the key
// secret is configured, and that config is what compiles the updater plugin
// config into the app. Everything here degrades to `unsupported` when the
// config is absent, so dev builds and unsigned releases keep working with the
// whole update surface hidden.
//
// Flow: `desktop_check_update` asks the endpoint and parks the found update in
// state; `desktop_install_update` downloads + installs it, streaming progress
// as `piwi:update-progress` events; the dashboard then calls
// `desktop_restart_app` to relaunch into the new version. On Windows the
// install step never returns: the plugin launches the installer and exits the
// app itself (see `SERVER_STOP_WAIT`).

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter as _, Manager as _};
use tauri_plugin_updater::UpdaterExt as _;

/// How long the Windows install waits for the server sidecar to be gone.
///
/// There the plugin hands over to the installer and leaves through
/// `std::process::exit`, which skips `RunEvent::ExitRequested` and with it the
/// quit cleanup — so the updater's pre-exit hook runs it instead. Left running,
/// the Node sidecar outlives the app with the bundled native modules loaded
/// (sharp's libvips DLLs), and the installer fails on them with "Error opening
/// file for writing". The installer stops a stray sidecar as well
/// (`windows/installer-hooks.nsh`), for updates started by builds without this.
const SERVER_STOP_WAIT: Duration = Duration::from_secs(5);

/// Whether this build carries updater config (set at startup from the
/// compiled Tauri config).
pub struct UpdaterSupport(pub bool);

/// The update found by the last successful check, awaiting installation.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Clone, serde::Serialize)]
pub struct UpdateStatus {
    /// `unsupported` | `uptodate` | `available`
    state: &'static str,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
}

impl UpdateStatus {
    fn bare(state: &'static str) -> Self {
        Self {
            state,
            version: None,
            notes: None,
            date: None,
        }
    }
}

#[tauri::command]
pub async fn desktop_check_update(app: AppHandle) -> Result<UpdateStatus, String> {
    let supported = app
        .try_state::<UpdaterSupport>()
        .map(|s| s.0)
        .unwrap_or(false);
    if !supported {
        return Ok(UpdateStatus::bare("unsupported"));
    }

    let hook_app = app.clone();
    let updater = app
        .updater_builder()
        // Setting a hook drops the plugin's default one (`cleanup_before_exit`),
        // so this calls it too.
        .on_before_exit(move || {
            crate::shut_down(&hook_app, Some(SERVER_STOP_WAIT));
            hook_app.cleanup_before_exit();
        })
        .build()
        .map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let status = UpdateStatus {
                state: "available",
                version: Some(update.version.clone()),
                notes: update.body.clone(),
                date: update.date.map(|d| d.to_string()),
            };
            app.state::<PendingUpdate>()
                .0
                .lock()
                .unwrap()
                .replace(update);
            Ok(status)
        }
        None => Ok(UpdateStatus::bare("uptodate")),
    }
}

/// Download and install the update found by the last check. Progress streams
/// as `piwi:update-progress` events; on macOS and Linux the app keeps running
/// until the dashboard asks for the restart, on Windows it quits into the
/// installer.
#[tauri::command]
pub async fn desktop_install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .state::<PendingUpdate>()
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("no update pending — run a check first")?;

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "piwi:update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_restart_app(app: AppHandle) {
    let handle = app.clone();
    crate::confirm_stopping_local_runs(&app, "Restart Piwi?", "restarting", "Restart", move || {
        handle.restart();
    });
}
