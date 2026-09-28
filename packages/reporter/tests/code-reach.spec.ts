import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import type { JsCoverageEntry } from '@piwitests/core/code-reach';
import {
  codeReachRoots,
  resetCodeReachCaches,
  resolveCodeReach,
  startCodeReach,
  stopCodeReach,
} from '../src/internal/capture/code-reach.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const vlq = (n: number) => {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
};

let dir = '';

function write(file: string, text: string): string {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

beforeEach(() => {
  resetCodeReachCaches();
});

describe('resolveCodeReach', () => {
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-reach-')));
    write('src/components/Pay.vue', '<template><button>Pay</button></template>');
    write('src/cart.ts', 'export const x = 1;');
    write('src/unused.ts', 'export const y = 2;');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const roots = () => ({ roots: [dir], repoRoot: dir });

  it('a module served by path counts when a function other than its top level ran', async () => {
    const source = 'export function pay() {}\npay();';
    const ran: JsCoverageEntry = {
      url: 'http://localhost:5173/src/components/Pay.vue?t=1',
      source,
      functions: [
        { functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
        { functionName: 'pay', ranges: [{ startOffset: 7, endOffset: 24, count: 1 }] },
      ],
    };
    const importedOnly: JsCoverageEntry = {
      url: `http://localhost:5173/@fs${dir}/src/unused.ts`,
      source,
      functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }],
    };
    expect(await resolveCodeReach([ran, importedOnly], roots(), async () => null)).toEqual(['src/components/Pay.vue']);
  });

  it('a bundle resolves through its fetched source map, webpack prefixes and node_modules handled', async () => {
    // Line 0 maps to cart.ts, line 1 to node_modules, line 2 to unused.ts.
    const map = {
      version: 3,
      sources: ['webpack://shop/./src/cart.ts', 'webpack://shop/./node_modules/vue/index.js', 'webpack://shop/./src/unused.ts'],
      mappings: ['AAAA', `A${vlq(1)}AA`, `A${vlq(1)}AA`].join(';'),
    };
    const source = 'function a(){}\nfunction b(){}\nfunction c(){}\na();b();\n//# sourceMappingURL=app.js.map';
    const entry: JsCoverageEntry = {
      url: 'http://localhost:3000/assets/app.js',
      source,
      functions: [
        { functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
        { functionName: 'a', ranges: [{ startOffset: 0, endOffset: 14, count: 1 }] },
        { functionName: 'b', ranges: [{ startOffset: 15, endOffset: 29, count: 1 }] },
        { functionName: 'c', ranges: [{ startOffset: 30, endOffset: 44, count: 0 }] },
      ],
    };
    const fetched: string[] = [];
    const files = await resolveCodeReach([entry, entry], roots(), async (url) => {
      fetched.push(url);
      return JSON.stringify(map);
    });
    expect(files).toEqual(['src/cart.ts']);
    expect(fetched).toEqual(['http://localhost:3000/assets/app.js.map']);
  });

  it('a rebuilt bundle at the same address reads its new map', async () => {
    const mapTo = (file: string) => JSON.stringify({ version: 3, sources: [`webpack://shop/./${file}`], mappings: 'AAAA' });
    const build = (body: string): JsCoverageEntry => {
      const source = `${body}\n//# sourceMappingURL=app.js.map`;
      return {
        url: 'http://localhost:3000/assets/app.js',
        source,
        functions: [
          { functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
          { functionName: 'a', ranges: [{ startOffset: 0, endOffset: 14, count: 1 }] },
        ],
      };
    };
    const maps = [mapTo('src/cart.ts'), mapTo('src/unused.ts')];
    const fetchMap = async () => maps.shift() ?? null;
    expect(await resolveCodeReach([build('function a(){}a();')], roots(), fetchMap)).toEqual(['src/cart.ts']);
    expect(await resolveCodeReach([build('function a(){}a();a();')], roots(), fetchMap)).toEqual(['src/unused.ts']);
  });

  it('reads an inline map', async () => {
    const map = { version: 3, sources: ['src/cart.ts'], mappings: 'AAAA' };
    const inline = `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
    const source = `function a(){}a();\n//# sourceMappingURL=${inline}`;
    const entry: JsCoverageEntry = {
      url: 'http://localhost:3000/bundle.js',
      source,
      functions: [
        { functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
        { functionName: 'a', ranges: [{ startOffset: 0, endOffset: 14, count: 1 }] },
      ],
    };
    expect(await resolveCodeReach([entry], roots(), async () => null)).toEqual(['src/cart.ts']);
  });

  it('defaults the roots to the config directory and the repository root', () => {
    const r = codeReachRoots(dir, null);
    expect(r.roots[0]).toBe(dir);
    expect(codeReachRoots(dir, ['app']).roots).toEqual([path.join(dir, 'app')]);
  });
});

describe('in Chromium', () => {
  let browser: Browser | null = null;
  let server: http.Server;
  let url = '';

  beforeAll(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-reach-live-')));
    write('index.html', '<button id="pay">Pay</button><script type="module" src="/src/main.js"></script>');
    write('src/main.js', "import { pay } from './pay.js';\ndocument.querySelector('#pay').addEventListener('click', () => pay());\n");
    write('src/pay.js', "export function pay() {\n  document.body.dataset.paid = 'yes';\n}\n");
    write('src/idle.js', 'export function idle() {}\n');
    server = http.createServer((req, res) => {
      const file = path.join(dir, (req.url ?? '/').split('?')[0] === '/' ? 'index.html' : req.url!.split('?')[0]!);
      if (!fs.existsSync(file)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(fs.readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      browser = await chromium.launch();
    } catch {
      browser = null;
    }
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records the modules whose functions ran', async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await browser.newPage();
    expect(await startCodeReach(page)).toBe(true);
    await page.goto(url);
    await page.click('#pay');
    await page.waitForFunction("document.body.dataset.paid === 'yes'");
    const entries = await stopCodeReach(page);
    await page.close();
    const files = await resolveCodeReach(entries ?? [], { roots: [dir], repoRoot: dir }, async () => null);
    // main.js ran its click handler and pay.js its function; idle.js was never loaded.
    expect(files).toEqual(['src/main.js', 'src/pay.js']);
  });
});
