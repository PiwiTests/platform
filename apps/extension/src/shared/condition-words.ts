import { formatNumber, t } from './i18n.js';
import type { RequestCondition } from './request-conditions.js';

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
