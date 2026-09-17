#!/usr/bin/env node
// Assemble the bundled server for the Tauri app, mirroring the Dockerfile's
// production stage:
//   1. copy apps/application/.output into apps/desktop/resources/app-server/.output
//   2. strip the build-host native binaries that got bundled into .output
//   3. install the correct-platform sharp + @libsql/client for THIS OS
//
// Run this ON THE TARGET OS (the Windows runner for the .msi, the macOS runner
// for the .dmg) so npm's platform-matched optionalDependencies fetch the right
// native binaries — exactly what `npx @piwitests/server` relies on.
import {
  existsSync,
  rmSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..');
const output = resolve(repoRoot, 'application/.output');
// Must live under src-tauri/ — tauri.conf.json resolves bundle.resources
// relative to the src-tauri directory.
const dest = resolve(desktopDir, 'src-tauri/resources/app-server');

if (!existsSync(output)) {
  console.error(`[stage] application/.output not found at ${output}`);
  console.error('[stage] Build it first: npm run app:build --workspace=apps/application');
  process.exit(1);
}

console.log('[stage] Resetting resources/app-server');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

console.log('[stage] Copying .output');
cpSync(output, join(dest, '.output'), { recursive: true });

// Strip the platform-specific native binaries the (Linux) build bundled — the
// wrappers stay and resolve their natives from the outer node_modules installed
// below for the current OS. Keep @libsql/client (the JS entry) but drop its
// platform packages.
const bundledModules = join(dest, '.output/server/node_modules');
for (const rel of ['@img', 'sql.js']) {
  rmSync(join(bundledModules, rel), { recursive: true, force: true });
}
const libsqlDir = join(bundledModules, '@libsql');
if (existsSync(libsqlDir)) {
  for (const entry of readdirSync(libsqlDir)) {
    if (entry !== 'client') {
      rmSync(join(libsqlDir, entry), { recursive: true, force: true });
    }
  }
}

// Pin sharp + @libsql/client to the versions the app was built against.
const appPkg = JSON.parse(readFileSync(resolve(repoRoot, 'application/package.json'), 'utf8'));
const sharpVer = appPkg.dependencies.sharp;
const libsqlVer = appPkg.dependencies['@libsql/client'];

writeFileSync(
  join(dest, 'package.json'),
  JSON.stringify(
    {
      name: 'piwi-app-server',
      private: true,
      dependencies: { sharp: sharpVer, '@libsql/client': libsqlVer },
    },
    null,
    2,
  ),
);

console.log(
  `[stage] Installing native modules for ${process.platform}/${process.arch}: sharp@${sharpVer}, @libsql/client@${libsqlVer}`,
);
execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund', {
  cwd: dest,
  stdio: 'inherit',
});

// Drop musl-libc native variants (npm installs both glibc and musl builds of
// @libsql on Linux). The bundled Node is the official glibc build, so musl
// addons never load — and worse, the Linux AppImage bundler runs `ldd` on every
// ELF it finds and aborts on a musl binary. Prune them everywhere they nest.
const installedModules = join(dest, 'node_modules');
let muslDropped = 0;
const pruneMusl = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name.includes('musl')) {
      rmSync(join(dir, name), { recursive: true, force: true });
      muslDropped++;
    } else if (name.startsWith('@')) {
      pruneMusl(join(dir, name));
    }
  }
};
if (existsSync(installedModules)) pruneMusl(installedModules);
console.log(`[stage] Dropped ${muslDropped} musl native variant(s)`);

// Trim assets not needed at runtime — smaller install, and no source maps that
// would map the minified server/client bundles back to readable source:
//   - the in-browser demo SPA (public/demo, unused by the desktop app)
//   - every source map (*.map)
//   - drizzle-kit migration snapshots (runtime only needs _journal.json + *.sql)
const outDir = join(dest, '.output');
let trimmed = 0;
rmSync(join(outDir, 'public/demo'), { recursive: true, force: true });
for (const rel of readdirSync(outDir, { recursive: true })) {
  if (typeof rel === 'string' && rel.endsWith('.map')) {
    rmSync(join(outDir, rel), { force: true });
    trimmed++;
  }
}
const metaDir = join(outDir, 'server/database/migrations/meta');
if (existsSync(metaDir)) {
  for (const f of readdirSync(metaDir)) {
    if (f.endsWith('_snapshot.json')) {
      rmSync(join(metaDir, f), { force: true });
      trimmed++;
    }
  }
}
console.log(`[stage] Trimmed demo SPA + ${trimmed} source-map/snapshot files`);

console.log(`[stage] Done — staged server at ${dest}`);
