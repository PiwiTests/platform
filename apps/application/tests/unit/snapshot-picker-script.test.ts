import { describe, test, expect } from 'vitest';
import {
  deriveHighlightHints,
  stripBaseTag,
  snapshotPickerScriptTag,
  buildPickerDocument,
} from '../../app/utils/snapshot-picker-script';
import type { RankedLocator } from '#shared/locator-healing.types';

const ranked = (args: Record<string, unknown>): RankedLocator => ({
  locator: 'x',
  method: 'getByRole',
  args,
  score: 50,
});

describe('deriveHighlightHints', () => {
  test('takes the failing name first, then element-match, then ARIA candidates, deduped', () => {
    const hints = deriveHighlightHints({
      failingLocator: { method: 'getByRole', args: { role: 'button', name: 'Pay now' } },
      fromElementMatch: [ranked({ role: 'button', name: 'Pay now' }), ranked({ text: 'Checkout' })],
      fromAriaSnapshot: [ranked({ name: 'Submit' })],
    });
    expect(hints.map((h) => h.text)).toEqual(['Pay now', 'Checkout', 'Submit']);
  });

  test('reads text/label/placeholder/alt/title, skips too-short/too-long, caps at 6', () => {
    expect(deriveHighlightHints({ failingLocator: { method: 'getByText', args: { text: 'Open' } } })[0]!.text).toBe(
      'Open',
    );
    expect(deriveHighlightHints({ failingLocator: { method: 'getByLabel', args: { label: 'Email' } } })[0]!.text).toBe(
      'Email',
    );
    // 1-char and >80-char names are ignored
    expect(deriveHighlightHints({ failingLocator: { method: 'getByText', args: { text: 'x' } } })).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => ranked({ name: `Item ${i}` }));
    expect(deriveHighlightHints({ fromElementMatch: many })).toHaveLength(6);
  });

  test('returns nothing when there are no named candidates', () => {
    expect(deriveHighlightHints({ failingLocator: { method: 'locator', args: { selector: '.x' } } })).toEqual([]);
    expect(deriveHighlightHints({})).toEqual([]);
  });
});

describe('stripBaseTag', () => {
  test('removes <base> so relative subresources are not redirected', () => {
    expect(stripBaseTag('<head><base href="https://tested.app/"><title>x</title></head>')).toBe(
      '<head><title>x</title></head>',
    );
    expect(stripBaseTag('<BASE target="_blank">keep')).toBe('keep');
    expect(stripBaseTag('<p>no base here</p>')).toBe('<p>no base here</p>');
  });
});

describe('snapshotPickerScriptTag / buildPickerDocument', () => {
  test('produces a runnable script tag carrying the config', () => {
    const tag = snapshotPickerScriptTag({ probedAttrs: ['id', 'data-testid'] });
    expect(tag.startsWith('<script>')).toBe(true);
    expect(tag.endsWith('</script>')).toBe(true);
    // The probe is installed on a well-known global for the shared core
    // overlay (postMessage transport) to find, ahead of the overlay itself.
    expect(tag).toContain('globalThis.__piwiProbe');
    expect(tag).toContain('"transport":"postMessage"');
    expect(tag).toContain('["id","data-testid"]');
  });

  test('the serialized function body never closes the script tag early', () => {
    const tag = snapshotPickerScriptTag({ probedAttrs: [] });
    // Exactly one closing tag — the real one at the end.
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
  });

  test('wraps init so a startup failure is reported to the host instead of hanging', () => {
    const tag = snapshotPickerScriptTag({ probedAttrs: [] });
    // Init runs in a try/catch behind error listeners that post `piwiError` to
    // the host, so a throw during setup shows an error rather than an endless
    // "Initializing…" spinner.
    expect(tag).toContain("type:'piwiError'");
    expect(tag).toContain('try{');
    expect(tag).toContain('addEventListener');
    // The wrapping must not introduce a second closing tag.
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
  });

  test('the serialized picker swallows page interaction and re-arms the block after a pick', () => {
    const tag = snapshotPickerScriptTag({ probedAttrs: [] });
    // A representative slice of the events a dead snapshot must ignore so a
    // click never navigates a link, submits a form, or activates a control.
    for (const evt of ['submit', 'contextmenu', 'auxclick', 'dragstart', 'keypress', 'touchstart']) {
      expect(tag).toContain(evt);
    }
    // The iframe stays inert through the review step (a pick doesn't re-enable it).
    expect(tag).toContain('Analyzing element');
  });

  test('buildPickerDocument strips <base> and appends the script after the HTML', () => {
    const doc = buildPickerDocument('<body><base href="http://x/"><button>Go</button></body>', { probedAttrs: [] });
    expect(doc).not.toContain('<base');
    expect(doc.indexOf('<button>Go</button>')).toBeLessThan(doc.indexOf('<script>'));
  });
});
