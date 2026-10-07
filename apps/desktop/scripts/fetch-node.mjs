#!/usr/bin/env node
// Download the official Node.js runtime for a Tauri target triple and place it
// as the sidecar binary at desktop/src-tauri/binaries/node-<triple>[.exe].
// Tauri resolves `externalBin: ["binaries/node"]` to node-<current-triple>.
//
// Usage: node scripts/fetch-node.mjs --target <triple> [--node <version>]
//   e.g. --target x86_64-pc-windows-msvc
//        --target aarch64-apple-darwin
import { mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const binaries = resolve(here, '../src-tauri/binaries');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function defaultHostTriple() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32') return 'x86_64-pc-windows-msvc';
  if (p === 'darwin') return a === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  return 'x86_64-unknown-linux-gnu';
}

const NODE_VERSION = arg('node', process.env.PIWI_NODE_VERSION || '24.21.0').replace(/^v/, '');
const target = arg('target', defaultHostTriple());
const base = `https://nodejs.org/dist/v${NODE_VERSION}`;

mkdirSync(binaries, { recursive: true });

async function download(url, to) {
  console.log(`[fetch-node] GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

function extractNodeBinary(archive, innerDir, outFile) {
  const work = join(tmpdir(), `node-extract-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  execSync(`tar -xf "${archive}" -C "${work}"`, { stdio: 'inherit' });
  copyFileSync(join(work, innerDir, 'bin', 'node'), outFile);
  chmodSync(outFile, 0o755);
  rmSync(work, { recursive: true, force: true });
}

async function fromTarball(distName, ext) {
  const archive = join(tmpdir(), `${distName}.${ext}`);
  await download(`${base}/${distName}.${ext}`, archive);
  const out = join(binaries, `node-${target}`);
  extractNodeBinary(archive, distName, out);
  rmSync(archive, { force: true });
  console.log(`[fetch-node] Wrote ${out}`);
}

const run = async () => {
  if (target.includes('windows')) {
    // Windows ships node.exe directly — no archive to unpack.
    const out = join(binaries, `node-${target}.exe`);
    await download(`${base}/win-x64/node.exe`, out);
    console.log(`[fetch-node] Wrote ${out}`);
  } else if (target === 'aarch64-apple-darwin') {
    await fromTarball(`node-v${NODE_VERSION}-darwin-arm64`, 'tar.gz');
  } else if (target === 'x86_64-apple-darwin') {
    await fromTarball(`node-v${NODE_VERSION}-darwin-x64`, 'tar.gz');
  } else if (target.includes('linux')) {
    await fromTarball(`node-v${NODE_VERSION}-linux-x64`, 'tar.xz');
  } else {
    throw new Error(`unsupported target: ${target}`);
  }
};

run().catch((e) => {
  console.error('[fetch-node]', e.message);
  process.exit(1);
});
