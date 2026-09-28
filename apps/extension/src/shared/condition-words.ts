import { formatNumber, t } from './i18n.js';
import type { NetworkThrottle, RequestCondition } from './request-conditions.js';

/** A condition in words, as the banner, the Piwi panel and the replay list it. */
export function conditionText(condition: RequestCondition): string {
  const request = `${condition.method} ${condition.pattern}`;
  switch (condition.kind) {
    case 'delay':
      return t('devtools_conditionDelay', { request, seconds: formatNumber(condition.delayMs / 1000) });
    case 'error':
      return t('devtools_conditionError', { request });
    case 'abort':
      return t('devtools_conditionAbort', { request });
  }
}

/** A whole-page network condition in words: "The whole page on slow 3G", "The whole page offline". */
export function throttleText(throttle: NetworkThrottle): string {
  switch (throttle) {
    case 'fast-3g':
      return t('devtools_throttleFast3g');
    case 'slow-3g':
      return t('devtools_throttleSlow3g');
    case 'offline':
      return t('devtools_throttleOffline');
  }
}

/** The CPU slowed down, in words: "The CPU 4 times slower". */
export function cpuText(rate: number): string {
  return t('devtools_cpuSlower', { rate: formatNumber(rate) });
}

/** Everything on for a tab, in words: each request's condition, then the page's network and CPU. */
export function emulationLines(state: {
  conditions: readonly RequestCondition[];
  throttle?: NetworkThrottle | null;
  cpuRate?: number | null;
}): string[] {
  return [
    ...state.conditions.map(conditionText),
    ...(state.throttle ? [throttleText(state.throttle)] : []),
    ...(state.cpuRate ? [cpuText(state.cpuRate)] : []),
  ];
}
