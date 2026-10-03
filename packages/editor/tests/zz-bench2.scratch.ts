import { performance } from 'node:perf_hooks';
import { renderSpec, stepLocator } from '@piwitests/core/codegen';
import { describeStepInWords } from '@piwitests/core/bug-report';
import { bugPhrases } from '@piwitests/core/bug-phrases';
import { sessionFromEvents } from '@piwitests/core/recording';
import { missingImports } from '../src/recorder/imports';
// reuse generation by importing the other script's data would run it; regenerate quickly
const BASE = 'http://127.0.0.1:4173';
const catalog: any[] = Array.from({ length: 200 }, (_, i) => ({
  id: i, name: `action${i}`, kind: 'page-object-method', module: `./pages/page${i % 20}.page`,
  receiver: `page${i % 20}Page`, importName: `Page${i % 20}Page`, params: [{ name: 'value', type: 'string' }],
  urlPattern: null,
  steps: [ { action: 'fill', target: { role: 'textbox', name: `Field ${i}` } }, { action: 'click', target: { role: 'button', name: `Button ${i}` } } ],
  paramSources: [{ param: 'value', stepIndex: 0, from: 'value' }],
}));
let clock = 1e6;
const tgt = (role: string, name: string) => ({ tagName: role === 'button' ? 'button' : 'input', role, accessibleName: name, testId: null,
  text: role === 'button' ? name : null,
  alternatives: [ { locator: `getByRole('${role}', { name: '${name}' })`, method: 'getByRole', score: 90 }, { locator: `locator('#x${name.replace(/\W/g, '')}')`, method: 'locator', score: 60 } ],
  elementKey: name });
const ev = (kind: any, f: any) => ({ kind, target: null, value: null, checked: null, inputType: null, isPasswordField: false, pageUrl: `${BASE}/p0`, timestamp: (clock += 1000), ...f });
const events: any[] = []; let page = 0;
for (let i = 0; events.length < 1000; i++) {
  if (i % 20 === 0) { page++; events.push(ev('navigate', { value: `${BASE}/p${page}`, pageUrl: `${BASE}/p${page}` })); continue; }
  const n = i % 3 === 0 ? i % 200 : 1000 + i;
  events.push(ev('input', { target: tgt('textbox', `Field ${n}`), value: `v${i}`, pageUrl: `${BASE}/p${page}` }));
  events.push(ev('click', { target: tgt('button', `Button ${n}`), pageUrl: `${BASE}/p${page}` }));
}
events.length = 1000;
const time = (label: string, f: () => unknown) => { f(); const t0 = performance.now(); for (let k = 0; k < 20; k++) f(); console.log(label, ((performance.now() - t0) / 20).toFixed(2), 'ms'); };
const s = sessionFromEvents(events, 1e6);
const opts: any = { format: 'body', bodyImports: 'none', locators: 'stable', urlChecks: true, page: 'page', preferLocators: new Set(), urls: 'relative' };
time('sessionFromEvents', () => sessionFromEvents(events, 1e6));
time('renderSpec, 200 entries', () => renderSpec(s, { ...opts, catalog }));
time('renderSpec, no catalog', () => renderSpec(s, opts));
const en = bugPhrases('en');
time('steps: words + locator', () => s.steps.map((st: any) => [describeStepInWords(st, en), st.target && stepLocator(st.target, { locators: 'stable' })]));
const r = renderSpec(s, { ...opts, catalog });
time('missingImports', () => missingImports("import { test } from '@playwright/test';\n".repeat(30), r.imports));
console.log('steps', s.steps.length, 'imports', r.imports.length);
