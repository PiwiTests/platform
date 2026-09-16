# @piwitests/server

Run the self-hosted [Piwi Dashboard](https://piwitests.dev) server — a permanent
home for your Playwright test results — with a single command, no Docker required.

> **Docker is the recommended way to run Piwi in production** (pinned runtime, isolated
> environment): see the [deployment guide](https://piwitests.dev/operate/deployment). This
> npm package is a low-friction path for a quick local run or environments where Docker
> isn't available.

## Requirements

- Node.js **22+**

## Quick start

```bash
npx @piwitests/server
```

Then open `http://localhost:3000`.

The server creates a `.data/` directory **in your current working directory** to hold the
SQLite database (`.data/piwi.db`) and file storage (`.data/storage/` — HTML reports,
traces, attachments). Run the command from the same directory each time to keep your data,
or install it as a dependency and add a script:

```bash
npm install @piwitests/server
```

```json
{
  "scripts": {
    "piwi": "piwi-server"
  }
}
```

## Configuration

All configuration is via environment variables (same as the Docker image). `PORT`
(default `3000`) sets the listen port; everything else is a `PIWI_*` variable
documented — with its default and whether the Settings UI can override it — in the
[configuration reference](https://piwitests.dev/reference/configuration). Most deployments set at
least `PIWI_SECRET_KEY`, the master key for encrypting secrets stored in the database
(AI API keys, SCM tokens); recommended in any real deployment. Generate one with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Enable multi-user access with `PIWI_AUTH_ENABLED=true` plus `PIWI_AUTH_SECRET`, and
point at PostgreSQL with `PIWI_DATABASE_URL`.

Set variables the usual way for your shell — for example, on a different port:

```bash
# Linux / macOS
PORT=8080 npx @piwitests/server
```

```powershell
# Windows (PowerShell)
$env:PORT='8080'; npx @piwitests/server
```

## Sending results

Add the [`@piwitests/reporter`](https://www.npmjs.com/package/@piwitests/reporter) to your
Playwright project and point it at this server — see the
[getting started guide](https://piwitests.dev/guide/getting-started).

## License

MIT
