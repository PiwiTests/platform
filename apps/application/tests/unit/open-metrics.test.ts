import { describe, expect, it } from 'vitest';
import {
  escapeLabelValue,
  metricFamilyName,
  renderOpenMetrics,
  type ProjectMetricSample,
} from '#shared/handlers/analytics/open-metrics';
import { getMetric } from '#shared/analytics/metrics';

function sample(project: string, values: Record<string, number | null>): ProjectMetricSample {
  return { projectId: 3, project, values: new Map(Object.entries(values)) as ProjectMetricSample['values'] };
}

describe('the OpenMetrics exposition', () => {
  it('names a family after the metric and its unit', () => {
    expect(metricFamilyName(getMetric('test-pass-rate'))).toEqual({
      name: 'piwi_test_pass_rate_percent',
      unit: 'percent',
    });
    expect(metricFamilyName(getMetric('runs'))).toEqual({ name: 'piwi_runs', unit: null });
    expect(metricFamilyName(getMetric('average-run-duration')).name).toBe('piwi_average_run_duration_milliseconds');
  });

  it('writes a gauge per metric, a sample per project with a value, and ends with # EOF', () => {
    const text = renderOpenMetrics(
      [sample('checkout', { 'test-pass-rate': 97.8, runs: 12 }), sample('search', { 'test-pass-rate': null, runs: 0 })],
      { ids: ['test-pass-rate', 'runs'], periodLabel: 'last 7 days', cost: null },
    );
    const lines = text.trim().split('\n');
    expect(lines).toContain('# TYPE piwi_test_pass_rate_percent gauge');
    expect(lines).toContain('# UNIT piwi_test_pass_rate_percent percent');
    expect(lines).toContain('piwi_test_pass_rate_percent{project="checkout",project_id="3"} 97.8');
    expect(lines).toContain('piwi_runs{project="search",project_id="3"} 0');
    // No value, no sample: a missing number is not a zero.
    expect(text).not.toContain('piwi_test_pass_rate_percent{project="search"');
    expect(lines.at(-1)).toBe('# EOF');
  });

  it('escapes a project name in a label, and labels a cost with its currency', () => {
    expect(escapeLabelValue('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
    const text = renderOpenMetrics([sample('x"}\n{', { 'wasted-ci-cost': 1.5 })], {
      ids: ['wasted-ci-cost'],
      periodLabel: 'last 7 days',
      cost: { amount: 0.008, currency: 'USD' },
    });
    expect(text).toContain('piwi_wasted_ci_cost{project="x\\"}\\n{",project_id="3",currency="USD"} 1.5');
  });
});
