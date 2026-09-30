# JetBrains plugin — agent guide

Rules for working inside `apps/jetbrains/` (the Piwi plugin for WebStorm, IntelliJ IDEA Ultimate, Rider and the other
JetBrains IDEs with the LSP API, published as `dev.piwitests.piwi`). Read [`../../AGENTS.md`](../../AGENTS.md) and
[`../../packages/editor/AGENTS.md`](../../packages/editor/AGENTS.md) first.

## What it is

A Gradle project in Kotlin with the IntelliJ Platform Gradle Plugin; like `apps/desktop`, not an npm workspace. The
build copies the editor service's bundle (`packages/editor/dist/piwi-language-server.cjs`, from
`npm run editor:build`) into the plugin's `server/` directory, and the plugin starts it through the platform's LSP API
with the project's Node.js interpreter.

- `PiwiLspServerSupportProvider.kt` registers the service; the LSP client renders its diagnostics, quick fixes and
  hover in open files, and `LspCommandsSupport` runs the client commands it names (`PiwiCommands.kt`). The plugin's
  own requests go through the service's lsp4j proxy, which the platform hands only to a request's sender:
  `Lsp4jAccess` takes it from a `sendRequestSync` that sends nothing, never from `getLsp4jServer()` (deprecated, then
  removed by 2026.2). Every status, Code Vision, gutter and tool-window answer depends on it. Its
  `createLspServerWidgetItem` gives the Language Services widget Piwi's icon and the gear that opens the settings.
- `PiwiTestAnnotator.kt` (an external annotator on JavaScript, so on its TypeScript dialects too) draws each test's
  latest result from `piwi/fileSummary`: a gutter icon, the details as its tooltip, and the `PIWI_FAILING_TEST`
  background over a failing test (`PiwiColorSettingsPage.kt`, defaults in `resources/colorSchemes/`). Code Vision skips
  those lines, and the daemon restarts when the run changes.
- The rest is native: Code Vision from `piwi/fileSummary`, the status bar from `piwi/runStatus`, the **Piwi** tool
  window from `piwi/failures` (the LSP client highlights open files only) with the connection from `piwi/status`, and
  the actions under **Tools → Piwi**. The service starts with the first supported file opened (2024.1 has no way to
  start it without one): until then the status is null, and the status bar and tool window say so.
- Once the project is open, `PiwiProjectService.findPlaywright` looks for Playwright configs on a pooled thread
  (`Glue.findPlaywright`, with the editor service's depth and skipped folders): in the project folder (in Rider, the
  solution's folder, above `.idea/.idea.<name>`), the folder the IDE guesses and the base directories, then, when those
  hold none, in the Git repository around them. The tool window, the status bar item and the service wait for it, and
  the service's workspace folders are the folders it searched (`createInitializeParams`). **Refresh** searches again.
- `PiwiSendHandler.kt` is the Send to editor endpoint: `POST /api/piwi/send` on the IDE's built-in server, with the
  token from `PasswordSafe`; **Pair with Piwi Picker** copies the pairing address. It mirrors
  `@piwitests/core/editor-send` (`Glue.parseSendPayload`, `Glue.sendAuthorized`).
- `PiwiOpenHandler.kt` is the dashboard's Open in IDE: `GET /api/piwi/open?file=…&line=…&column=…[&root=…][&check]`
  on the built-in server, a `RestService`, so the platform's origin rules apply (a loopback page is trusted, the IDE
  asks before trusting another origin). It looks the run's path up under the Playwright config folders, the project
  folder and the content roots (`Glue.candidatePaths`), opens only a file inside an open project, and answers JSON
  with CORS so the dashboard knows it opened. The dashboard side is `useOpenInIde` / `ide-links.ts` in
  `apps/application`; a change to the query or the answer changes both.
- `Protocol.kt` mirrors `packages/editor/src/protocol.ts` for lsp4j; `Glue.kt` is the pure half, tested without an IDE.
- **Connect** (`PiwiConnect.kt`) asks the instance whether it needs a key, then signs in with the browser (the device
  authorization Piwi Picker uses, `/api/extension/connect`) or takes a pasted key, then the project. When the desktop
  app runs, it first lists the app beside the instance the project names (`Glue.connectChoices`). An instance on this
  machine is tried on every loopback address (`Glue.loopbackAlternatives`: a server started on `localhost` may listen
  on `::1` only), never through the IDE's proxy, and the address that answered is saved. It runs from
  **Settings → Tools → Piwi** (`PiwiConfigurable.kt`), the tool window's toolbar and **Tools → Piwi**.
- `PiwiProjectService.desktop()` asks the service (`piwi/desktop`) and, while the service has not started, reads the
  app's discovery file itself (`Glue.parseDesktopDiscovery`, `Glue.linkedDesktopProject`): Connect finds the app
  before any file is opened.
- The instance URL and project live in `.idea/piwi.xml`; the API key in the IDE's `PasswordSafe`, **per instance**
  (`Glue.apiKeyEntry`): a project's settings, which a repository may commit, never select another instance's key. The
  choice of the desktop app and its project live in `.idea/workspace.xml` (`PiwiLocalSettings`), on this machine
  only; choosing the app never touches the instance, its project or its key.

## Rules

- **The oldest supported platform is 2024.1** (`pluginSinceBuild=241`): the first whose LSP API sends requests
  through the server (`sendRequestSync`) and lists servers in the Language Services widget. Compile against it;
  `verifyPlugin` checks the latest WebStorm, IntelliJ IDEA Ultimate and Rider too. An API newer than 2024.1 is looked
  up at run time or not used. Its test framework is pinned (`platformTestFrameworkVersion`: it is published with
  IntelliJ IDEA's build numbers, just after WebStorm's), and the test sandbox disables the Swagger plugin, whose test
  service ships with its own tests only.
- **No logic the VS Code extension would need too.** A new feature is a service request first.
- **Nothing blocks the event thread, and nothing in a read action waits on the service without giving way**: the daemon
  (Code Vision) waits with `awaitCancellably`, which a write action cancels, and reads of the disk run on a pooled
  thread.
- A change to `protocol.ts` updates `Protocol.kt` in the same change.

## Workflow

```bash
npm run editor:build -w packages/editor   # from the repository root: the bundle the plugin ships
./gradlew test                     # unit tests of Glue.kt, and platform tests on WebStorm 2024.1
./gradlew buildPlugin              # build/distributions/piwi-jetbrains-<version>.zip
./gradlew verifyPlugin             # the Plugin Verifier on `verifyIdes` (gradle.properties; -PverifyIdes=WS:2024.1 for one)
./gradlew runIde                   # a sandboxed WebStorm with the plugin
```

**The JDK.** Gradle runs on the JDK 21 that `gradle/gradle-daemon-jvm.properties` names, whatever `JAVA_HOME` points to
(the wrapper starts on JDK 11 or later), and the build compiles with a JDK 21 toolchain (`jvmToolchain(21)`). When the
machine has no JDK 21, the foojay resolver in `settings.gradle.kts` downloads one into `~/.gradle/jdks`. Moving to
another JDK changes both: `./gradlew updateDaemonJvm --jvm-version=<n>` regenerates the file, and `jvmToolchain` follows
in `build.gradle.kts`. CI (`jetbrains.yml`) installs JDK 21, so it downloads nothing.

The platform test `testTheBundledServiceAnswersThroughTheDescriptor` starts the bundled service with the descriptor's
command line against a stub instance, and reads its answers with the Kotlin protocol classes.
