import { describe, expect, it } from 'vitest';
import { percentOf, renderBadgeSvg, reportBadge } from '#shared/reports/badge';
import { PASS_RATE_COLORS } from '#shared/status-colors';
import type { ReportBundle } from '#shared/reports/types';
import { fixtureBundle } from './report-fixture';

function withPassRate(value: string, over: Partial<ReportBundle> = {}): ReportBundle {
  const bundle = { ...fixtureBundle(), ...over };
  bundle.bands = [
    {
      title: 'Where things stand',
      description: null,
      widgets: [
        {
          key: 'headline',
          type: 'stats',
          title: 'Headline',
          notes: [],
          blocks: [
            {
              kind: 'stats',
              tiles: [
                {
                  metric: 'runs',
                  label: 'Runs',
                  value: '12',
                  change: null,
                  tone: 'neutral',
                  note: null,
                  definition: null,
                },
                {
                  metric: 'test-pass-rate',
                  label: 'Test pass rate',
                  value,
                  change: null,
                  tone: 'neutral',
                  note: null,
                  definition: null,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  return bundle;
}

describe('the status badge', () => {
  it('reads the pass rate tile, the branch policy and the period length', () => {
    const bundle = withPassRate('97.8%', {
      period: { from: '2026-09-18T00:00:00.000Z', to: '2026-09-25T00:00:00.000Z', label: 'Last 7 days' },
    });
    bundle.scope = { ...bundle.scope, branches: ['main'] };
    const badge = reportBadge(bundle);
    expect(badge.label).toBe('tests on main');
    expect(badge.value).toBe('97.8% · 7 d');
    expect(badge.color).toBe(PASS_RATE_COLORS.good.fill);
  });

  it('colors a poor pass rate on the shared scale, and reads a French number', () => {
    expect(percentOf('41,5 %')).toBe(41.5);
    const badge = reportBadge(withPassRate('41,5 %', { language: 'fr' }));
    expect(badge.color).toBe(PASS_RATE_COLORS.poor.fill);
    expect(badge.label.startsWith('tests sur ')).toBe(true);
  });

  it('names the default branch policy when the scope lists no branch', () => {
    const bundle = withPassRate('97.8%');
    bundle.scope = { ...bundle.scope, branches: undefined, defaultBranchOnly: true };
    expect(reportBadge(bundle).label).toBe('tests on default branch');
  });

  it('falls back to the verdict when the report has no pass rate tile', () => {
    const bundle = { ...fixtureBundle(), bands: [] };
    expect(reportBadge(bundle).value).toMatch(/^(healthy|mixed|poor) · \d+ d$/);
  });

  it('escapes every string it draws', () => {
    const svg = renderBadgeSvg({ label: '<script>alert(1)</script>', value: '"&', color: '#fff" onload="x' });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('onload="x');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });
});
