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
  hover in open files, and `LspCommandsSupport` runs the client commands it names (`PiwiCommands.kt`).
- The rest is native: Code Vision from `piwi/fileSummary`, the status bar from `piwi/runStatus`, the **Piwi** tool
  window from `piwi/failures` (the LSP client highlights open files only), and the actions under **Tools → Piwi**.
- `PiwiSendHandler.kt` is the Send to editor endpoint: `POST /api/piwi/send` on the IDE's built-in server, with the
  token from `PasswordSafe`; **Pair with Piwi Picker** copies the pairing address. It mirrors
  `@piwitests/core/editor-send` (`Glue.parseSendPayload`, `Glue.sendAuthorized`).
- `Protocol.kt` mirrors `packages/editor/src/protocol.ts` for lsp4j; `Glue.kt` is the pure half, tested without an IDE.
- The API key lives in the IDE's `PasswordSafe`; the instance URL and project in `.idea/piwi.xml`.

## Rules

- **The oldest supported platform is 2023.3** (`pluginSinceBuild=233`): its LSP client is the first to render
  diagnostics, quick fixes and hover. Compile against it; `verifyPlugin` checks the latest WebStorm, IntelliJ IDEA
  Ultimate and Rider too. An API newer than 2023.3 is looked up at run time or not used.
- **No logic the VS Code extension would need too.** A new feature is a service request first.
- A change to `protocol.ts` updates `Protocol.kt` in the same change.

## Workflow

```bash
npm run editor:build -w packages/editor   # from the repository root: the bundle the plugin ships
./gradlew test                     # unit tests of Glue.kt, and platform tests on WebStorm 2023.3
./gradlew buildPlugin              # build/distributions/piwi-jetbrains-<version>.zip
./gradlew verifyPlugin             # the Plugin Verifier on `verifyIdes` (gradle.properties; -PverifyIdes=WS:2023.3 for one)
./gradlew runIde                   # a sandboxed WebStorm with the plugin
```

**The JDK.** Gradle runs on the JDK 21 that `gradle/gradle-daemon-jvm.properties` names, whatever `JAVA_HOME` points to
(the wrapper starts on JDK 11 or later), and the build compiles with a JDK 21 toolchain (`jvmToolchain(21)`). When the
machine has no JDK 21, the foojay resolver in `settings.gradle.kts` downloads one into `~/.gradle/jdks`. Moving to
another JDK changes both: `./gradlew updateDaemonJvm --jvm-version=<n>` regenerates the file, and `jvmToolchain` follows
in `build.gradle.kts`. CI (`jetbrains.yml`) installs JDK 21, so it downloads nothing.

The platform test `testTheBundledServiceAnswersThroughTheDescriptor` starts the bundled service with the descriptor's
command line against a stub instance, and reads its answers with the Kotlin protocol classes.
