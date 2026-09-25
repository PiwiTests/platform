import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { chartMarksSvg, chartPng } from '../../server/utils/reports/chart-png';
import { emailTrendBlock, renderQualityReportEmail } from '../../server/utils/email';
import { reportSlackMessage, reportWebhookBody } from '../../server/utils/reports/deliver';
import { fixtureBundle, HOSTILE } from './report-fixture';

describe('the email chart', () => {
  it('draws marks only: the production image has no fonts, so the SVG holds no text', () => {
    const trend = emailTrendBlock(fixtureBundle());
    expect(trend).not.toBeNull();
    const svg = chartMarksSvg(trend!);
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).toMatch(/<(path|circle)[\s>]/);
  });

  it('rasterizes to a small PNG at twice the CSS size', async () => {
    const png = await chartPng(emailTrendBlock(fixtureBundle())!);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(992);
    expect(png.length).toBeLessThan(100_000);
  });
});

describe('the quality report email', () => {
  it('shows the chart by content id, its labels as text, and escapes run-derived text', () => {
    const bundle = fixtureBundle();
    const { subject, html, text } = renderQualityReportEmail(bundle, {
      url: 'https://piwi.example/reports/7',
      chartCid: 'trend',
    });
    expect(subject).toBe(`Quality report: ${bundle.title}`);
    expect(html).toContain('src="cid:trend"');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('https://piwi.example/reports/7');
    expect(text).toContain(bundle.verdict.sentence);
    expect(new TextEncoder().encode(html).length).toBeLessThan(102_000);
  });
});

describe('the Slack and webhook bodies', () => {
  it('Slack: the verdict, the tiles as fields, a sparkline and a button to the snapshot', () => {
    const message = reportSlackMessage(fixtureBundle(), 'https://piwi.example/reports/7') as any;
    const types = message.blocks.map((b: any) => b.type);
    expect(types[0]).toBe('header');
    expect(types).toContain('actions');
    const fields = message.blocks.find((b: any) => b.fields)?.fields ?? [];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(message)).toMatch(/[▁▂▃▄▅▆▇█]/);
    expect(JSON.stringify(message)).not.toContain('<script>');
  });

  it('webhook: the event, the payload with the snapshot link, and the whole bundle', () => {
    const body = JSON.parse(
      reportWebhookBody(fixtureBundle(), { snapshotId: 7, scheduleId: 3, periodEnd: '2026-09-20' }),
    );
    expect(body.event).toBe('report.ready');
    expect(body.payload.url).toMatch(/\/reports\/7$/);
    expect(body.bundle.title).toBe(fixtureBundle().title);
    expect(JSON.stringify(body)).toContain(HOSTILE.slice(0, 4));
  });
});

describe('a scheduled report with a share link', () => {
  const share = 'https://piwi.example/share/psl_' + 'a'.repeat(64);

  it('email: a second link opens the report without an account', () => {
    const { html, text } = renderQualityReportEmail(fixtureBundle(), {
      url: 'https://piwi.example/reports/7',
      chartCid: 'trend',
      shareUrl: share,
    });
    expect(html).toContain(share);
    expect(html).toContain('Read without an account');
    expect(text).toContain(`Read without an account: ${share}`);
  });

  it("Slack: the trend is an image block over the link's chart.png, with a button to the link", () => {
    const message = reportSlackMessage(fixtureBundle(), 'https://piwi.example/reports/7', share) as any;
    const image = message.blocks.find((b: any) => b.type === 'image');
    expect(image.image_url).toBe(`${share}/chart.png`);
    const buttons = message.blocks.find((b: any) => b.type === 'actions').elements;
    expect(buttons.map((b: any) => b.url)).toEqual(['https://piwi.example/reports/7', share]);
    expect(JSON.stringify(message)).not.toMatch(/[▁▂▃▄▅▆▇█]/);
  });

  it('webhook: carries the share link, never the sealed token', () => {
    const body = JSON.parse(
      reportWebhookBody(
        fixtureBundle(),
        { snapshotId: 7, scheduleId: 3, periodEnd: '2026-09-20', shareToken: 'sealed-secret' },
        share,
      ),
    );
    expect(body.payload.shareUrl).toBe(share);
    expect(JSON.stringify(body)).not.toContain('sealed-secret');
  });
});
