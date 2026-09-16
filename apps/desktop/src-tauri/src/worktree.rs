// Reproducing a failure and driving a git bisect against a linked project folder,
// without ever touching the user's checkout.
//
// A reproduction and a bisect both run in a throwaway `git worktree` of a commit,
// created under this app's data dir — never inside the linked folder — so the
// user's HEAD, uncommitted changes and `node_modules` are left alone. The shell
// drives every step itself (checkout · install · browser · test, and for a bisect
// the good/bad loop) and streams progress into the Local runs tray on the same
// `piwi:local-run` channel a normal local run uses.
//
// The webview only ever names a project and a commit window; `git` is invoked
// through a fixed set of subcommands with validated arguments (SHAs match
// `^[0-9a-f]{7,40}$`, worktree paths are canonicalized and must sit under the
// worktrees dir), and the user's own start command — when the config has no
// `webServer` — is read from the stored settings, never passed in at run time.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter as _, Manager as _};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt as _;

use crate::node_path;
use crate::runner::{
    linked_folder, resolve_playwright_cli, validate_args, Job, LinkRecord, LocalRuns,
    RunEventPayload, RUN_EVENT,
};

/// A bisect progress event carried on a `piwi:local-run` event of kind `bisect`.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BisectEvent {
    /// `step` (a new candidate), `verdict` (good/bad/skipped), or `result` (done).
    pub event: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps_estimate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_bad: Option<FirstBad>,
}

/// The first bad commit a bisect named, as `git show -s` reported it.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstBad {
    pub sha: String,
    pub subject: String,
    pub author: Option<String>,
    pub date: Option<String>,
}

/// How to tear a job's worktree down: reset an in-progress bisect, then remove
/// the worktree from the main repo. Run once, whether the driver finishes, the
/// user stops it, or the app quits.
pub struct Cleanup {
    pub git: PathBuf,
    pub folder: PathBuf,
    pub worktree: PathBuf,
    pub bisect: bool,
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/// A commit reference the webview may hand us: 7–40 lowercase hex. Anything else
/// is rejected before it reaches a `git` argument.
pub(crate) fn valid_sha(sha: &str) -> bool {
    let len = sha.len();
    (7..=40).contains(&len)
        && sha
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// The package managers a worktree install can use, chosen from the lockfile.
#[derive(Debug, PartialEq, Clone, Copy)]
pub(crate) enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
}

impl PackageManager {
    /// The lockfile whose presence selects this manager.
    fn lockfile(self) -> &'static str {
        match self {
            PackageManager::Npm => "package-lock.json",
            PackageManager::Pnpm => "pnpm-lock.yaml",
            PackageManager::Yarn => "yarn.lock",
        }
    }

    /// The tool name and the frozen-install arguments for a clean install.
    fn install_command(self) -> (&'static str, &'static [&'static str]) {
        match self {
            PackageManager::Npm => ("npm", &["ci"]),
            PackageManager::Pnpm => ("pnpm", &["install", "--frozen-lockfile"]),
            PackageManager::Yarn => ("yarn", &["install", "--frozen-lockfile"]),
        }
    }
}

/// Which package manager a folder uses, read from its lockfile. npm is the
/// baseline when no lockfile — or only `package-lock.json` — is present.
pub(crate) fn detect_package_manager(folder: &Path) -> PackageManager {
    if folder.join("pnpm-lock.yaml").is_file() {
        PackageManager::Pnpm
    } else if folder.join("yarn.lock").is_file() {
        PackageManager::Yarn
    } else {
        PackageManager::Npm
    }
}

/// Whether two files exist and hold byte-identical contents — the test for the
/// cheap install path: an unchanged lockfile means the worktree can share the
/// linked folder's `node_modules` instead of installing.
pub(crate) fn files_equal(a: &Path, b: &Path) -> bool {
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// Whether `candidate` sits inside `base`. Both must be canonicalized by the
/// caller so `..` and symlinks cannot escape the containment check.
pub(crate) fn path_within(base: &Path, candidate: &Path) -> bool {
    candidate.starts_with(base)
}

/// git's own bisect progress, parsed from the output of a `bisect` step:
/// `Bisecting: N revisions left to test after this (roughly M steps)` names the
/// remaining work, and the following `[<sha>] <subject>` line names the commit it
/// checked out.
#[derive(Debug, PartialEq)]
pub(crate) struct BisectProgress {
    pub revisions_left: u32,
    pub steps_remaining: u32,
    pub sha: Option<String>,
}

pub(crate) fn parse_bisect_progress(output: &str) -> Option<BisectProgress> {
    let mut progress: Option<BisectProgress> = None;
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Bisecting: ") {
            // "N revisions left to test after this (roughly M steps)"
            let revisions_left = rest
                .split_whitespace()
                .next()
                .and_then(|n| n.parse().ok())?;
            let steps_remaining = rest
                .split("roughly ")
                .nth(1)
                .and_then(|tail| tail.split_whitespace().next())
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
            progress = Some(BisectProgress {
                revisions_left,
                steps_remaining,
                sha: None,
            });
        } else if let (Some(p), Some(sha)) = (progress.as_mut(), parse_candidate_sha(line)) {
            p.sha = Some(sha);
        }
    }
    progress
}

/// The commit sha from a `[<40-hex>] <subject>` checkout line, if the line is one.
fn parse_candidate_sha(line: &str) -> Option<String> {
    let rest = line.strip_prefix('[')?;
    let (sha, _) = rest.split_once(']')?;
    (sha.len() >= 7 && sha.bytes().all(|b| b.is_ascii_hexdigit())).then(|| sha.to_lowercase())
}

/// The first bad commit's sha, parsed from `<sha> is the first bad commit`.
pub(crate) fn parse_first_bad(output: &str) -> Option<String> {
    for line in output.lines() {
        if let Some(sha) = line.trim().strip_suffix(" is the first bad commit") {
            if sha.len() >= 7 && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Some(sha.to_lowercase());
            }
        }
    }
    None
}

/// The executable candidate names for a tool on this platform (Windows resolves
/// `.cmd`/`.exe` shims; POSIX uses the bare name).
fn tool_candidates(name: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        vec![
            format!("{name}.cmd"),
            format!("{name}.exe"),
            name.to_string(),
        ]
    }
    #[cfg(not(windows))]
    {
        vec![name.to_string()]
    }
}

/// Find the first `candidates` entry that exists as a file in one of `dirs`, in
/// order. Pure so the resolution order is unit-testable without a real PATH.
pub(crate) fn resolve_tool_in(dirs: &[PathBuf], candidates: &[String]) -> Option<PathBuf> {
    for dir in dirs {
        for candidate in candidates {
            let p = dir.join(candidate);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// The directories searched for a user tool: `PATH`, then the well-known install
/// locations a GUI app on macOS does not inherit `PATH` for.
fn tool_search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let home = app.path().home_dir().ok();
    for extra in [
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/bin"),
    ] {
        dirs.push(extra);
    }
    if let Some(home) = &home {
        dirs.push(home.join(".volta").join("bin"));
        // The active-version bin dirs under nvm, best-effort.
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm").join("versions").join("node")) {
            for entry in entries.flatten() {
                dirs.push(entry.path().join("bin"));
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(&pf).join("Git").join("cmd"));
            dirs.push(PathBuf::from(&pf).join("nodejs"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
    }
    dirs
}

/// Resolve a user tool (`git`, `npm`, `pnpm`, `yarn`) to an absolute path, or
/// `None` when it is not installed anywhere the shell knows to look.
fn resolve_tool(app: &AppHandle, name: &str) -> Option<PathBuf> {
    resolve_tool_in(&tool_search_dirs(app), &tool_candidates(name))
}

// ── Worktree location + cwd validation ────────────────────────────────────────

/// The root under which every worktree is created: `<app data>/worktrees`. Never
/// inside a linked folder.
fn worktrees_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("worktrees");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Validate a `cwd` a local run was pointed at: it must canonicalize to a real
/// directory inside this app's worktrees dir. Used by `desktop_run_local_tests`
/// so the webview cannot redirect a run at an arbitrary folder.
pub(crate) fn validate_worktree_cwd(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
    let root = worktrees_root(app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let candidate = PathBuf::from(dir)
        .canonicalize()
        .map_err(|_| "the worktree no longer exists".to_string())?;
    if !path_within(&root, &candidate) {
        return Err("the run folder must be inside the app's worktrees directory".into());
    }
    Ok(candidate)
}

// ── Process-tree kill + cleanup (called from LocalRuns stop / kill_all) ─────────

/// Kill a child and the process tree it spawned (a test can start browsers and a
/// webServer). Best-effort: on Windows `taskkill /T /F`; on Unix the process and
/// its direct children (the browsers Playwright launches), then a SIGKILL sweep.
pub(crate) fn kill_child_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(windows))]
    {
        let pid = pid.to_string();
        // Children first so nothing is reparented away before we reach it.
        let _ = Command::new("pkill").args(["-TERM", "-P", &pid]).output();
        let _ = Command::new("kill").args(["-TERM", &pid]).output();
        let _ = Command::new("pkill").args(["-KILL", "-P", &pid]).output();
        let _ = Command::new("kill").args(["-KILL", &pid]).output();
    }
}

/// Reset any in-progress bisect and remove the worktree — once. Best-effort: the
/// app must exit cleanly even when git is gone or the worktree is already gone.
pub(crate) fn perform_cleanup(cleanup: &Cleanup, cleaned: &AtomicBool) {
    if cleaned.swap(true, Ordering::SeqCst) {
        return;
    }
    if cleanup.bisect {
        let _ = Command::new(&cleanup.git)
            .args(["bisect", "reset"])
            .current_dir(&cleanup.worktree)
            .output();
    }
    let _ = Command::new(&cleanup.git)
        .arg("-C")
        .arg(&cleanup.folder)
        .args(["worktree", "remove", "--force"])
        .arg(&cleanup.worktree)
        .output();
    let _ = Command::new(&cleanup.git)
        .arg("-C")
        .arg(&cleanup.folder)
        .args(["worktree", "prune"])
        .output();
}

// ── git plumbing ──────────────────────────────────────────────────────────────

/// Run a git subcommand and capture its combined stdout+stderr; `Err` carries the
/// output when git exits non-zero.
fn git_capture(git: &Path, dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new(git)
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if out.status.success() {
        Ok(text)
    } else {
        Err(text.trim().to_string())
    }
}

/// Whether a commit is known to the repository at `folder`.
fn commit_exists(git: &Path, folder: &Path, sha: &str) -> bool {
    Command::new(git)
        .arg("-C")
        .arg(folder)
        .args(["cat-file", "-e", &format!("{sha}^{{commit}}")])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── Emitting ──────────────────────────────────────────────────────────────────

fn emit(app: &AppHandle, payload: RunEventPayload) {
    let _ = app.emit(RUN_EVENT, &payload);
}

fn emit_line(app: &AppHandle, id: u32, kind: &'static str, text: impl Into<String>) {
    emit(app, RunEventPayload::line(id, kind, text.into()));
}

// ── Install / browser / test phases (streaming) ───────────────────────────────

/// Symlink (or junction on Windows) the linked folder's `node_modules` into the
/// worktree, the cheap path when the lockfile is unchanged.
fn link_node_modules(folder: &Path, worktree: &Path) -> Result<(), String> {
    let src = folder.join("node_modules");
    let dst = worktree.join("node_modules");
    if dst.exists() {
        return Ok(());
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(&src, &dst).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(&src, &dst).map_err(|e| e.to_string())
    }
}

/// Install dependencies in the worktree. Prefers linking the linked folder's
/// `node_modules` when the lockfile is byte-identical; otherwise runs the folder's
/// package manager. Returns whether the step succeeded.
fn install_worktree(
    app: &AppHandle,
    id: u32,
    folder: &Path,
    worktree: &Path,
    stop: &AtomicBool,
) -> bool {
    let pm = detect_package_manager(folder);
    let lockfile = pm.lockfile();
    let folder_lock = folder.join(lockfile);
    let worktree_lock = worktree.join(lockfile);
    let folder_modules = folder.join("node_modules").is_dir();

    if folder_modules && files_equal(&folder_lock, &worktree_lock) {
        match link_node_modules(folder, worktree) {
            Ok(()) => {
                emit_line(
                    app,
                    id,
                    "stdout",
                    format!("Linked node_modules ({lockfile} unchanged)."),
                );
                return true;
            }
            Err(e) => emit_line(
                app,
                id,
                "stderr",
                format!("Could not link node_modules ({e}); installing."),
            ),
        }
    }

    let (tool, tool_args) = pm.install_command();
    let Some(bin) = resolve_tool(app, tool) else {
        emit_line(app, id, "error", format!("`{tool}` was not found — install it, or open the linked folder and install dependencies there."));
        return false;
    };
    emit_line(app, id, "stdout", format!("{tool} {}", tool_args.join(" ")));
    run_std_streaming(app, id, &bin, tool_args, worktree, stop)
        .map(|code| code == 0)
        .unwrap_or(false)
}

/// Install the browser the failure ran on, only when it is not already in
/// Playwright's cache. Uses the worktree's own Playwright CLI via the sidecar.
async fn ensure_browser(
    app: &AppHandle,
    id: u32,
    worktree: &Path,
    cli: &Path,
    browser: Option<&str>,
) -> bool {
    let Some(browser) = browser else {
        return true; // Unknown browser — the run installs on demand.
    };
    if browser_cached(app, browser) {
        emit_line(app, id, "stdout", format!("{browser} already installed."));
        return true;
    }
    emit_line(app, id, "stdout", format!("Installing {browser}…"));
    let args = vec![node_path(cli), "install".into(), browser.to_string()];
    run_sidecar_streaming(app, id, None, worktree, args)
        .await
        .map(|code| code == 0)
        .unwrap_or(false)
}

/// A rough check for a browser already in Playwright's per-user cache, so the
/// slow `playwright install` is skipped when it is present.
fn browser_cached(app: &AppHandle, browser: &str) -> bool {
    let Some(home) = app.path().home_dir().ok() else {
        return false;
    };
    #[cfg(target_os = "macos")]
    let cache = home.join("Library").join("Caches").join("ms-playwright");
    #[cfg(target_os = "windows")]
    let cache = home.join("AppData").join("Local").join("ms-playwright");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let cache = home.join(".cache").join("ms-playwright");
    std::fs::read_dir(&cache)
        .map(|entries| {
            entries.flatten().any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .to_lowercase()
                    .starts_with(browser)
            })
        })
        .unwrap_or(false)
}

/// Spawn a std process, stream its output as run events, record its pid for stop,
/// and return its exit code. Runs to completion on the calling (blocking) task.
fn run_std_streaming(
    app: &AppHandle,
    id: u32,
    bin: &Path,
    args: &[&str],
    dir: &Path,
    stop: &AtomicBool,
) -> Option<i32> {
    if stop.load(Ordering::SeqCst) {
        return None;
    }
    let mut child = match Command::new(bin)
        .args(args)
        .current_dir(dir)
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            emit_line(app, id, "error", e.to_string());
            return None;
        }
    };
    record_pid(app, id, Some(child.id()));

    if let Some(out) = child.stdout.take() {
        let app = app.clone();
        let reader = BufReader::new(out);
        std::thread::spawn(move || {
            for line in reader.lines().map_while(Result::ok) {
                emit_line(&app, id, "stdout", line);
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let app = app.clone();
        let reader = BufReader::new(err);
        std::thread::spawn(move || {
            for line in reader.lines().map_while(Result::ok) {
                emit_line(&app, id, "stderr", line);
            }
        });
    }
    let code = child.wait().ok().and_then(|s| s.code());
    record_pid(app, id, None);
    code
}

/// Spawn the Node sidecar (browser install or the test), stream its output, record
/// its pid for stop, and return its exit code.
async fn run_sidecar_streaming(
    app: &AppHandle,
    id: u32,
    cli: Option<&Path>,
    worktree: &Path,
    node_args: Vec<String>,
) -> Option<i32> {
    let _ = cli; // node_args already carry the resolved CLI path
    let command = match app.shell().sidecar("node") {
        Ok(c) => c
            .args(node_args)
            .current_dir(worktree)
            .env("NO_COLOR", "1")
            .env("FORCE_COLOR", "0"),
        Err(e) => {
            emit_line(app, id, "error", e.to_string());
            return None;
        }
    };
    let (mut rx, child) = match command.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            emit_line(app, id, "error", e.to_string());
            return None;
        }
    };
    record_pid(app, id, Some(child.pid()));
    let mut code = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => emit_line(
                app,
                id,
                "stdout",
                String::from_utf8_lossy(&line).trim_end().to_string(),
            ),
            CommandEvent::Stderr(line) => emit_line(
                app,
                id,
                "stderr",
                String::from_utf8_lossy(&line).trim_end().to_string(),
            ),
            CommandEvent::Error(err) => emit_line(app, id, "error", err),
            CommandEvent::Terminated(status) => {
                code = status.code;
                break;
            }
            _ => {}
        }
    }
    record_pid(app, id, None);
    code
}

/// Record (or clear) the pid of the child currently running for a job, so stop
/// and app-quit can tree-kill exactly what is live.
fn record_pid(app: &AppHandle, id: u32, pid: Option<u32>) {
    if let Some(runs) = app.try_state::<LocalRuns>() {
        runs.set_job_pid(id, pid);
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Resolve the linked folder for a project, checking it is on disk and a git repo.
fn resolve_repo(
    app: &AppHandle,
    project_id: &str,
) -> Result<(LinkRecord, PathBuf, PathBuf), String> {
    let record = linked_folder(app, project_id).ok_or("no folder is linked to this project")?;
    let folder = PathBuf::from(&record.path);
    if !folder.is_dir() {
        return Err("the linked folder no longer exists — pick it again".into());
    }
    let git = resolve_tool(app, "git").ok_or("git was not found — install it and try again")?;
    if !folder.join(".git").exists() {
        return Err("the linked folder is not a git repository".into());
    }
    Ok((record, folder, git))
}

/// Prepare a worktree of `commit` under the worktrees dir, keyed by project and
/// short sha. Returns the worktree path.
fn add_worktree(
    app: &AppHandle,
    git: &Path,
    folder: &Path,
    project_id: &str,
    commit: &str,
) -> Result<PathBuf, String> {
    if !commit_exists(git, folder, commit) {
        return Err(format!(
            "commit {} is unknown to the linked repository — run `git fetch` in it first.",
            &commit[..commit.len().min(12)]
        ));
    }
    let worktree = worktrees_root(app)?
        .join(project_id)
        .join(&commit[..commit.len().min(12)]);
    // A stale worktree from a previous run at the same commit blocks `add`.
    if worktree.exists() {
        let _ = Command::new(git)
            .arg("-C")
            .arg(folder)
            .args(["worktree", "remove", "--force"])
            .arg(&worktree)
            .output();
        let _ = std::fs::remove_dir_all(&worktree);
    }
    if let Some(parent) = worktree.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    git_capture(
        git,
        folder,
        &[
            "worktree",
            "add",
            "--detach",
            &worktree.to_string_lossy(),
            commit,
        ],
    )?;
    Ok(worktree)
}

/// Reproduce the failing test(s) end to end in a throwaway worktree of `commit`:
/// checkout · install · browser · test. Returns a run id; progress streams as
/// `piwi:local-run` events. The user's checkout is never touched.
#[tauri::command]
pub async fn desktop_reproduce_here(
    app: AppHandle,
    project_id: String,
    commit: String,
    args: Vec<String>,
    browser: Option<String>,
) -> Result<u32, String> {
    validate_args(&args)?;
    if !valid_sha(&commit) {
        return Err("invalid commit".into());
    }
    let (_record, folder, git) = resolve_repo(&app, &project_id)?;

    let state = app.state::<LocalRuns>();
    let id = state.allocate_id();
    let stop = Arc::new(AtomicBool::new(false));
    let cleaned = Arc::new(AtomicBool::new(false));
    let worktree = add_worktree(&app, &git, &folder, &project_id, &commit)?;
    state.register_job(
        id,
        Job {
            stop: stop.clone(),
            pid: Arc::new(Mutex::new(None)),
            cleanup: Cleanup {
                git: git.clone(),
                folder: folder.clone(),
                worktree: worktree.clone(),
                bisect: false,
            },
            cleaned: cleaned.clone(),
        },
    );

    tauri::async_runtime::spawn(async move {
        let code = reproduce_driver(
            &app,
            id,
            &folder,
            &git,
            &worktree,
            &args,
            browser.as_deref(),
            &stop,
        )
        .await;
        finish_job(&app, id, &git, &folder, &worktree, false, &cleaned, code);
    });
    Ok(id)
}

async fn reproduce_driver(
    app: &AppHandle,
    id: u32,
    folder: &Path,
    _git: &Path,
    worktree: &Path,
    args: &[String],
    browser: Option<&str>,
    stop: &AtomicBool,
) -> Option<i32> {
    emit(app, RunEventPayload::phase(id, "checkout"));
    emit_line(
        app,
        id,
        "stdout",
        "Worktree ready — your checkout is untouched.",
    );
    emit_line(
        app,
        id,
        "stdout",
        "The commit's own Playwright version is used — not the run's pin.",
    );

    emit(app, RunEventPayload::phase(id, "install"));
    if stop.load(Ordering::SeqCst) || !install_worktree(app, id, folder, worktree, stop) {
        return None;
    }
    run_test_phase(app, id, worktree, args, browser, stop).await
}

/// The browser + test phases shared by reproduce and each bisect step.
async fn run_test_phase(
    app: &AppHandle,
    id: u32,
    worktree: &Path,
    args: &[String],
    browser: Option<&str>,
    stop: &AtomicBool,
) -> Option<i32> {
    let cli = resolve_playwright_cli(worktree)?;

    emit(app, RunEventPayload::phase(id, "browser"));
    if stop.load(Ordering::SeqCst) || !ensure_browser(app, id, worktree, &cli, browser).await {
        return None;
    }

    emit(app, RunEventPayload::phase(id, "test"));
    if stop.load(Ordering::SeqCst) {
        return None;
    }
    let mut node_args = vec![node_path(&cli), "test".to_string()];
    node_args.extend(args.iter().cloned());
    run_sidecar_streaming(app, id, Some(&cli), worktree, node_args).await
}

/// Drive a git bisect over the window `good..bad` in a throwaway worktree, step by
/// step, naming the first bad commit. Returns a run id; progress streams as
/// `piwi:local-run` events.
#[tauri::command]
pub async fn desktop_bisect_here(
    app: AppHandle,
    project_id: String,
    good: String,
    bad: String,
    args: Vec<String>,
    browser: Option<String>,
) -> Result<u32, String> {
    validate_args(&args)?;
    if !valid_sha(&good) || !valid_sha(&bad) {
        return Err("invalid commit".into());
    }
    let (_record, folder, git) = resolve_repo(&app, &project_id)?;
    if !commit_exists(&git, &folder, &good) || !commit_exists(&git, &folder, &bad) {
        return Err(format!(
            "one of the commits is unknown to the linked repository — run `git fetch {}` in it first.",
            &bad[..bad.len().min(12)]
        ));
    }
    // The good commit must be an ancestor of the bad one for a bisect to make sense.
    let ancestor = Command::new(&git)
        .arg("-C")
        .arg(&folder)
        .args(["merge-base", "--is-ancestor", &good, &bad])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !ancestor {
        return Err("the last green commit is not an ancestor of the failing commit — the window does not make sense for a bisect.".into());
    }

    let state = app.state::<LocalRuns>();
    let id = state.allocate_id();
    let stop = Arc::new(AtomicBool::new(false));
    let cleaned = Arc::new(AtomicBool::new(false));
    let worktree = add_worktree(&app, &git, &folder, &project_id, &bad)?;
    state.register_job(
        id,
        Job {
            stop: stop.clone(),
            pid: Arc::new(Mutex::new(None)),
            cleanup: Cleanup {
                git: git.clone(),
                folder: folder.clone(),
                worktree: worktree.clone(),
                bisect: true,
            },
            cleaned: cleaned.clone(),
        },
    );

    tauri::async_runtime::spawn(async move {
        let code = bisect_driver(
            &app,
            id,
            &git,
            &worktree,
            &folder,
            &good,
            &bad,
            &args,
            browser.as_deref(),
            &stop,
        )
        .await;
        finish_job(&app, id, &git, &folder, &worktree, true, &cleaned, code);
    });
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
async fn bisect_driver(
    app: &AppHandle,
    id: u32,
    git: &Path,
    worktree: &Path,
    folder: &Path,
    good: &str,
    bad: &str,
    args: &[String],
    browser: Option<&str>,
    stop: &AtomicBool,
) -> Option<i32> {
    emit(app, RunEventPayload::phase(id, "bisect"));
    let start = git_capture(git, worktree, &["bisect", "start", bad, good]);
    let mut output = match start {
        Ok(text) => text,
        Err(e) => {
            emit_line(app, id, "error", e);
            return None;
        }
    };

    let mut step: u32 = 0;
    loop {
        if stop.load(Ordering::SeqCst) {
            return None;
        }
        if let Some(sha) = parse_first_bad(&output) {
            let first_bad = describe_commit(git, worktree, &sha);
            emit(
                app,
                RunEventPayload::bisect(
                    id,
                    BisectEvent {
                        event: "result",
                        step: None,
                        steps_estimate: None,
                        sha: None,
                        verdict: None,
                        first_bad: Some(first_bad),
                    },
                ),
            );
            return Some(0);
        }
        let Some(progress) = parse_bisect_progress(&output) else {
            emit_line(app, id, "error", "Could not read git bisect progress.");
            return None;
        };
        step += 1;
        let candidate = progress.sha.clone();
        emit(
            app,
            RunEventPayload::bisect(
                id,
                BisectEvent {
                    event: "step",
                    step: Some(step),
                    steps_estimate: Some(step + progress.steps_remaining),
                    sha: candidate.clone(),
                    verdict: None,
                    first_bad: None,
                },
            ),
        );

        // Install can change inside the window, so re-check the lockfile each step.
        let installed = install_worktree(app, id, folder, worktree, stop);
        let browser_ok =
            installed && ensure_browser_for_step(app, id, worktree, browser, stop).await;
        // The sub-command that judges this commit — `skip` when it cannot be
        // built or tested, otherwise `good`/`bad` from the test's exit code. Each
        // advances the bisect and prints the next candidate, which becomes the
        // output the loop reads next.
        let verdict = if !installed || !browser_ok {
            "skip"
        } else {
            let code = run_test_phase(app, id, worktree, args, browser, stop).await;
            if stop.load(Ordering::SeqCst) {
                return None;
            }
            if code == Some(0) {
                "good"
            } else {
                "bad"
            }
        };
        match git_capture(git, worktree, &["bisect", verdict]) {
            Ok(text) => output = text,
            Err(e) => {
                emit_line(app, id, "error", e);
                return None;
            }
        }
        let reported = if verdict == "skip" {
            "skipped"
        } else {
            verdict
        };
        emit(
            app,
            RunEventPayload::bisect(
                id,
                BisectEvent {
                    event: "verdict",
                    step: Some(step),
                    steps_estimate: None,
                    sha: candidate,
                    verdict: Some(reported.to_string()),
                    first_bad: None,
                },
            ),
        );
    }
}

/// The browser phase for a bisect step, without emitting the "browser" phase
/// header on every step (the tray already shows the candidate).
async fn ensure_browser_for_step(
    app: &AppHandle,
    id: u32,
    worktree: &Path,
    browser: Option<&str>,
    stop: &AtomicBool,
) -> bool {
    if stop.load(Ordering::SeqCst) {
        return false;
    }
    let Some(cli) = resolve_playwright_cli(worktree) else {
        return false;
    };
    ensure_browser(app, id, worktree, &cli, browser).await
}

/// `git show -s` for a commit, as the identity the tray shows and the cluster
/// records.
fn describe_commit(git: &Path, worktree: &Path, sha: &str) -> FirstBad {
    let full = git_capture(git, worktree, &["rev-parse", sha])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| sha.to_string());
    let subject = git_capture(git, worktree, &["show", "-s", "--format=%s", sha])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let author = git_capture(git, worktree, &["show", "-s", "--format=%an", sha])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let date = git_capture(
        git,
        worktree,
        &["show", "-s", "--format=%ad", "--date=short", sha],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
    FirstBad {
        sha: full,
        subject,
        author,
        date,
    }
}

/// Drop a finished job from tracking, tear its worktree down and emit the exit.
#[allow(clippy::too_many_arguments)]
fn finish_job(
    app: &AppHandle,
    id: u32,
    git: &Path,
    folder: &Path,
    worktree: &Path,
    bisect: bool,
    cleaned: &AtomicBool,
    code: Option<i32>,
) {
    perform_cleanup(
        &Cleanup {
            git: git.to_path_buf(),
            folder: folder.to_path_buf(),
            worktree: worktree.to_path_buf(),
            bisect,
        },
        cleaned,
    );
    if let Some(runs) = app.try_state::<LocalRuns>() {
        runs.drop_job(id);
    }
    emit(app, RunEventPayload::exit(id, code.or(Some(1))));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_sha_accepts_7_to_40_lowercase_hex() {
        assert!(valid_sha("abc1234"));
        assert!(valid_sha("0123456789abcdef0123456789abcdef01234567"));
        assert!(!valid_sha("abc123")); // 6 chars
        assert!(!valid_sha("ABC1234")); // uppercase
        assert!(!valid_sha("abc123g")); // non-hex
        assert!(!valid_sha("")); // empty
        assert!(!valid_sha("0123456789abcdef0123456789abcdef012345678")); // 41 chars
        assert!(!valid_sha("abc 123")); // space
    }

    #[test]
    fn path_within_only_accepts_descendants() {
        let base = PathBuf::from("/data/worktrees");
        assert!(path_within(
            &base,
            &PathBuf::from("/data/worktrees/proj/abc123")
        ));
        assert!(path_within(&base, &base));
        assert!(!path_within(&base, &PathBuf::from("/data/other")));
        assert!(!path_within(&base, &PathBuf::from("/data")));
    }

    #[test]
    fn detects_the_package_manager_from_the_lockfile() {
        let dir = std::env::temp_dir().join(format!("piwi-pm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(detect_package_manager(&dir), PackageManager::Npm);
        std::fs::write(dir.join("yarn.lock"), "").unwrap();
        assert_eq!(detect_package_manager(&dir), PackageManager::Yarn);
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        // pnpm wins when both are present (checked first).
        assert_eq!(detect_package_manager(&dir), PackageManager::Pnpm);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_commands_are_frozen() {
        assert_eq!(PackageManager::Npm.install_command(), ("npm", &["ci"][..]));
        assert_eq!(
            PackageManager::Pnpm.install_command(),
            ("pnpm", &["install", "--frozen-lockfile"][..])
        );
        assert_eq!(
            PackageManager::Yarn.install_command(),
            ("yarn", &["install", "--frozen-lockfile"][..])
        );
    }

    #[test]
    fn files_equal_compares_bytes_and_requires_both() {
        let dir = std::env::temp_dir().join(format!("piwi-lock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a");
        let b = dir.join("b");
        std::fs::write(&a, "same").unwrap();
        std::fs::write(&b, "same").unwrap();
        assert!(files_equal(&a, &b));
        std::fs::write(&b, "different").unwrap();
        assert!(!files_equal(&a, &b));
        assert!(!files_equal(&a, &dir.join("missing")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_a_bisect_step() {
        let output = "Bisecting: 3 revisions left to test after this (roughly 2 steps)\n[a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0] fix the guard\n";
        let progress = parse_bisect_progress(output).expect("progress");
        assert_eq!(progress.revisions_left, 3);
        assert_eq!(progress.steps_remaining, 2);
        assert_eq!(
            progress.sha.as_deref(),
            Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")
        );
    }

    #[test]
    fn parses_a_bisect_step_without_a_step_estimate() {
        let output = "Bisecting: 0 revisions left to test after this\n[abcdef1234567] last one\n";
        let progress = parse_bisect_progress(output).expect("progress");
        assert_eq!(progress.revisions_left, 0);
        assert_eq!(progress.steps_remaining, 0);
        assert_eq!(progress.sha.as_deref(), Some("abcdef1234567"));
    }

    #[test]
    fn a_line_that_is_not_a_bisect_step_yields_nothing() {
        assert_eq!(parse_bisect_progress("nothing to see here"), None);
    }

    #[test]
    fn parses_the_first_bad_commit() {
        let output =
            "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 is the first bad commit\ncommit a1b2c3d4\nAuthor: Dev\n";
        assert_eq!(
            parse_first_bad(output).as_deref(),
            Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")
        );
        assert_eq!(parse_first_bad("still bisecting"), None);
    }

    #[test]
    fn resolves_a_tool_in_the_first_dir_that_holds_it() {
        let dir = std::env::temp_dir().join(format!("piwi-tool-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = dir.join("a");
        let b = dir.join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(b.join("git"), "").unwrap();
        let candidates = vec!["git".to_string()];
        assert_eq!(
            resolve_tool_in(&[a.clone(), b.clone()], &candidates),
            Some(b.join("git"))
        );
        assert_eq!(resolve_tool_in(&[a], &candidates), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
