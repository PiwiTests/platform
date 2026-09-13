use tauri_build::{AppManifest, Attributes};

// Declare our custom (app) commands so Tauri autogenerates an `allow-<command>`
// permission for each. The dashboard is served from a real loopback server, so
// the webview runs at a *remote* origin (`http://127.0.0.1:<port>`) — and Tauri
// refuses to expose app commands to remote content unless a capability
// explicitly grants them (see `capabilities/remote.json`). Without this, every
// `invoke(...)` from the window is rejected by the ACL.
//
// Command names here MUST stay in sync with `tauri::generate_handler!` in
// `src/lib.rs` and the `allow-*` grants in the capability files; the
// `desktop-acl-consistency` test enforces that.
fn main() {
    tauri_build::try_build(
        Attributes::new().app_manifest(AppManifest::new().commands(&[
            "desktop_get_service_settings",
            "desktop_set_run_in_background",
            "desktop_set_start_on_login",
            "desktop_open_external",
            "desktop_notify",
            "desktop_save_download",
            "desktop_pick_folder",
            "desktop_pick_import_files",
            "desktop_inspect_folder",
            "desktop_find_importable_runs",
            "desktop_get_project_link",
            "desktop_set_project_link",
            "desktop_run_local_tests",
            "desktop_stop_local_tests",
            "desktop_set_project_start_command",
            "desktop_reproduce_here",
            "desktop_bisect_here",
            "desktop_check_local_specs",
            "desktop_check_local_env",
            "desktop_take_pending_open_files",
            "desktop_mcp_clients",
            "desktop_mcp_connect",
            "desktop_mcp_disconnect",
            "desktop_mcp_reveal",
            "desktop_check_update",
            "desktop_install_update",
            "desktop_restart_app",
            "desktop_set_activity",
        ])),
    )
    .expect("failed to run tauri-build");
}
