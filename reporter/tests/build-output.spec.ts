import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const dist = (...segments: string[]) => join(import.meta.dirname, '..', 'dist', ...segments);

describe('Build output', () => {
  it('package.json should have correct metadata', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));
    assert.equal(pkg.name, '@phenx/piwi-dashboard-reporter');
    assert.equal(pkg.main, 'dist/index.js');
    assert.equal(pkg.types, 'dist/index.d.ts');
    assert.ok(pkg.peerDependencies);
    assert.ok(pkg.peerDependencies['@playwright/test']);
  });

  it('config.d.ts should define PiwiDashboardOptions with all fields', () => {
    const content = readFileSync(dist('config.d.ts'), 'utf-8');
    assert.ok(content.includes('PiwiDashboardOptions'));
    assert.ok(content.includes('serverUrl'));
    assert.ok(content.includes('projectName'));
    assert.ok(content.includes('uploadReport'));
    assert.ok(content.includes('uploadTraces'));
    assert.ok(content.includes('apiKey'));
    assert.ok(content.includes('username'));
    assert.ok(content.includes('password'));
    assert.ok(content.includes('reports'));
    assert.ok(content.includes('type: string'));
    assert.ok(content.includes('dir?: string'));
    assert.ok(content.includes('label?: string'));
    assert.ok(content.includes('collectPerformanceMetrics'));
  });

  it('fixtures.js should exist and export dashboardFixtures', () => {
    assert.ok(existsSync(dist('fixtures.js')));
    const source = readFileSync(dist('fixtures.js'), 'utf-8');
    assert.ok(source.includes('dashboardFixtures'));
    assert.ok(source.includes('exports.dashboardFixtures'));
    assert.ok(source.includes('page.on'));
    assert.ok(source.includes('requestfinished'));
    assert.ok(source.includes('piwi-dashboard-network'));
    assert.ok(source.includes('piwi-dashboard-web-vitals'));
  });

  it('fixtures.d.ts should export dashboardFixtures type', () => {
    const content = readFileSync(dist('fixtures.d.ts'), 'utf-8');
    assert.ok(content.includes('dashboardFixtures'));
  });

  it('step-analyzer.js should export step metrics functions', () => {
    assert.ok(existsSync(dist('step-analyzer.js')));
    const source = readFileSync(dist('step-analyzer.js'), 'utf-8');
    assert.ok(source.includes('collectStepMetrics'));
    assert.ok(source.includes('computePerformanceSummary'));
    assert.ok(source.includes('flattenSteps'));
    assert.ok(source.includes('categorizeStep'));
  });

  it('metadata-collector.js should have MetadataCollector class', () => {
    assert.ok(existsSync(dist('metadata-collector.js')));
    const source = readFileSync(dist('metadata-collector.js'), 'utf-8');
    assert.ok(source.includes('class MetadataCollector'));
    assert.ok(source.includes('collectScmInfo'));
    assert.ok(source.includes('collectCiInfo'));
  });

  it('http-client.js should have HttpClient class with HTTP helpers', () => {
    assert.ok(existsSync(dist('http-client.js')));
    const source = readFileSync(dist('http-client.js'), 'utf-8');
    assert.ok(source.includes('class HttpClient'));
    assert.ok(source.includes('postJSON'));
    assert.ok(source.includes('postFormData'));
    assert.ok(source.includes('login'));
  });

  it('file-handler.js should export file discovery functions', () => {
    assert.ok(existsSync(dist('file-handler.js')));
    const source = readFileSync(dist('file-handler.js'), 'utf-8');
    assert.ok(source.includes('findHTMLReportDirectory'));
    assert.ok(source.includes('findReportDirectory'));
    assert.ok(source.includes('compressReportDirectory'));
    assert.ok(source.includes('findTraceFiles'));
    assert.ok(source.includes('getDefaultReportDirs'));
    assert.ok(source.includes('monocart'));
    assert.ok(source.includes('blob'));
  });
});
