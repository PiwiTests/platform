// Packs a release build of dist/ into two archives, run via `npm run extension:zip`
// (which does the release build first):
//
// - piwi-picker-v<version>.zip: the add-on itself, the same zip Chrome Web
//   Store, Edge Add-ons, and Firefox AMO all accept unmodified (see
//   PUBLISHING.md). Sourcemaps are excluded: useful locally, not meant to ship.
// - piwi-picker-v<version>-source.zip: the sources that build came from, for
//   AMO, which requires them for bundled or minified code. Its reviewers
//   rebuild it and diff the result against the add-on, so it holds exactly the
//   files the build reads, with SOURCE-BUILD.md as its README.
// - piwi-picker-v<version>-amo-metadata.json: the AMO listing fields the add-on
//   cannot carry itself, for `web-ext sign --amo-metadata` (see amo-metadata.mjs).
import { createWriteStream, readFileSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import archiver from 'archiver';
import { buildAmoMetadata } from './amo-metadata.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(root, '..', '..');
const distDir = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

/**
 * What the build reads, relative to the repository root: this workspace, the
 * two workspaces it bundles from source, and the npm root that installs them.
 */
const SOURCE_PATHS = [
  'package.json',
  'package-lock.json',
  '.npmrc',
  'tsconfig.json',
  'LICENSE',
  'apps/extension',
  'packages/core',
  'packages/picker-dom',
];

async function writeZip(fileName, fill) {
  const outPath = path.join(root, fileName);
  if (existsSync(outPath)) unlinkSync(outPath);

  const output = createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  fill(archive);
  await archive.finalize();
  await done;
  console.log(`Zipped ${path.relative(process.cwd(), outPath)}`);
}

/**
 * Tracked files plus untracked ones git doesn't ignore, read from the working
 * tree: that is what the build in dist/ just read, so a file not committed yet
 * still reaches the reviewers, while node_modules, dist/ and earlier zips stay
 * out.
 */
function listSourceFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...SOURCE_PATHS],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  // A tracked file deleted from the working tree is still listed.
  return output.split('\0').filter((file) => file && existsSync(path.join(repoRoot, file)));
}

// `false` as the second arg: zip the contents of dist/ directly at the
// archive root (manifest.json at the top level), not nested in a dist/ folder
// — stores expect the manifest at the zip root.
await writeZip(`piwi-picker-v${version}.zip`, (archive) =>
  archive.directory(distDir, false, (entry) => (entry.name.endsWith('.map') ? false : entry)),
);

await writeZip(`piwi-picker-v${version}-source.zip`, (archive) => {
  for (const file of listSourceFiles()) archive.file(path.join(repoRoot, file), { name: file });
  archive.file(path.join(root, 'SOURCE-BUILD.md'), { name: 'README.md' });
});

const metadataPath = path.join(root, `piwi-picker-v${version}-amo-metadata.json`);
writeFileSync(metadataPath, `${JSON.stringify(buildAmoMetadata(), null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), metadataPath)}`);
