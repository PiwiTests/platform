// The replay lab, end to end: builds the extension, records and replays every
// scenario (lab.config.ts), runs the specs written from them (specs.config.ts),
// and prints the comparison. Arguments go to the first run, such as
// `--grep palette`. See README.md.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../../scripts/build.mjs';

const lab = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(lab, '..', '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => spawnSync(npx, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status;

if (!process.env.LAB_SKIP_BUILD) await buildExtension();
for (const dir of ['results', 'specs', 'shots']) rmSync(path.join(lab, 'out', dir), { recursive: true, force: true });

const recorded = run(['playwright', 'test', '-c', 'tests/lab/lab.config.ts', ...process.argv.slice(2)]);
const played = process.env.LAB_DRY ? 0 : run(['playwright', 'test', '-c', 'tests/lab/specs.config.ts']);
if (!process.env.LAB_DRY) spawnSync(process.execPath, [path.join(lab, 'summary.mjs')], { stdio: 'inherit' });
process.exit(recorded || played ? 1 : 0);
