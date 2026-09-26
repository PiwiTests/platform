/**
 * Microsoft Teams messages: an Adaptive Card posted to an incoming webhook
 * (a Teams channel's Workflows "Post to a channel when a webhook request is
 * received", or a legacy connector URL, which take the same body). One card
 * per notification event, one per digest and one per quality report. Every
 * run-derived string is markdown-escaped, since card text renders markdown.
 */
import type {
  NotificationEvent,
  NotificationPayload,
  RunFinishedPayload,
  ClusterNewPayload,
} from '#shared/notification-events';
import { failureTargetPath, notificationTargetPath, renderEventSubject } from '#shared/notification-events';
import { sparkline } from '#shared/reports/chart';
import { sentencesFor } from '#shared/reports/sentences';
import { reportWidgets, type ReportBundle } from '#shared/reports/types';
import type { DigestItem } from '../email';
import { emailTrendBlock } from '#shared/reports/render-email';

/** Cards list at most this many items; the rest are counted. */
const MAX_ITEMS = 20;
const TEXT_MAX = 600;

type Element = Record<string, unknown>;

/** Markdown-escape run-derived text, so a test title cannot turn into a link or a heading. */
export function teamsEscape(text: string): string {
  return text.replace(/[\\`*_[\]()#<>~|]/g, (ch) => `\\${ch}`);
}

const clip = (text: string, max = TEXT_MAX) => (text.length > max ? `${text.slice(0, max)}…` : text);

function textBlock(text: string, extra: Element = {}): Element {
  return { type: 'TextBlock', text, wrap: true, ...extra };
}

/** The webhook body: one Adaptive Card as a message attachment. */
export function teamsMessage(body: Element[], actions: Array<{ title: string; url: string }> = []): Element {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body,
          ...(actions.length > 0
            ? { actions: actions.map((a) => ({ type: 'Action.OpenUrl', title: a.title, url: a.url })) }
            : {}),
        },
      },
    ],
  };
}

/** One notification event as a card: the subject, what it is about, a button to it. */
export function teamsEventMessage(event: NotificationEvent, payload: NotificationPayload, base: string): Element {
  const body: Element[] = [
    textBlock(teamsEscape(renderEventSubject(event, payload)), { weight: 'Bolder', size: 'Medium' }),
  ];
  if (event.startsWith('run.')) {
    const p = payload as RunFinishedPayload;
    for (const f of (p.topFailures ?? []).slice(0, 5)) {
      const lines = [`**${teamsEscape(f.title)}**`];
      if (f.headline) lines.push(teamsEscape(clip(f.headline)));
      body.push(textBlock(lines.join('\n\n'), { spacing: 'Small' }));
    }
  } else if (event === 'cluster.new') {
    const p = payload as ClusterNewPayload;
    if (p.title && p.title !== p.signature) body.push(textBlock(`**${teamsEscape(p.title)}**`));
    body.push(textBlock(teamsEscape(clip(p.signature)), { fontType: 'Monospace', spacing: 'Small' }));
    if (p.affectedCases) {
      body.push(textBlock(`${p.affectedCases} affected test${p.affectedCases === 1 ? '' : 's'}`, { isSubtle: true }));
    }
  }
  const path = notificationTargetPath(event, payload);
  const failurePath =
    event.startsWith('run.') && (payload as RunFinishedPayload).topFailures?.[0]
      ? failureTargetPath((payload as RunFinishedPayload).topFailures![0]!)
      : null;
  const target = path ?? failurePath;
  return teamsMessage(body, target ? [{ title: 'Open in Piwi', url: `${base}${target}` }] : []);
}

/** A digest as one card: a line per notification, linked where it has a page. */
export function teamsDigestMessage(items: DigestItem[], base: string): Element {
  const header = `Piwi digest: ${items.length} notification${items.length === 1 ? '' : 's'}`;
  const lines = items.slice(0, MAX_ITEMS).map(({ event, payload }) => {
    const line = teamsEscape(renderEventSubject(event, payload));
    const path = notificationTargetPath(event, payload);
    return path ? `- [${line}](${base}${path})` : `- ${line}`;
  });
  if (items.length > MAX_ITEMS) lines.push(`…and ${items.length - MAX_ITEMS} more`);
  return teamsMessage([textBlock(header, { weight: 'Bolder', size: 'Medium' }), textBlock(lines.join('\n'))]);
}

/**
 * A quality report as a card: the verdict, the tiles as facts, the trend
 * (an image through the share link when there is one, else a text
 * sparkline), what changed, and buttons to the snapshot and the share link.
 */
export function teamsReportMessage(bundle: ReportBundle, url: string, shareUrl: string | null = null): Element {
  const s = sentencesFor(bundle.language);
  const widgets = reportWidgets(bundle);
  const body: Element[] = [
    textBlock(teamsEscape(bundle.title), { weight: 'Bolder', size: 'Large' }),
    textBlock(teamsEscape(bundle.period.label), { isSubtle: true, spacing: 'None' }),
    textBlock(teamsEscape(bundle.verdict.sentence)),
  ];
  const tiles = widgets.flatMap((w) => w.blocks).find((b) => b.kind === 'stats');
  if (tiles && tiles.kind === 'stats' && tiles.tiles.length > 0) {
    body.push({
      type: 'FactSet',
      facts: tiles.tiles.slice(0, 10).map((t) => ({
        title: teamsEscape(t.label),
        value: teamsEscape(`${t.value}${t.change ? ` (${t.change})` : ''}`),
      })),
    });
  }
  const trend = emailTrendBlock(bundle);
  const line = trend?.series[0];
  if (trend && line) {
    body.push(textBlock(teamsEscape(trend.summary ?? line.label), { isSubtle: true }));
    if (shareUrl)
      body.push({ type: 'Image', url: `${shareUrl}/chart.png`, altText: clip(trend.summary ?? line.label) });
    else {
      const spark = sparkline(line.points);
      if (spark) body.push(textBlock(spark, { fontType: 'Monospace', spacing: 'None' }));
    }
  }
  const changes = widgets.find((w) => w.type === 'insights')?.blocks.find((b) => b.kind === 'list');
  if (changes && changes.kind === 'list' && changes.items.length > 0) {
    body.push(
      textBlock(
        changes.items
          .slice(0, 6)
          .map((i) => `- ${teamsEscape(i.text)}`)
          .join('\n'),
      ),
    );
  }
  const actions = [{ title: s.labels.openInPiwi, url }];
  if (shareUrl) actions.push({ title: s.labels.readWithoutAccount, url: shareUrl });
  return teamsMessage(body, actions);
}
