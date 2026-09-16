#!/usr/bin/env node
/**
 * Measures how legible the execution page (`/test-run-cases/:id`) and the failure
 * cluster page (`/failure-clusters/:id`) are, so the clarity plan's "In numbers"
 * table can be re-measured after each phase and diffed against the baseline.
 *
 * For each route it reads, inside the detail panel: the scroll offset of every
 * named block from the top of the panel, the panel's total scroll height, how
 * many interactive controls and help hints sit above the fold, the open code
 * blocks and their summed height, the word count, the active evidence tab and
 * the clue strength badges in order. It changes nothing on the page — it reads
 * the DOM after hydration and a bounded settle.
 *
 * Usage (from application/):
 *   node scripts/measure-detail-pages.mjs                       # boot + seed a throwaway server
 *   node scripts/measure-detail-pages.mjs --url http://localhost:3000
 *   node scripts/measure-detail-pages.mjs --routes /test-run-cases/37,/failure-clusters/10
 *   node scripts/measure-detail-pages.mjs --width 1280 --height 800
 *   node scripts/measure-detail-pages.mjs --json
 *
 * Without --url the script boots its own dev server and seeds a missing dev DB,
 * exactly like `take-feature-screenshots.mjs --route`; with --url it drives the
 * server you point it at (the common case — reuse a `npm run app:dev:bg` server).
 */
import { createRequire } from 'node:module';

import { startServer, resolveChromium, waitForPortFree } from './lib/dev-server.mjs';
import { waitForHydration, settlePage } from './lib/page-waits.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

/** The routes §1.5 measures: two executions and four clusters. */
const DEFAULT_ROUTES = [
  '/test-run-cases/37',
  '/test-run-cases/13',
  '/failure-clusters/10',
  '/failure-clusters/2',
  '/failure-clusters/5',
  '/failure-clusters/1',
];

function parseArgs(argv) {
  const flags = { url: null, routes: DEFAULT_ROUTES, width: 1280, height: 800, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') flags.url = argv[++i];
    else if (arg === '--routes')
      flags.routes = argv[++i]
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
    else if (arg === '--width') flags.width = Number(argv[++i]);
    else if (arg === '--height') flags.height = Number(argv[++i]);
    else if (arg === '--json') flags.json = true;
    else throw new Error(`unknown flag: ${arg}`);
  }
  for (const [flag, value] of [
    ['--width', flags.width],
    ['--height', flags.height],
  ]) {
    if (!(Number.isInteger(value) && value > 0)) throw new Error(`${flag} needs a positive integer`);
  }
  for (const route of flags.routes) {
    if (!route.startsWith('/')) throw new Error(`--routes needs absolute paths, got "${route}"`);
  }
  return flags;
}

/**
 * The measurement, serialized into the page. Self-contained (no module
 * closures): everything it needs arrives as its argument. Reads only.
 */
function measurePage({ viewportHeight }) {
  // The detail panel is a `UDashboardPanel`, whose `id` renders prefixed. The
  // summary is pinned above an independently scrolling tab body; blocks are
  // measured from the top of the whole panel, and the total is the tab body's
  // scroll height — the panel's real scrolling descendant.
  const panel =
    document.getElementById('dashboard-panel-test-run-case-detail') ||
    document.getElementById('dashboard-panel-failure-cluster-detail') ||
    document.getElementById('test-run-case-detail') ||
    document.getElementById('failure-cluster-detail') ||
    document.body;
  const panelTop = panel.getBoundingClientRect().top;

  let scroller = null;
  for (const el of panel.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (/auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      if (!scroller || el.scrollHeight > scroller.scrollHeight) scroller = el;
    }
  }

  const y = (el) => (el ? Math.round(el.getBoundingClientRect().top - panelTop) : null);
  const q = (sel) => panel.querySelector(sel);
  const headingSection = (tag, text) => {
    const heading = [...panel.querySelectorAll(tag)].find((e) => e.textContent.trim().startsWith(text));
    return heading ? (heading.closest('section') ?? heading) : null;
  };

  const positions = {
    header: y(q('h1')),
    headline: y(q('[data-shot="failure-headline"]')),
    situation: y(q('[data-shot="situation"]')),
    clusterState: y(q('[data-shot="cluster-state"]')),
    nextStep: y(q('[data-shot="next-step"]')),
    clues: y(q('[data-shot="failure-clues"]')),
    evidence: y(headingSection('h2', 'Evidence')),
    fix: y(q('[data-shot="fix"]')),
    fixLocatorFix: y(q('[data-shot="fix-locator-fix"]')),
    fixFixPlan: y(q('[data-shot="fix-fix-plan"]')),
    fixDiagnosis: y(q('[data-shot="fix-diagnosis"]')),
    fixVerify: y(q('[data-shot="fix-verify"]')),
    fixReproduce: y(q('[data-shot="fix-reproduce"]')),
    whatChanged: y(q('[data-shot="what-changed"]')),
    changesCard: y(headingSection('h3', 'What changed')),
    affectedTests: y(q('[data-shot="cluster-affected-tests"]')),
    history: y(q('[data-shot="execution-history"], [data-shot="cluster-history"]')),
  };

  const totalScrollHeight = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;

  const aboveFold = (el) => el.getBoundingClientRect().top < viewportHeight;
  const controlSelector = 'button, a[href], [role="tab"], select, input, textarea, [role="button"], [role="combobox"]';
  const controls = [...panel.querySelectorAll(controlSelector)].filter((el) => el.getBoundingClientRect().width > 0);
  const controlsAboveFold = controls.filter(aboveFold).length;

  // Only visible hints count — a zero-size hint in a hidden tab panel is not
  // "above the fold" in any real sense, the same filter the controls use.
  const helpHints = [...panel.querySelectorAll('button[aria-label^="Help:"]')].filter(
    (el) => el.getBoundingClientRect().width > 0,
  );
  const helpAboveFold = helpHints.filter(aboveFold).length;

  const pres = [...panel.querySelectorAll('pre')];
  const preHeight = Math.round(pres.reduce((sum, pre) => sum + pre.getBoundingClientRect().height, 0));

  const words = panel.innerText.split(/\s+/).filter(Boolean).length;
  const activeTab = (panel.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '').trim() || null;

  // The strength chip each clue carries (Strong / Medium / Weak), in DOM order —
  // the headline's top clue and the clue list below it.
  const strengths = new Set(['Strong', 'Medium', 'Weak']);
  const clueStrengths = [...panel.querySelectorAll('[data-shot="failure-headline"] *, [data-shot="failure-clues"] *')]
    .filter((el) => el.children.length === 0 && strengths.has(el.textContent.trim()))
    .map((el) => el.textContent.trim());

  // How many distinct text styles the situation block mixes: every visible text
  // node's size, weight, family, color, transform and decoration, deduplicated.
  // The typography rule caps this per page; a rise needs a reason in the PR.
  const block = panel.querySelector('[data-shot="situation-block"]');
  const styles = new Set();
  if (block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || !node.parentElement) continue;
      const cs = getComputedStyle(node.parentElement);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      styles.add(
        [
          cs.fontSize,
          cs.fontWeight,
          cs.fontFamily,
          cs.color,
          cs.textTransform,
          cs.fontStyle,
          cs.textDecorationLine,
        ].join('|'),
      );
    }
  }
  const distinctTextStyles = block ? styles.size : null;

  return {
    positions,
    totalScrollHeight,
    controls: controls.length,
    controlsAboveFold,
    help: helpHints.length,
    helpAboveFold,
    pre: pres.length,
    preHeight,
    words,
    activeTab,
    clueStrengths,
    distinctTextStyles,
  };
}

async function measureRoute(page, base, route, { height }) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  await waitForHydration(page);
  await settlePage(page);
  const measured = await page.evaluate(measurePage, { viewportHeight: height });
  return { route, ...measured };
}

/** The block offsets printed as a column, in reading order, skipping the absent ones. */
const POSITION_LABELS = [
  ['header', 'header (h1)'],
  ['headline', 'headline'],
  ['situation', 'situation'],
  ['clusterState', 'cluster state'],
  ['nextStep', 'next step'],
  ['clues', 'clues'],
  ['evidence', 'evidence'],
  ['fix', 'fix'],
  ['fixLocatorFix', '· locator fix'],
  ['fixFixPlan', '· fix plan'],
  ['fixDiagnosis', '· diagnosis'],
  ['fixVerify', '· verify'],
  ['fixReproduce', '· reproduce'],
  ['whatChanged', 'what changed'],
  ['changesCard', '· changes card'],
  ['affectedTests', 'affected tests'],
  ['history', 'history'],
];

function printTable(results, { width, height }) {
  for (const result of results) {
    console.log(`\n${result.route}  (${width}×${height})`);
    console.log('─'.repeat(60));
    console.log('  px from top of panel:');
    for (const [key, label] of POSITION_LABELS) {
      const value = result.positions[key];
      if (value != null) console.log(`    ${label.padEnd(18)} ${String(value).padStart(6)}`);
    }
    console.log(`  total scroll height ${String(result.totalScrollHeight).padStart(6)}`);
    console.log(
      `  controls above the fold ${result.controlsAboveFold} / ${result.controls} · ` +
        `help hints ${result.helpAboveFold} above / ${result.help} · ` +
        `code blocks ${result.pre} (${result.preHeight}px) · words ${result.words}`,
    );
    console.log(`  active evidence tab: ${result.activeTab ?? '—'}`);
    console.log(`  clue strengths: ${result.clueStrengths.length ? result.clueStrengths.join(', ') : '—'}`);
    console.log(`  distinct text styles in the situation block: ${result.distinctTextStyles ?? '—'}`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const server = flags.url ? { base: flags.url, stop: () => {} } : await startServer({ mode: 'web' });
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: flags.width, height: flags.height } });
    const page = await context.newPage();
    // A dev server compiles routes on first hit — well past the 30s default.
    page.setDefaultNavigationTimeout(90_000);
    for (const route of flags.routes) {
      results.push(await measureRoute(page, server.base, route, { height: flags.height }));
    }
    await context.close();
  } finally {
    await browser.close();
    server.stop();
    if (!flags.url) await waitForPortFree(server.base);
  }

  if (flags.json) {
    for (const result of results) console.log(JSON.stringify(result));
  } else {
    printTable(results, flags);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
