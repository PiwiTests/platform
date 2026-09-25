import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { chartMarksSvg } from '../../shared/reports/chart';
import { chartPng } from '../../server/utils/reports/chart-png';
import { EMAIL_CHART, emailTrendBlock, renderReportEmail } from '../../shared/reports/render-email';
import { renderQualityReportEmail } from '../../server/utils/email';
import { reportSlackMessage, reportWebhookBody } from '../../server/utils/reports/deliver';
import { fixtureBundle, HOSTILE } from './report-fixture';

describe('the email chart', () => {
  it('draws marks only: the production image has no fonts, so the SVG holds no text', () => {
    const trend = emailTrendBlock(fixtureBundle());
    expect(trend).not.toBeNull();
    const svg = chartMarksSvg(trend!, EMAIL_CHART.width, EMAIL_CHART.height);
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).toMatch(/<(path|circle)[\s>]/);
  });

  it('rasterizes to a small PNG at twice the CSS size', async () => {
    const png = await chartPng(emailTrendBlock(fixtureBundle())!);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(992);
    expect(png.length).toBeLessThan(100_000);
    const email = await sharp(
      await chartPng(emailTrendBlock(fixtureBundle())!, EMAIL_CHART.width, EMAIL_CHART.height),
    ).metadata();
    expect(email.width).toBe(EMAIL_CHART.width * 2);
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

describe('the email chart labels', () => {
  const email = () =>
    renderQualityReportEmail(fixtureBundle(), { url: 'https://piwi.example/reports/7', chartCid: 'trend' }).html;

  it('prints each axis value beside the image, on its gridline, in rows as tall as the image', () => {
    const html = email();
    const axis = html.match(new RegExp(`<table width="${EMAIL_CHART.axis}"[^>]*>(.*?)</table>`))?.[1] ?? '';
    const cells = [...axis.matchAll(/<td height="(\d+)"[^>]*>(.*?)<\/td>/g)].map((m) => [Number(m[1]), m[2]] as const);
    // 100% at the top edge, 50% centered on the middle gridline, 0% at the bottom edge.
    expect(cells).toEqual([
      [12, '100%'],
      [52, '&nbsp;'],
      [12, '50%'],
      [52, '&nbsp;'],
      [12, '0%'],
    ]);
    expect(cells.reduce((sum, [h]) => sum + h, 0)).toBe(EMAIL_CHART.height);
  });

  it('names the days and the markers as the report does, never as ISO dates', () => {
    const html = email();
    for (const day of ['Sep 23', 'Sep 24', 'Sep 25']) expect(html).toContain(`>${day}</td>`);
    expect(html).toContain('Sep 24: ');
    expect(html).not.toContain('2026-09-24:');
    expect(html).not.toContain('>2026-09-23<');
  });

  it('shows the chart from any address: a data address in the schedule preview', () => {
    const { html } = renderReportEmail(fixtureBundle(), {
      url: 'https://piwi.example/reports',
      chartSrc: 'data:image/svg+xml;base64,PHN2Zz4=',
      siteUrl: 'https://piwi.example',
    });
    expect(html).toContain('src="data:image/svg+xml;base64,PHN2Zz4="');
    expect(html).toContain('This is an automated message from <a href="https://piwi.example"');
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
