//! Graceful stop for a local process: the equivalent of pressing Ctrl+C in the
//! terminal it was started from.
//!
//! Playwright's runner handles Ctrl+C by stopping its workers and reporting the
//! run as `interrupted` — so the Piwi reporter still sends the run's end — and
//! then exits. A process still running `STOP_GRACE` after the request is killed.
//!
//! On Unix the process gets SIGINT. Windows has no signals: a Ctrl+C reaches a
//! process only through its console (the shell plugin spawns every child with a
//! hidden one), and whoever raises it must attach to that console and so
//! receives it too. The event is therefore raised by a short-lived copy of this
//! binary (`piwi-desktop interrupt <pid>`, see `run_helper`), never by the app.

use std::time::Duration;

/// How long a stopped process gets to wind down before it is killed.
pub(crate) const STOP_GRACE: Duration = Duration::from_secs(10);

/// The internal argument that runs this binary as the Windows Ctrl+C helper.
#[cfg(windows)]
pub(crate) const HELPER_ARG: &str = "interrupt";

/// Ask process `pid` to stop as a Ctrl+C would. `false` when the request could
/// not be delivered, and the caller kills the process instead.
pub(crate) fn interrupt(pid: u32) -> bool {
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .args(["-INT", &pid.to_string()])
            .status()
            .is_ok_and(|s| s.success())
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let Ok(exe) = std::env::current_exe() else {
            return false;
        };
        std::process::Command::new(exe)
            .args([HELPER_ARG, &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|s| s.success())
    }
}

/// `piwi-desktop interrupt <pid>` (Windows): raise Ctrl+C on the console of
/// process `pid`, which reaches every process sharing that console — the
/// Playwright runner, its workers and its webServer, as in a terminal. Exits 0
/// once the event is raised, 1 when it could not be.
#[cfg(windows)]
pub fn run_helper(pid: Option<&str>) -> ! {
    use windows::Win32::System::Console::{
        AttachConsole, FreeConsole, GenerateConsoleCtrlEvent, SetConsoleCtrlHandler, CTRL_C_EVENT,
    };
    let Some(pid) = pid.and_then(|p| p.parse::<u32>().ok()) else {
        std::process::exit(1);
    };
    let raised = unsafe {
        // A process holds one console at most: leave this helper's own first.
        let _ = FreeConsole();
        AttachConsole(pid).is_ok()
            // The helper now shares the console, so it must ignore the event it raises.
            && SetConsoleCtrlHandler(None, true).is_ok()
            && GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0).is_ok()
    };
    std::process::exit(if raised { 0 } else { 1 })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Command;
    use std::time::Instant;

    #[test]
    fn a_process_that_handles_ctrl_c_winds_down_on_its_own() {
        // Stands in for the Playwright runner: finishes cleanly on SIGINT.
        let mut child = Command::new("sh")
            .args(["-c", "trap 'exit 42' INT; while :; do sleep 0.05; done"])
            .spawn()
            .expect("spawn sh");
        // Let the shell install its trap before the signal arrives.
        std::thread::sleep(Duration::from_millis(200));

        assert!(interrupt(child.id()));

        let deadline = Instant::now() + Duration::from_secs(5);
        let status = loop {
            if let Some(status) = child.try_wait().expect("wait") {
                break status;
            }
            assert!(
                Instant::now() < deadline,
                "the process ignored the interrupt"
            );
            std::thread::sleep(Duration::from_millis(20));
        };
        assert_eq!(status.code(), Some(42));
    }

    #[test]
    fn interrupting_a_process_that_is_gone_reports_failure() {
        let mut child = Command::new("true").spawn().expect("spawn true");
        let pid = child.id();
        child.wait().expect("wait");
        assert!(!interrupt(pid));
    }
}
