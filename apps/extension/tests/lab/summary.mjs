// Prints the lab's comparison, and writes it to out/summary.md: for each
// scenario, the recorded steps, how the extension replayed them, and how the
// spec written from them ran in Playwright.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const read = (file) => JSON.parse(readFileSync(path.join(out, file), 'utf8'));

const specs = new Map();
if (existsSync(path.join(out, 'specs-report.json'))) {
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const result = spec.tests[0]?.results.at(-1);
      const message = stripVTControlCharacters(result?.error?.message ?? '').split('\n')[0] ?? '';
      specs.set(path.basename(spec.file, '.spec.ts'), { status: result?.status ?? 'not run', message });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of read('specs-report.json').suites ?? []) walk(suite);
}

const rows = readdirSync(path.join(out, 'results'))
  .filter((file) => file.endsWith('.json') && !file.endsWith('.steps.json'))
  .map((file) => read(path.join('results', file)))
  .sort((a, b) => a.name.localeCompare(b.name));

const lines = ['| Scenario | Steps | Extension replay | Playwright |', '| --- | --- | --- | --- |'];
for (const row of rows) {
  const r = row.replay;
  const extension = row.knownGap
    ? `known gap: ${row.knownGap}`
    : r.divergedAt != null
      ? `stopped at step ${r.divergedAt}: ${r.reason}`
      : r.status !== 'done'
        ? r.status
        : r.endUrl !== row.recordedEndUrl
          ? `done, but ended on ${r.endUrl} (recorded ${row.recordedEndUrl})`
          : `passed (${r.seconds} s)`;
  const pw = specs.get(row.name);
  const playwright = pw ? (pw.status === 'passed' ? 'passed' : `${pw.status}: ${pw.message}`) : 'not run';
  lines.push(`| ${row.name} | ${row.steps.length} | ${extension} | ${playwright} |`.replace(/\n/g, ' '));
}
const table = lines.join('\n');
writeFileSync(path.join(out, 'summary.md'), `${table}\n`);
console.log(`\n${table}\n\nSteps, screenshots and specs: ${path.relative(process.cwd(), out)}`);
