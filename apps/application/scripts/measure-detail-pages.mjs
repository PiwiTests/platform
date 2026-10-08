#!/usr/bin/env node
/**
 * Measures how legible the execution page (`/test-run-cases/:id`) and the failure
 * cluster page (`/failure-clusters/:id`) are, as numbers two versions of the
 * pages can be diffed on, and checks them against their budgets.
 *
 * For each route it reads, inside the detail panel: the scroll offset of every
 * named block from the top of the panel, the panel's total scroll height, how
 * many interactive controls sit above the fold (split into the navbar, the
 * situation block and what is below it), the help hints above the fold, the
 * open code blocks and their summed height, the word count, the active evidence
 * tab, the grade of the Most likely line, the Next step's action and how far
 * below its button the content it copies sits, and the text styles the
 * situation block mixes. It changes nothing on the page — it reads the DOM
 * after hydration and a bounded settle.
 *
 * The budgets (`scripts/lib/detail-page-budgets.mjs`) hold at 1280×800: at most
 * 15 text styles in the execution page's situation block and 12 in the cluster
 * page's, at most 25 controls above the fold with the navbar included, at most
 * one solid primary button above the fold, and a Next step that copies a code
 * change shows that change in the block (distance 0). The script finds the Next
 * action by `data-next-action` and what it copies by `data-copies`, never by a
 * label. The report prints a verdict per route; `--check` exits 1 on a breach.
 *
 * Usage (from application/):
 *   node scripts/measure-detail-pages.mjs                       # boot + seed a server on --port (3050)
 *   node scripts/measure-detail-pages.mjs --url http://localhost:3000
 *   node scripts/measure-detail-pages.mjs --routes /test-run-cases/37,/failure-clusters/10
 *   node scripts/measure-detail-pages.mjs --width 1280 --height 800
 *   node scripts/measure-detail-pages.mjs --json
 *   node scripts/measure-detail-pages.mjs --check               # exit 1 when a budget breaks
 *
 * Without --url the script boots its own dev server and seeds a missing dev DB,
 * exactly like `take-feature-screenshots.mjs --route`; with --url it drives the
 * server you point it at.
 */
import { createRequire } from 'node:module';

import { startServer, resolveChromium, waitForPortFree } from './lib/dev-server.mjs';
import { waitForHydration, settlePage } from './lib/page-waits.mjs';
import {
  NEXT_STEP_COPIES,
  budgetText,
  distanceText,
  evaluateBudgets,
  pageKind,
  parseMeasureArgs,
} from './lib/detail-page-budgets.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

/**
 * The measurement, serialized into the page. Self-contained (no module
 * closures): everything it needs arrives as its argument. Reads only.
 */
function measurePage({ viewportHeight, copyActions }) {
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
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const positions = {
    header: y(q('h1')),
    headline: y(q('[data-shot="failure-headline"]')),
    story: y(q('[data-shot="most-likely"]')),
    situation: y(q('[data-shot="situation"]')),
    clusterState: y(q('[data-shot="cluster-state"]')),
    issue: y(q('[data-shot="issue-line"]')),
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
    occurrenceTrend: y(q('[data-shot="cluster-occurrence-trend"]')),
    activity: y(q('[data-shot="cluster-activity"]')),
    history: y(q('[data-shot="execution-history"]')),
  };

  const totalScrollHeight = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;

  const block = q('[data-shot="situation-block"]');
  // The panel's body slot; a control of the panel outside it sits in the navbar.
  const body = [...panel.children].find((child) => child.getAttribute('data-slot') === 'body') ?? null;

  const aboveFold = (el) => el.getBoundingClientRect().top < viewportHeight;
  const controlSelector = 'button, a[href], [role="tab"], select, input, textarea, [role="button"], [role="combobox"]';
  const controls = [...panel.querySelectorAll(controlSelector)].filter((el) => el.getBoundingClientRect().width > 0);
  const above = controls.filter(aboveFold);
  const controlsAboveFold = above.length;
  const controlsAboveFoldByRegion = { navbar: 0, block: 0, below: 0 };
  for (const el of above) {
    if (block?.contains(el)) controlsAboveFoldByRegion.block++;
    else if (body && !body.contains(el)) controlsAboveFoldByRegion.navbar++;
    else controlsAboveFoldByRegion.below++;
  }
  // The solid primary buttons — the page's one saturated action — above the fold.
  const solidPrimaryAboveFold = above.filter((el) => el.classList.contains('bg-primary')).length;

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

  // The grade the Most likely line states on its meta line (Strong / Medium /
  // Weak, or Diagnosed with its confidence).
  const mostLikelyRoot = q('[data-shot="most-likely"]');
  const gradePattern = /^(Strong|Medium|Weak|Diagnosed(, .+ confidence)?)$/;
  const gradeEl = mostLikelyRoot
    ? [...mostLikelyRoot.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && gradePattern.test(el.textContent.trim()),
      )
    : null;
  const mostLikely = mostLikelyRoot ? { grade: gradeEl ? gradeEl.textContent.trim() : null } : null;

  // The Next step: its kind and action ids, and — for an action that copies
  // something — how far the visible content it copies (`data-copies`) sits
  // below its button: 0 inside the situation block, null when no such content
  // is visible anywhere on the page.
  const nextRoot = q('[data-shot="next-step"]');
  let nextStep = null;
  if (nextRoot) {
    const button = nextRoot.querySelector('[data-next-action]');
    const action = button?.getAttribute('data-next-action') ?? null;
    const copies = (action && copyActions[action]) || null;
    nextStep = {
      kind: nextRoot.getAttribute('data-next-kind'),
      action,
      label: button ? button.textContent.trim() : null,
      copies,
      rendered: null,
      inBlock: null,
      distance: null,
    };
    if (copies) {
      const content = [...panel.querySelectorAll('[data-copies]')]
        .filter((el) => el.getAttribute('data-copies').split(/\s+/).includes(action))
        .filter(visible);
      nextStep.rendered = content.length > 0;
      nextStep.inBlock = content.some((el) => block?.contains(el));
      if (nextStep.inBlock) nextStep.distance = 0;
      else if (content.length) {
        const from = button.getBoundingClientRect();
        const gaps = content.map((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top >= from.bottom ? rect.top - from.bottom : Math.max(0, from.top - rect.bottom);
        });
        // Outside the block it is never 0, which the budget reserves for "in the block".
        nextStep.distance = Math.max(1, Math.round(Math.min(...gaps)));
      }
    }
  }

  // How many distinct text styles the situation block mixes: every visible text
  // node's size, weight, family, color, transform and decoration, deduplicated.
  // An SVG tooltip (`<title>`, `<desc>`) and visually hidden text are not seen.
  // The typography rule caps this per page; a rise needs a reason in the PR.
  const styles = new Set();
  if (block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.textContent.trim() || !parent) continue;
      if (parent.closest('svg title, svg desc')) continue;
      const rect = parent.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      // A code chip counts once, whatever colors its syntax tokens take.
      const cs = getComputedStyle(parent.closest('code') ?? parent);
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
    controlsAboveFoldByRegion,
    solidPrimaryAboveFold,
    help: helpHints.length,
    helpAboveFold,
    pre: pres.length,
    preHeight,
    words,
    activeTab,
    mostLikely,
    nextStep,
    distinctTextStyles,
  };
}

/**
 * The API requests a page has in flight, an event stream excepted. A failure
 * page fills some of its lines after hydration (the cluster's What changed line
 * waits on its diagnosis context), so a measure taken before they answer reads
 * a different page from one taken after.
 */
function trackApiRequests(page) {
  const inFlight = new Set();
  const isApi = (request) => ['fetch', 'xhr'].includes(request.resourceType()) && request.url().includes('/api/');
  page.on('request', (request) => {
    if (isApi(request)) inFlight.add(request);
  });
  page.on('requestfinished', (request) => inFlight.delete(request));
  page.on('requestfailed', (request) => inFlight.delete(request));
  return inFlight;
}

async function waitForApiRequests(page, inFlight, route, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (inFlight.size && Date.now() < deadline) await page.waitForTimeout(250);
  if (inFlight.size)
    console.warn(`warning: ${route} still had ${inFlight.size} API request(s) in flight when measured`);
  await settlePage(page);
}

/**
 * The status of the record a failure page shows (`/api/test-run-cases/:id`,
 * `/api/failure-clusters/:id`). The page itself answers 200 for an id that does
 * not exist and renders its own error state, so the record says whether there
 * is anything to measure. Null for any other route.
 */
async function recordStatus(page, base, route) {
  if (!pageKind(route)) return null;
  const path = route.split(/[?#]/)[0];
  return (await page.request.get(`${base}/api${path}`)).status();
}

async function measureRoute(page, inFlight, base, route, viewport) {
  const httpStatus = await recordStatus(page, base, route);
  if (httpStatus != null && httpStatus >= 400) {
    console.warn(`warning: ${route} answered ${httpStatus} — the seeded ids it names may have moved`);
    const result = { route, httpStatus, measured: false };
    return { ...result, budgets: evaluateBudgets(result, viewport) };
  }
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  await waitForHydration(page);
  await settlePage(page);
  await waitForApiRequests(page, inFlight, route);
  const reading = await page.evaluate(measurePage, {
    viewportHeight: viewport.height,
    copyActions: NEXT_STEP_COPIES,
  });
  const result = { route, httpStatus, measured: true, ...reading };
  return { ...result, budgets: evaluateBudgets(result, viewport) };
}

/** The block offsets printed as a column, in reading order, skipping the absent ones. */
const POSITION_LABELS = [
  ['header', 'header (h1)'],
  ['headline', 'headline'],
  ['story', 'most likely'],
  ['situation', 'situation'],
  ['clusterState', 'cluster state'],
  ['issue', 'issue'],
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
  ['occurrenceTrend', 'occurrences trend'],
  ['activity', 'activity'],
  ['history', 'history'],
];

function nextStepText(next) {
  if (!next) return '—';
  const head = [next.kind, next.action].filter(Boolean).join(' · ') || 'no action id';
  if (!next.copies) return head;
  return `${head} → ${distanceText(next.distance)}${next.copies === 'reported' ? ' (reported only)' : ''}`;
}

function printTable(results, { width, height }) {
  for (const result of results) {
    console.log(`\n${result.route}  (${width}×${height})`);
    console.log('─'.repeat(60));
    if (!result.measured) {
      console.log(`  not measured: its record answered ${result.httpStatus}`);
      continue;
    }
    console.log('  px from top of panel:');
    for (const [key, label] of POSITION_LABELS) {
      const value = result.positions[key];
      if (value != null) console.log(`    ${label.padEnd(18)} ${String(value).padStart(6)}`);
    }
    const region = result.controlsAboveFoldByRegion;
    console.log(`  total scroll height ${String(result.totalScrollHeight).padStart(6)}`);
    console.log(
      `  controls above the fold ${result.controlsAboveFold} / ${result.controls} ` +
        `(navbar ${region.navbar} · block ${region.block} · below ${region.below}) · ` +
        `solid primary ${result.solidPrimaryAboveFold}`,
    );
    console.log(
      `  help hints ${result.helpAboveFold} above / ${result.help} · ` +
        `code blocks ${result.pre} (${result.preHeight}px) · words ${result.words}`,
    );
    console.log(`  active evidence tab: ${result.activeTab ?? '—'}`);
    console.log(`  most likely: ${result.mostLikely?.grade ?? '—'}`);
    console.log(`  next step: ${nextStepText(result.nextStep)}`);
    console.log(`  distinct text styles in the situation block: ${result.distinctTextStyles ?? '—'}`);
    if (result.budgets.length) console.log(`  budgets: ${result.budgets.map(budgetText).join(' · ')}`);
  }
}

/** The breaches of every route, one line each, or a line saying there are none. */
function printSummary(results) {
  const breaches = results.flatMap((result) =>
    result.budgets
      .filter((budget) => budget.verdict === 'fail')
      .map((budget) => `${result.route}  ${budgetText(budget)}`),
  );
  console.log('');
  if (!breaches.length) {
    console.log('Every budget holds.');
    return;
  }
  console.log(`${breaches.length} budget breach${breaches.length === 1 ? '' : 'es'}:`);
  for (const line of breaches) console.log(`  ${line}`);
}

async function main() {
  const flags = parseMeasureArgs(process.argv.slice(2));
  const viewport = { width: flags.width, height: flags.height };

  const server = flags.url ? { base: flags.url, stop: () => {} } : await startServer({ mode: 'web', port: flags.port });
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const inFlight = trackApiRequests(page);
    // A dev server compiles routes on first hit — well past the 30s default.
    page.setDefaultNavigationTimeout(90_000);
    for (const route of flags.routes) {
      results.push(await measureRoute(page, inFlight, server.base, route, viewport));
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
    printSummary(results);
  }

  if (flags.check && results.some((result) => result.budgets.some((budget) => budget.verdict === 'fail'))) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
