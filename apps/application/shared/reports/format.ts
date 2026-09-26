/**
 * How a metric value reads, in one place: the analytics widgets, every quality
 * report renderer and the MCP tools format through here, so a number reads the
 * same on the page, in the PDF and in the Markdown.
 */
import type { MetricUnit } from '#shared/analytics/metrics';
import type { AnalyticsMetricValue } from '#shared/analytics/types';
import { formatMoney } from '#shared/ci-cost';

export type ReportLanguage = 'en' | 'fr';

export const REPORT_LANGUAGES: readonly ReportLanguage[] = ['en', 'fr'];

export function isReportLanguage(value: unknown): value is ReportLanguage {
  return value === 'en' || value === 'fr';
}

const UNIT_WORDS: Record<ReportLanguage, { min: string; h: string; day: string; days: string; pts: string }> = {
  en: { min: 'min', h: 'h', day: 'day', days: 'days', pts: 'pts' },
  fr: { min: 'min', h: 'h', day: 'jour', days: 'jours', pts: 'pts' },
};

export interface ValueFormatter {
  language: ReportLanguage;
  locale: string;
  number(value: number, digits?: number): string;
  /** A value in its unit: `97.8%`, `11.2 h`, `3 days`, `$12.40`. */
  value(value: number | null, unit: MetricUnit, precision: number, currency?: string | null): string;
  /** A metric's change: `+2.1 pts` for a percentage, `+12%` otherwise, or null without one. */
  delta(metric: Pick<AnalyticsMetricValue, 'unit' | 'delta' | 'deltaPct' | 'precision'>): string | null;
  /** Minutes as a duration: `45 min`, `11.2 h`. */
  minutes(value: number): string;
  /** A date (`YYYY-MM-DD` or an instant) in the locale: `Sep 25, 2026`. */
  date(value: string | Date, timeZone?: string): string;
  /** A bucket day on a chart axis, without the year: `Sep 25`. */
  day(value: string): string;
}

export function makeFormatter(language: ReportLanguage, locale?: string): ValueFormatter {
  const loc = locale || (language === 'fr' ? 'fr-FR' : 'en-US');
  const words = UNIT_WORDS[language];
  // English takes the singular for one; French for anything under two (0,5 jour, 1,5 jour).
  const singular = (value: number) => (language === 'fr' ? Math.abs(value) < 2 : Math.abs(value) === 1);
  const number = (value: number, digits = 0) => {
    try {
      return new Intl.NumberFormat(loc, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
    } catch {
      return value.toFixed(digits);
    }
  };
  // French keeps a unit on the line of its number: a narrow no-break space before `%`, `min`, `jours`.
  const unitSpace = language === 'fr' ? '\u202f' : ' ';
  const percentSign = language === 'fr' ? `${unitSpace}%` : '%';
  const minutesText = (value: number) =>
    value < 60
      ? `${number(value, value < 10 ? 1 : 0)}${unitSpace}${words.min}`
      : `${number(value / 60, 1)}${unitSpace}${words.h}`;

  return {
    language,
    locale: loc,
    number,
    minutes: minutesText,
    value(value, unit, precision, currency) {
      if (value === null || !Number.isFinite(value)) return '—';
      switch (unit) {
        case 'percent':
          return `${number(value, precision)}${percentSign}`;
        case 'minutes':
          return minutesText(value);
        case 'ms':
          if (value < 1000) return `${number(value)}${unitSpace}ms`;
          if (value < 60_000) return `${number(value / 1000, 1)}${unitSpace}s`;
          return minutesText(value / 60_000);
        case 'days':
          return `${number(value, precision)}${unitSpace}${singular(value) ? words.day : words.days}`;
        case 'money':
          return currency ? formatMoney(value, currency, loc) : number(value, 2);
        default:
          return number(value, precision);
      }
    },
    delta(metric) {
      if (metric.delta === null) return null;
      const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±');
      if (metric.unit === 'percent') {
        return `${sign(metric.delta)}${number(Math.abs(metric.delta), 1)}${unitSpace}${words.pts}`;
      }
      if (metric.deltaPct !== null) return `${sign(metric.deltaPct)}${number(Math.abs(metric.deltaPct))}${percentSign}`;
      return `${sign(metric.delta)}${number(Math.abs(metric.delta), metric.precision)}`;
    },
    day(value) {
      try {
        return new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
          new Date(`${value.slice(0, 10)}T12:00:00Z`),
        );
      } catch {
        return value.slice(5, 10);
      }
    },
    date(value, timeZone) {
      const d =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T12:00:00Z`)
          : new Date(value);
      try {
        return new Intl.DateTimeFormat(loc, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone: timeZone || 'UTC',
        }).format(d);
      } catch {
        return d.toISOString().slice(0, 10);
      }
    },
  };
}
