import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM module of the measurement script, without type declarations
import * as budgets from '../../scripts/lib/detail-page-budgets.mjs';

const { BUDGET_VIEWPORT, DEFAULT_ROUTES, NEXT_STEP_COPIES, budgetText, evaluateBudgets, pageKind, parseMeasureArgs } =
  budgets;

interface Verdict {
  id: string;
  label: string;
  value: number | null;
  max: number | null;
  verdict: 'pass' | 'fail' | 'n/a';
  note: string | null;
}

const AT_BUDGET = { ...BUDGET_VIEWPORT };

/** A measured result that passes every budget, with the fields the budgets read. */
function measured(route: string, overrides: Record<string, unknown> = {}) {
  return {
    route,
    httpStatus: 200,
    distinctTextStyles: 10,
    controlsAboveFold: 20,
    solidPrimaryAboveFold: 1,
    nextStep: {
      kind: 'apply-patch',
      action: 'copy-git-apply',
      label: 'Copy git apply',
      copies: 'budgeted',
      rendered: true,
      inBlock: true,
      distance: 0,
    },
    ...overrides,
  };
}

const byId = (verdicts: Verdict[], id: string) => verdicts.find((v) => v.id === id);

describe('pageKind', () => {
  it('names the two failure pages and nothing else', () => {
    expect(pageKind('/test-run-cases/37')).toBe('execution');
    expect(pageKind('/failure-clusters/2?tab=x')).toBe('cluster');
    expect(pageKind('/test-cases/1')).toBeNull();
  });
});

describe('evaluateBudgets', () => {
  it('holds the execution page to 15 text styles and the cluster page to 12', () => {
    const execution = byId(
      evaluateBudgets(measured('/test-run-cases/37', { distinctTextStyles: 14 }), AT_BUDGET),
      'text-styles',
    );
    expect(execution).toMatchObject({ value: 14, max: 15, verdict: 'pass' });
    const cluster = byId(
      evaluateBudgets(measured('/failure-clusters/2', { distinctTextStyles: 13 }), AT_BUDGET),
      'text-styles',
    );
    expect(cluster).toMatchObject({ value: 13, max: 12, verdict: 'fail' });
  });

  it('counts at most 25 controls and one solid primary above the fold on both pages', () => {
    const verdicts = evaluateBudgets(
      measured('/failure-clusters/10', { controlsAboveFold: 33, solidPrimaryAboveFold: 2 }),
      AT_BUDGET,
    );
    expect(byId(verdicts, 'controls-above-fold')).toMatchObject({ value: 33, max: 25, verdict: 'fail' });
    expect(byId(verdicts, 'solid-primary-above-fold')).toMatchObject({ value: 2, max: 1, verdict: 'fail' });
  });

  it('gives no verdict away from 1280×800', () => {
    const verdicts: Verdict[] = evaluateBudgets(measured('/test-run-cases/37', { controlsAboveFold: 40 }), {
      width: 390,
      height: 844,
    });
    expect(verdicts.length).toBeGreaterThan(0);
    for (const v of verdicts) expect(v).toMatchObject({ verdict: 'n/a', note: 'budgets are set at 1280×800' });
    expect(byId(verdicts, 'controls-above-fold')?.value).toBe(40);
  });

  it('passes a copied change shown in the block and fails one further down or missing', () => {
    const route = '/test-run-cases/37';
    const inBlock = byId(evaluateBudgets(measured(route), AT_BUDGET), 'next-content-distance');
    expect(inBlock).toMatchObject({ value: 0, verdict: 'pass', note: 'in the block' });

    const far = measured(route, {
      nextStep: { ...measured(route).nextStep, inBlock: false, distance: 1200 },
    });
    expect(byId(evaluateBudgets(far, AT_BUDGET), 'next-content-distance')).toMatchObject({
      value: 1200,
      verdict: 'fail',
      note: '1 200 px below',
    });

    const missing = measured(route, {
      nextStep: { ...measured(route).nextStep, rendered: false, inBlock: false, distance: null },
    });
    expect(byId(evaluateBudgets(missing, AT_BUDGET), 'next-content-distance')).toMatchObject({
      value: null,
      verdict: 'fail',
      note: 'not on the page',
    });
  });

  it('leaves an action that copies nothing, or a reported one, without a verdict', () => {
    const route = '/failure-clusters/10';
    const resolve = measured(route, {
      nextStep: {
        kind: 'mark-resolved',
        action: 'mark-resolved',
        label: 'Mark resolved',
        copies: null,
        distance: null,
      },
    });
    expect(byId(evaluateBudgets(resolve, AT_BUDGET), 'next-content-distance')).toMatchObject({ verdict: 'n/a' });

    const recipe = measured(route, {
      nextStep: { kind: 'reproduce', action: 'copy-recipe', label: 'Copy recipe', copies: 'reported', distance: 2400 },
    });
    expect(byId(evaluateBudgets(recipe, AT_BUDGET), 'next-content-distance')).toMatchObject({
      value: 2400,
      verdict: 'n/a',
    });

    const none = measured(route, { nextStep: null });
    expect(byId(evaluateBudgets(none, AT_BUDGET), 'next-content-distance')).toMatchObject({
      verdict: 'n/a',
      note: 'no next step',
    });
  });

  it('leaves the text styles without a verdict when the page has no situation block', () => {
    const verdict = byId(
      evaluateBudgets(measured('/test-run-cases/37', { distinctTextStyles: null }), AT_BUDGET),
      'text-styles',
    );
    expect(verdict).toMatchObject({ verdict: 'n/a', note: 'no situation block' });
  });

  it('holds no other page to a budget', () => {
    expect(evaluateBudgets(measured('/test-cases/1'), AT_BUDGET)).toEqual([]);
  });

  it('fails a route that answered an error', () => {
    const verdicts = evaluateBudgets(measured('/test-run-cases/999999', { httpStatus: 404 }), AT_BUDGET);
    expect(verdicts).toEqual([expect.objectContaining({ id: 'route', verdict: 'fail', value: 404 })]);
  });

  it('prints each verdict as one short phrase', () => {
    const verdicts: Verdict[] = evaluateBudgets(
      measured('/test-run-cases/37', {
        controlsAboveFold: 38,
        distinctTextStyles: 14,
        nextStep: { kind: 'apply-patch', action: 'copy-git-apply', copies: 'budgeted', distance: null },
      }),
      AT_BUDGET,
    );
    expect(verdicts.map(budgetText)).toEqual([
      '✓ text styles 14 ≤ 15',
      '✗ controls 38 > 25',
      '✗ next-step content not on the page',
      '✓ solid primary buttons 1 ≤ 1',
    ]);
  });
});

describe('parseMeasureArgs', () => {
  it('defaults to the budget viewport and the seeded routes', () => {
    expect(parseMeasureArgs([])).toMatchObject({
      url: null,
      routes: DEFAULT_ROUTES,
      width: 1280,
      height: 800,
      json: false,
      check: false,
    });
    expect(parseMeasureArgs(['--check', '--json', '--routes', '/test-run-cases/1, /failure-clusters/2'])).toMatchObject(
      {
        check: true,
        json: true,
        routes: ['/test-run-cases/1', '/failure-clusters/2'],
      },
    );
  });

  it('rejects an unknown flag, a relative route and a viewport that is not an integer', () => {
    expect(() => parseMeasureArgs(['--fast'])).toThrow('unknown flag: --fast');
    expect(() => parseMeasureArgs(['--routes', 'test-run-cases/37'])).toThrow('absolute paths');
    expect(() => parseMeasureArgs(['--width', '12.5'])).toThrow('--width needs a positive integer');
    expect(() => parseMeasureArgs(['--url'])).toThrow('--url needs an http(s) URL');
  });
});

describe('the Next actions the distance budget knows', () => {
  it('lists every copying primary action of the next-step policy', () => {
    const policy = readFileSync(fileURLToPath(new URL('../../shared/next-step.ts', import.meta.url)), 'utf8');
    const copying = [...policy.matchAll(/primary:\s*\{[^}]*?action:\s*'(copy-[^']+)'/g)].map((m) => m[1]);
    expect(copying.length).toBeGreaterThan(0);
    for (const action of new Set(copying)) {
      expect(Object.keys(NEXT_STEP_COPIES), `${action} needs a class in NEXT_STEP_COPIES`).toContain(action);
    }
  });

  it('finds a data-copies carrier in a component for every budgeted action', () => {
    const components = fileURLToPath(new URL('../../app/components', import.meta.url));
    const carried = new Set(
      readdirSync(components, { recursive: true })
        .map(String)
        .filter((file) => file.endsWith('.vue'))
        .flatMap((file) => [...readFileSync(join(components, file), 'utf8').matchAll(/data-copies="([^"]*)"/g)])
        .flatMap((m) => m[1].split(/\s+/)),
    );
    const budgeted = Object.entries(NEXT_STEP_COPIES)
      .filter(([, kind]) => kind === 'budgeted')
      .map(([action]) => action);
    expect(budgeted.length).toBeGreaterThan(0);
    for (const action of budgeted) {
      expect([...carried], `no component carries data-copies="${action}"`).toContain(action);
    }
  });
});
