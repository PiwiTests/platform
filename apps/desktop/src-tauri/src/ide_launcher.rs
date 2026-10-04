//! Finding an IDE's command-line launcher (`code`, `rider`, …) for Open in IDE.
//!
//! Spawning the bare name misses it in the common cases. On Windows a process
//! only finds `<name>.exe` on the PATH, while VS Code and JetBrains Toolbox put
//! `code.cmd` / `rider.cmd` there and a JetBrains install has `rider64.exe`. On
//! macOS an app started from the Dock or the Finder does not inherit the shell's
//! PATH, so `/usr/local/bin` and the Toolbox scripts folder are not on it. So the
//! launcher is looked up on the PATH, then in the folders the IDEs install it to,
//! under the file names each platform uses, and spawned by its absolute path.

use std::path::{Path, PathBuf};

use crate::worktree::resolve_tool_in;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Os {
    Windows,
    Mac,
    Linux,
}

impl Os {
    pub(crate) fn current() -> Self {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Mac
        } else {
            Os::Linux
        }
    }
}

/// The directories the lookup starts from, read from the environment once per call.
pub(crate) struct SearchRoots {
    /// The PATH's directories, searched first.
    pub path: Vec<PathBuf>,
    pub home: Option<PathBuf>,
    /// `%LOCALAPPDATA%` (Windows).
    pub local_app_data: Option<PathBuf>,
    /// `%ProgramFiles%` and `%ProgramFiles(x86)%` (Windows).
    pub program_files: Vec<PathBuf>,
}

impl SearchRoots {
    pub(crate) fn from_env(home: Option<PathBuf>) -> Self {
        let var = |name: &str| {
            std::env::var_os(name)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
        };
        SearchRoots {
            path: std::env::var_os("PATH")
                .map(|p| std::env::split_paths(&p).collect())
                .unwrap_or_default(),
            home,
            local_app_data: var("LOCALAPPDATA"),
            program_files: ["ProgramFiles", "ProgramFiles(x86)"]
                .iter()
                .filter_map(|name| var(name))
                .collect(),
        }
    }
}

/// The file names a launcher has on `os`, in order of preference.
///
///  - Windows: `<name>.cmd` (what VS Code and Toolbox put on the PATH), then a
///    JetBrains install's `<name>64.exe`, then `<name>.exe`, then a JetBrains
///    install's `<name>.bat`.
///  - macOS: the bare name.
///  - Linux: the bare name, then a JetBrains archive's `<name>.sh`.
pub(crate) fn launcher_file_names(family: &str, command: &str, os: Os) -> Vec<String> {
    let jetbrains = family == "jetbrains";
    let mut names = Vec::new();
    match os {
        Os::Windows => {
            names.push(format!("{command}.cmd"));
            if jetbrains {
                names.push(format!("{command}64.exe"));
            }
            names.push(format!("{command}.exe"));
            if jetbrains {
                names.push(format!("{command}.bat"));
            }
        }
        Os::Mac => names.push(command.to_string()),
        Os::Linux => {
            names.push(command.to_string());
            if jetbrains {
                names.push(format!("{command}.sh"));
            }
        }
    }
    names
}

/// The subfolders of `dir`, the last name first, so `JetBrains Rider 2025.2`
/// comes before `JetBrains Rider 2024.3`. Empty when `dir` does not exist.
fn subfolders_newest_first(dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    dirs.sort();
    dirs.reverse();
    dirs
}

/// The directories to look for a launcher of `family` in, in order: the PATH,
/// then the folders the IDEs install their launchers to on `os`.
pub(crate) fn launcher_search_dirs(roots: &SearchRoots, os: Os, family: &str) -> Vec<PathBuf> {
    let jetbrains = family == "jetbrains";
    let mut dirs = roots.path.clone();
    let home = roots.home.as_deref();
    match os {
        Os::Windows => {
            if let Some(local) = &roots.local_app_data {
                dirs.push(local.join("JetBrains").join("Toolbox").join("scripts"));
                // Per-user installs: VS Code's `Microsoft VS Code\bin`, Toolbox 2's
                // `Rider\bin`, Cursor's `cursor\resources\app\bin`.
                for app in subfolders_newest_first(&local.join("Programs")) {
                    dirs.push(app.join("bin"));
                    if !jetbrains {
                        dirs.push(app.join("resources").join("app").join("bin"));
                    }
                }
            }
            for program_files in &roots.program_files {
                if jetbrains {
                    for app in subfolders_newest_first(&program_files.join("JetBrains")) {
                        dirs.push(app.join("bin"));
                    }
                } else {
                    for name in [
                        "Microsoft VS Code",
                        "Microsoft VS Code Insiders",
                        "VSCodium",
                    ] {
                        dirs.push(program_files.join(name).join("bin"));
                    }
                }
            }
        }
        Os::Mac => {
            if let Some(home) = home {
                dirs.push(home.join("Library/Application Support/JetBrains/Toolbox/scripts"));
            }
            dirs.push(PathBuf::from("/usr/local/bin"));
            dirs.push(PathBuf::from("/opt/homebrew/bin"));
            // The app bundles, where Toolbox and a download install them: a JetBrains
            // IDE's launcher is `Contents/MacOS/<tag>`, VS Code's
            // `Contents/Resources/app/bin/code`.
            let mut parents = vec![PathBuf::from("/Applications")];
            if let Some(home) = home {
                parents.push(home.join("Applications"));
            }
            for parent in parents {
                for bundle in subfolders_newest_first(&parent) {
                    if bundle.extension().is_some_and(|e| e == "app") {
                        dirs.push(if jetbrains {
                            bundle.join("Contents/MacOS")
                        } else {
                            bundle.join("Contents/Resources/app/bin")
                        });
                    }
                }
            }
        }
        Os::Linux => {
            if let Some(home) = home {
                dirs.push(home.join(".local/share/JetBrains/Toolbox/scripts"));
                dirs.push(home.join(".local/bin"));
            }
            for dir in ["/usr/local/bin", "/usr/bin", "/snap/bin"] {
                dirs.push(PathBuf::from(dir));
            }
            if jetbrains {
                for app in subfolders_newest_first(Path::new("/opt")) {
                    dirs.push(app.join("bin"));
                }
            }
        }
    }
    dirs
}

/// The absolute path of the launcher for `command`, or `None` when no IDE
/// installed one anywhere the shell looks.
pub(crate) fn resolve_launcher(
    roots: &SearchRoots,
    os: Os,
    family: &str,
    command: &str,
) -> Option<PathBuf> {
    resolve_tool_in(
        &launcher_search_dirs(roots, os, family),
        &launcher_file_names(family, command, os),
    )
}

#[cfg(test)]
mod tests {
    use super::{launcher_file_names, resolve_launcher, Os, SearchRoots};
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A fresh directory for one test, removed first if a previous run left it.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("piwi-ide-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path) -> PathBuf {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"").unwrap();
        path.to_path_buf()
    }

    fn roots(
        path: Vec<PathBuf>,
        home: Option<PathBuf>,
        local: Option<PathBuf>,
        program_files: Vec<PathBuf>,
    ) -> SearchRoots {
        SearchRoots {
            path,
            home,
            local_app_data: local,
            program_files,
        }
    }

    #[test]
    fn launcher_file_names_follow_each_platform() {
        assert_eq!(
            launcher_file_names("jetbrains", "rider", Os::Windows),
            vec!["rider.cmd", "rider64.exe", "rider.exe", "rider.bat"]
        );
        assert_eq!(
            launcher_file_names("vscode", "code", Os::Windows),
            vec!["code.cmd", "code.exe"]
        );
        assert_eq!(
            launcher_file_names("jetbrains", "rider", Os::Mac),
            vec!["rider"]
        );
        assert_eq!(
            launcher_file_names("jetbrains", "rider", Os::Linux),
            vec!["rider", "rider.sh"]
        );
        assert_eq!(
            launcher_file_names("vscode", "code", Os::Linux),
            vec!["code"]
        );
    }

    #[test]
    fn windows_finds_the_cmd_shims_before_an_extensionless_script() {
        let dir = scratch("win-path");
        // VS Code's `bin` holds a shell script for WSL next to the `.cmd` a Windows process can run.
        touch(&dir.join("vscode/bin/code"));
        let cmd = touch(&dir.join("vscode/bin/code.cmd"));
        let r = roots(vec![dir.join("vscode/bin")], None, None, vec![]);
        assert_eq!(
            resolve_launcher(&r, Os::Windows, "vscode", "code"),
            Some(cmd)
        );
    }

    #[test]
    fn windows_finds_toolbox_scripts_then_the_newest_install() {
        let dir = scratch("win-jb");
        let local = dir.join("local");
        let pf = dir.join("pf");
        touch(&pf.join("JetBrains/JetBrains Rider 2024.3/bin/rider64.exe"));
        let newest = touch(&pf.join("JetBrains/JetBrains Rider 2025.2/bin/rider64.exe"));
        let r = roots(vec![], None, Some(local.clone()), vec![pf.clone()]);
        assert_eq!(
            resolve_launcher(&r, Os::Windows, "jetbrains", "rider"),
            Some(newest)
        );

        // Toolbox 2 installs per user, under `%LOCALAPPDATA%\Programs`.
        let toolbox_app = touch(&local.join("Programs/Rider/bin/rider64.exe"));
        assert_eq!(
            resolve_launcher(&r, Os::Windows, "jetbrains", "rider"),
            Some(toolbox_app)
        );
        // Its generated script comes first.
        let script = touch(&local.join("JetBrains/Toolbox/scripts/rider.cmd"));
        assert_eq!(
            resolve_launcher(&r, Os::Windows, "jetbrains", "rider"),
            Some(script)
        );
    }

    #[test]
    fn windows_finds_a_per_user_vscode_and_cursor() {
        let dir = scratch("win-vscode");
        let local = dir.join("local");
        let code = touch(&local.join("Programs/Microsoft VS Code/bin/code.cmd"));
        let cursor = touch(&local.join("Programs/cursor/resources/app/bin/cursor.cmd"));
        let r = roots(vec![], None, Some(local), vec![]);
        assert_eq!(
            resolve_launcher(&r, Os::Windows, "vscode", "code"),
            Some(code)
        );
        assert_eq!(
            resolve_launcher(&r, Os::Windows, "vscode", "cursor"),
            Some(cursor)
        );
    }

    #[test]
    fn macos_finds_the_toolbox_scripts_and_the_app_bundles_off_the_path() {
        let dir = scratch("mac");
        let home = dir.join("home");
        // Names no real app uses, since `/Applications` is searched too.
        let bundle = touch(&home.join("Applications/Piwi Test IDE.app/Contents/MacOS/piwitestide"));
        let editor = touch(
            &home.join("Applications/Piwi Test Code.app/Contents/Resources/app/bin/piwitestcode"),
        );
        let r = roots(vec![], Some(home.clone()), None, vec![]);
        assert_eq!(
            resolve_launcher(&r, Os::Mac, "jetbrains", "piwitestide"),
            Some(bundle)
        );
        assert_eq!(
            resolve_launcher(&r, Os::Mac, "vscode", "piwitestcode"),
            Some(editor)
        );
        let script =
            touch(&home.join("Library/Application Support/JetBrains/Toolbox/scripts/piwitestide"));
        assert_eq!(
            resolve_launcher(&r, Os::Mac, "jetbrains", "piwitestide"),
            Some(script)
        );
    }

    #[test]
    fn linux_finds_the_toolbox_scripts_and_an_archive_launcher() {
        let dir = scratch("linux");
        let home = dir.join("home");
        let sh = touch(&dir.join("bin/piwitestide.sh"));
        let r = roots(vec![dir.join("bin")], Some(home.clone()), None, vec![]);
        assert_eq!(
            resolve_launcher(&r, Os::Linux, "jetbrains", "piwitestide"),
            Some(sh)
        );
        let script = touch(&home.join(".local/share/JetBrains/Toolbox/scripts/piwitestide"));
        let r = roots(vec![], Some(home), None, vec![]);
        assert_eq!(
            resolve_launcher(&r, Os::Linux, "jetbrains", "piwitestide"),
            Some(script)
        );
    }

    #[test]
    fn a_launcher_installed_nowhere_is_not_found() {
        let dir = scratch("none");
        let r = roots(
            vec![dir.clone()],
            Some(dir.clone()),
            Some(dir.clone()),
            vec![dir],
        );
        for os in [Os::Windows, Os::Mac, Os::Linux] {
            assert_eq!(
                resolve_launcher(&r, os, "jetbrains", "piwi-no-such-ide"),
                None
            );
        }
    }
}
