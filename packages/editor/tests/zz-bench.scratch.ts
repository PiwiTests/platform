// Scratch measurement, removed after use.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TestFunctionEntry } from '@piwitests/core/function-match';
import type { RawCaptureEvent } from '@piwitests/core/recording';
import { RecordingSessions, type LauncherEvents } from '../src/recorder/sessions';

const BASE = 'http://127.0.0.1:4173';
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
fs.writeFileSync(path.join(dist, 'record-ide.js'), '');
fs.writeFileSync(path.join(dist, 'record-ide-messages.json'), JSON.stringify({ en: {} }));

const catalog: TestFunctionEntry[] = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  name: `action${i}`,
  kind: 'page-object-method',
  module: `./pages/page${i % 20}.page`,
  receiver: `page${i % 20}Page`,
  importName: `Page${i % 20}Page`,
  params: [{ name: 'value', type: 'string' }],
  urlPattern: null,
  steps: [
    { action: 'fill', target: { role: 'textbox', name: `Field ${i}` } },
    { action: 'click', target: { role: 'button', name: `Button ${i}` } },
  ],
  paramSources: [{ param: 'value', stepIndex: 0, from: 'value' }],
}));

let clock = 1_000_000;
const tgt = (role: string, name: string) => ({
  tagName: role === 'button' ? 'button' : 'input',
  role,
  accessibleName: name,
  testId: null,
  text: role === 'button' ? name : null,
  alternatives: [
    { locator: `getByRole('${role}', { name: '${name}' })`, method: 'getByRole', score: 90 },
    { locator: `locator('#x${name.replace(/\W/g, '')}')`, method: 'locator', score: 60 },
  ],
  elementKey: name,
});
const ev = (kind: RawCaptureEvent['kind'], f: Partial<RawCaptureEvent>): RawCaptureEvent => ({
  kind,
  target: null,
  value: null,
  checked: null,
  inputType: null,
  isPasswordField: false,
  pageUrl: `${BASE}/p0`,
  timestamp: (clock += 1000),
  ...f,
});
const events: RawCaptureEvent[] = [];
let page = 0;
for (let i = 0; events.length < 1000; i++) {
  if (i % 20 === 0) {
    page++;
    events.push(ev('navigate', { value: `${BASE}/p${page}`, pageUrl: `${BASE}/p${page}` }));
    continue;
  }
  const n = i % 3 === 0 ? i % 200 : 1000 + i; // a third match a catalog entry
  events.push(ev('input', { target: tgt('textbox', `Field ${n}`), value: `v${i}`, pageUrl: `${BASE}/p${page}` }));
  events.push(ev('click', { target: tgt('button', `Button ${n}`), pageUrl: `${BASE}/p${page}` }));
}
events.length = 1000;

const text = ["import { test } from '@playwright/test';", "test('t', async ({ page }) => {", '', '});', ''].join('\n');
let ev2: LauncherEvents | null = null;
let steps = 0;
const sessions = new RecordingSessions({
  distDir: dist,
  notify: (u) => (steps = u.steps.length),
  readOptions: async (configFile) => ({
    configFile,
    rootDir: '/w',
    projects: [{ name: 'c', testDir: '/w', use: { baseURL: `${BASE}/` } }],
  }),
  launch: (_cwd, e) => {
    ev2 = e;
    return { send: () => {}, kill: () => {} };
  },
  env: {},
  readText: () => text,
});
await sessions.start(
  { uri: 'file:///w/t.spec.ts', line: 2, character: 0, into: 'steps' },
  { file: '/w/t.spec.ts', text, configFile: '/w/playwright.config.ts', catalog, preferLocators: new Set() },
);
ev2!.message({ type: 'started' });
const times: number[] = [];
const total0 = performance.now();
for (const e of events) {
  const t0 = performance.now();
  ev2!.message({ type: 'event', event: e });
  times.push(performance.now() - t0);
}
const total = performance.now() - total0;
const at = (n: number) => times.slice(n - 10, n).reduce((a, b) => a + b, 0) / 10;
console.log(`steps at the end: ${steps}`);
console.log(`mean of events 91-100: ${at(100).toFixed(2)} ms; 491-500: ${at(500).toFixed(2)} ms; 991-1000: ${at(1000).toFixed(2)} ms`);
console.log(`max: ${Math.max(...times).toFixed(2)} ms; total for 1000 renderings: ${(total / 1000).toFixed(2)} s`);
sessions.dispose();
fs.rmSync(dist, { recursive: true, force: true });
