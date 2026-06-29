import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = (...segments: string[]) => join(import.meta.dirname, '..', 'dist', ...segments);

describe('Build output', () => {
  it('package.json should have correct metadata', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('@piwitests/reporter');
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.peerDependencies).toBeTruthy();
    expect(pkg.peerDependencies['@playwright/test']).toBeTruthy();
  });

  it('public/options.d.ts should define PiwiDashboardOptions with all fields', () => {
    const content = readFileSync(dist('public', 'options.d.ts'), 'utf-8');
    expect(content).toContain('PiwiDashboardOptions');
    expect(content).toContain('serverUrl');
    expect(content).toContain('projectName');
    expect(content).toContain('uploadReport');
    expect(content).toContain('uploadTraces');
    expect(content).toContain('apiKey');
    expect(content).toContain('username');
    expect(content).toContain('password');
    expect(content).toContain('reports');
    expect(content).toContain('type: string');
    expect(content).toContain('dir?: string');
    expect(content).toContain('label?: string');
    expect(content).toContain('collectPerformanceMetrics');
  });

  it('index.js re-exports the capture fixtures (single entry, no subpath)', () => {
    const source = readFileSync(dist('index.js'), 'utf-8');
    expect(source).toContain('dashboardFixtures');
    expect(source).toContain('extendDashboardFixtures');
  });

  it('capture-fixtures.js should contain the capture implementation', () => {
    const source = readFileSync(dist('internal', 'capture', 'capture-fixtures.js'), 'utf-8');
    expect(source).toContain('dashboardFixtures');
    expect(source).toContain('page.on');
    expect(source).toContain('requestfinished');
    // Attachment names live in attachments.ts; capture-fixtures.js references them.
    expect(source).toContain('ATTACHMENT_NAMES');
  });

  it('attachments.js should define the dashboard attachment names', () => {
    expect(existsSync(dist('internal', 'capture', 'attachments.js'))).toBe(true);
    const source = readFileSync(dist('internal', 'capture', 'attachments.js'), 'utf-8');
    expect(source).toContain('piwi-locators');
    expect(source).toContain('piwi-network');
    expect(source).toContain('piwi-web-vitals');
    expect(source).toContain('piwi-console');
    expect(source).toContain('piwi-aria-snapshot');
  });

  it('step-analyzer.js should export step metrics functions', () => {
    expect(existsSync(dist('internal', 'collect', 'step-analyzer.js'))).toBe(true);
    const source = readFileSync(dist('internal', 'collect', 'step-analyzer.js'), 'utf-8');
    expect(source).toContain('collectStepMetrics');
    expect(source).toContain('computePerformanceSummary');
    expect(source).toContain('flattenSteps');
    expect(source).toContain('categorizeStep');
  });

  it('metadata-collector.js should have MetadataCollector class', () => {
    expect(existsSync(dist('internal', 'collect', 'metadata-collector.js'))).toBe(true);
    const source = readFileSync(dist('internal', 'collect', 'metadata-collector.js'), 'utf-8');
    expect(source).toContain('class MetadataCollector');
    expect(source).toContain('collectScmInfo');
    expect(source).toContain('collectCiInfo');
  });

  it('http-client.js should have HttpClient class with HTTP helpers', () => {
    expect(existsSync(dist('internal', 'transport', 'http-client.js'))).toBe(true);
    const source = readFileSync(dist('internal', 'transport', 'http-client.js'), 'utf-8');
    expect(source).toContain('class HttpClient');
    expect(source).toContain('postJSON');
    expect(source).toContain('postFormData');
    expect(source).toContain('login');
  });

  it('file-handler.js should export file discovery functions', () => {
    expect(existsSync(dist('internal', 'files', 'file-handler.js'))).toBe(true);
    const source = readFileSync(dist('internal', 'files', 'file-handler.js'), 'utf-8');
    expect(source).toContain('findHTMLReportDirectory');
    expect(source).toContain('findReportDirectory');
    expect(source).toContain('compressReportDirectory');
    expect(source).toContain('findTraceFiles');
    expect(source).toContain('getDefaultReportDirs');
    expect(source).toContain('monocart');
    expect(source).toContain('blob');
  });
});
