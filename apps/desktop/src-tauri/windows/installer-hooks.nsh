; NSIS installer hooks for the per-user .exe (`bundle > windows > nsis >
; installerHooks` in tauri.conf.json), inserted into Tauri's installer template.
;
; The app runs its server as a Node sidecar (`node.exe` beside the main binary)
; that keeps the bundled native modules loaded — sharp's libvips DLLs among them.
; Tauri's installer only stops the main binary, so a sidecar still running holds
; those files locked and the copy fails with "Error opening file for writing".
; That happens on every update started by a build up to 0.37 (their updater exits
; without stopping the sidecar, see src/updates.rs), and whenever the app was
; killed without its quit cleanup — from Task Manager, or by the installer's own
; "close the app" step.
;
; So before any file is written or removed: run that app check first (a stopped
; app cannot restart the sidecar behind us; the template's own check then finds
; nothing), then stop the node.exe running from this install folder. Matched on
; its full path, never on the name alone, which would also kill the user's own
; Node processes.

!macro PIWI_STOP_SIDECAR
  Push $0
  ; The 64-bit PowerShell where there is one: the installer is a 32-bit process,
  ; and a 32-bit PowerShell cannot read the path of the 64-bit sidecar.
  StrCpy $0 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $0 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  ; The folder travels in the environment rather than inside the command, so no
  ; install path (spaces, apostrophes, brackets) can break the quoting.
  System::Call 'kernel32::SetEnvironmentVariable(t "PIWI_INSTDIR", t "$INSTDIR")'
  nsExec::Exec `"$0" -NoProfile -NonInteractive -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -eq ($$env:PIWI_INSTDIR + '\node.exe') } | Stop-Process -Force -PassThru | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue"`
  Pop $0 ; nsExec's exit code — best-effort, a failure leaves the install as before
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro PIWI_STOP_SIDECAR
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro PIWI_STOP_SIDECAR
!macroend
