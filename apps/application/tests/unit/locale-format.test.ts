import { describe, test, expect } from 'vitest';
import { format as dateFnsFormat } from 'date-fns';
import {
  AUTO,
  BUILTIN_LOCALE,
  FOLLOW_SYSTEM,
  coerceLocale,
  coerceTimeZone,
  effectiveLocale,
  effectiveTimeZone,
  formatAbsolute,
  isValidLocale,
  isValidTimeZone,
  resolveInstanceLocale,
  resolveInstanceTimeZone,
} from '#shared/i18n/locale-format';

// A UTC instant so timezone-explicit assertions are deterministic regardless of
// the machine running the tests.
const UTC_INSTANT = new Date('2026-09-22T14:30:05Z');

describe('formatAbsolute', () => {
  test('returns N/A for empty or unparseable input', () => {
    expect(formatAbsolute(null, { locale: BUILTIN_LOCALE, timeZone: AUTO })).toBe('N/A');
    expect(formatAbsolute('', { locale: BUILTIN_LOCALE, timeZone: AUTO })).toBe('N/A');
    expect(formatAbsolute('not-a-date', { locale: BUILTIN_LOCALE, timeZone: AUTO })).toBe('N/A');
  });

  test('en-US renders American month/day and 12-hour time', () => {
    expect(formatAbsolute(UTC_INSTANT, { locale: 'en-US', timeZone: 'UTC' })).toBe('9/22/2026, 2:30:05 PM');
    expect(formatAbsolute(UTC_INSTANT, { locale: 'en-US', timeZone: 'UTC', dateOnly: true })).toBe('9/22/2026');
  });

  test('fr-FR renders day/month and 24-hour time', () => {
    expect(formatAbsolute(UTC_INSTANT, { locale: 'fr-FR', timeZone: 'UTC' })).toBe('22/09/2026 14:30:05');
    expect(formatAbsolute(UTC_INSTANT, { locale: 'fr-FR', timeZone: 'UTC', dateOnly: true })).toBe('22/09/2026');
  });

  test('a time zone shifts the displayed clock', () => {
    // 14:30 UTC is 16:30 in Paris (CEST, +02:00 in September).
    expect(formatAbsolute(UTC_INSTANT, { locale: 'fr-FR', timeZone: 'Europe/Paris' })).toBe('22/09/2026 16:30:05');
  });

  test('the en-US default matches the historical date-fns format byte for byte', () => {
    // The default prefs pass no time zone, so both format in local time.
    const local = new Date(2026, 8, 22, 14, 30, 5);
    expect(formatAbsolute(local, { locale: BUILTIN_LOCALE, timeZone: AUTO })).toBe(
      dateFnsFormat(local, 'M/d/yyyy, h:mm:ss a'),
    );
    expect(formatAbsolute(local, { locale: BUILTIN_LOCALE, timeZone: AUTO, dateOnly: true })).toBe(
      dateFnsFormat(local, 'M/d/yyyy'),
    );
  });

  test('accepts Unix seconds and milliseconds like the DB columns', () => {
    const seconds = Math.floor(UTC_INSTANT.getTime() / 1000);
    expect(formatAbsolute(seconds, { locale: 'fr-FR', timeZone: 'UTC' })).toBe('22/09/2026 14:30:05');
    expect(formatAbsolute(UTC_INSTANT.getTime(), { locale: 'fr-FR', timeZone: 'UTC' })).toBe('22/09/2026 14:30:05');
  });

  test('a malformed locale falls back instead of throwing', () => {
    const out = formatAbsolute(UTC_INSTANT, { locale: 'not a locale!!', timeZone: 'UTC' });
    expect(out).not.toBe('N/A');
    expect(out).toContain('2026');
  });
});

describe('validation', () => {
  test('isValidLocale', () => {
    expect(isValidLocale('fr-FR')).toBe(true);
    expect(isValidLocale('en-US')).toBe(true);
    expect(isValidLocale(AUTO)).toBe(true);
    expect(isValidLocale('nonsense!!')).toBe(false);
  });

  test('isValidTimeZone', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone(AUTO)).toBe(true);
    expect(isValidTimeZone('Nowhere/Nothing')).toBe(false);
  });
});

describe('coercion', () => {
  test('coerceLocale keeps valid tags and auto, drops the rest', () => {
    expect(coerceLocale('fr-FR')).toBe('fr-FR');
    expect(coerceLocale('  auto  ')).toBe(AUTO);
    expect(coerceLocale('')).toBeNull();
    expect(coerceLocale(null)).toBeNull();
    expect(coerceLocale('garbage!!')).toBeNull();
  });

  test('coerceTimeZone keeps valid zones and auto, drops the rest', () => {
    expect(coerceTimeZone('Europe/Paris')).toBe('Europe/Paris');
    expect(coerceTimeZone('auto')).toBe(AUTO);
    expect(coerceTimeZone('Nope/Nowhere')).toBeNull();
  });
});

describe('instance-default resolution', () => {
  test('env wins and locks', () => {
    expect(resolveInstanceLocale('fr-FR', 'de-DE')).toEqual({ locale: 'fr-FR', envManaged: true });
    expect(resolveInstanceTimeZone('Europe/Paris', 'UTC')).toEqual({ timeZone: 'Europe/Paris', envManaged: true });
  });

  test('stored app setting applies when env is unset', () => {
    expect(resolveInstanceLocale('', 'de-DE')).toEqual({ locale: 'de-DE', envManaged: false });
    expect(resolveInstanceTimeZone(null, 'UTC')).toEqual({ timeZone: 'UTC', envManaged: false });
  });

  test('built-in default when nothing is configured', () => {
    expect(resolveInstanceLocale('', '')).toEqual({ locale: BUILTIN_LOCALE, envManaged: false });
    expect(resolveInstanceTimeZone('', '')).toEqual({ timeZone: AUTO, envManaged: false });
  });

  test('an invalid env value is ignored, not locked', () => {
    expect(resolveInstanceLocale('garbage!!', 'de-DE')).toEqual({ locale: 'de-DE', envManaged: false });
  });
});

describe('per-viewer override', () => {
  test('system (or empty) follows the instance default', () => {
    expect(effectiveLocale(FOLLOW_SYSTEM, 'fr-FR')).toBe('fr-FR');
    expect(effectiveLocale('', 'fr-FR')).toBe('fr-FR');
    expect(effectiveTimeZone(FOLLOW_SYSTEM, 'Europe/Paris')).toBe('Europe/Paris');
  });

  test('a concrete override wins over the instance default', () => {
    expect(effectiveLocale('de-DE', 'fr-FR')).toBe('de-DE');
    expect(effectiveTimeZone('UTC', 'Europe/Paris')).toBe('UTC');
  });

  test('an invalid override falls back to the instance default', () => {
    expect(effectiveLocale('garbage!!', 'fr-FR')).toBe('fr-FR');
    expect(effectiveTimeZone('Nope/Nowhere', 'Europe/Paris')).toBe('Europe/Paris');
  });
});
