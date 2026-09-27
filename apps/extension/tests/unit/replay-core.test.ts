import { describe, it, expect } from 'vitest';
import type { RecordedStep, StepAssertion } from '@piwitests/core/recording';
import { toStepsDocument } from '@piwitests/core/steps';
import {
  absoluteUrl,
  evaluateAssertion,
  replayVerdict,
  verdictText,
  type Observation,
} from '../../src/content/replay-core.js';
import { readStepsFile } from '../../src/content/steps-file.js';
import { createZip } from '../../src/shared/zip.js';

const ORIGIN = 'http://localhost:3000';

function seen(overrides: Partial<Observation> = {}): Observation {
  return {
    count: 1,
    text: '  Total:\n 40 ',
    value: null,
    name: 'Total',
    visible: true,
    enabled: true,
    url: `${ORIGIN}/cart`,
    ...overrides,
  };
}

function expecting(matcher: StepAssertion['matcher'], expected: string | null = null, negated = false): StepAssertion {
  return { matcher, expected, actual: null, negated, note: null };
}

describe('evaluateAssertion', () => {
  it('compares text whole, with whitespace collapsed, as Playwright does', () => {
    expect(evaluateAssertion(expecting('toHaveText', 'Total: 40'), seen(), ORIGIN)).toEqual({
      holds: true,
      found: '"Total: 40"',
    });
    expect(evaluateAssertion(expecting('toHaveText', 'Total: 42'), seen(), ORIGIN)).toEqual({
      holds: false,
      found: '"Total: 40"',
    });
    expect(evaluateAssertion(expecting('toHaveText', 'Total'), seen(), ORIGIN).holds).toBe(false);
  });

  it('checks values exactly, names like text, and states', () => {
    expect(evaluateAssertion(expecting('toHaveValue', 'SPRING10'), seen({ value: 'SPRING10' }), ORIGIN).holds).toBe(
      true,
    );
    expect(evaluateAssertion(expecting('toHaveValue', 'SPRING10'), seen({ value: 'spring10' }), ORIGIN).holds).toBe(
      false,
    );
    expect(evaluateAssertion(expecting('toHaveAccessibleName', 'Total'), seen(), ORIGIN).holds).toBe(true);
    expect(evaluateAssertion(expecting('toBeDisabled'), seen(), ORIGIN)).toEqual({ holds: false, found: 'enabled' });
    expect(evaluateAssertion(expecting('toBeVisible', null, true), seen(), ORIGIN).holds).toBe(false);
  });

  it('takes an element that is not there as hidden, and never as visible or as any text', () => {
    const gone = seen({ count: 0 });
    expect(evaluateAssertion(expecting('toBeVisible'), gone, ORIGIN)).toEqual({
      holds: false,
      found: 'not on the page',
    });
    expect(evaluateAssertion(expecting('toBeHidden'), gone, ORIGIN).holds).toBe(true);
    expect(evaluateAssertion(expecting('toHaveText', ''), gone, ORIGIN).holds).toBe(false);
    expect(evaluateAssertion(expecting('toHaveText', 'x'), seen({ count: 3 }), ORIGIN).found).toBe('3 elements');
  });

  it('compares a URL in full, a path joined to the replay origin', () => {
    expect(absoluteUrl('/thanks', ORIGIN)).toBe(`${ORIGIN}/thanks`);
    expect(evaluateAssertion(expecting('toHaveURL', '/thanks'), seen({ url: `${ORIGIN}/thanks` }), ORIGIN).holds).toBe(
      true,
    );
    expect(evaluateAssertion(expecting('toHaveURL', '/thanks'), seen(), ORIGIN)).toEqual({
      holds: false,
      found: `${ORIGIN}/cart`,
    });
  });
});

describe('replayVerdict', () => {
  const click: RecordedStep = {
    action: 'click',
    target: null,
    value: null,
    redacted: false,
    pageUrl: '/cart',
    timestamp: 0,
  };
  const check: RecordedStep = {
    ...click,
    action: 'assert',
    assertion: { matcher: 'toHaveText', expected: 'Total: 42', actual: 'Total: 40', negated: false, note: null },
  };

  it('is reproduced when an expected result does not hold, and says when it is the value reported', () => {
    const verdict = replayVerdict(
      [click, check],
      [
        { status: 'done', detail: null },
        { status: 'failed', detail: null, found: '"Total: 40"' },
      ],
      false,
    );
    expect(verdict).toEqual({ kind: 'reproduced', step: 1, found: '"Total: 40"', sameAsReported: true });
    expect(verdictText(verdict, [click, check]).detail).toBe(
      'Step 2: expected "Total: 42", found "Total: 40", as reported.',
    );
  });

  it('is not reproduced when every expected result holds, and completed with nothing expected', () => {
    const passed = [
      { status: 'done' as const, detail: null },
      { status: 'passed' as const, detail: null },
    ];
    expect(replayVerdict([click, check], passed, false)).toEqual({ kind: 'not-reproduced' });
    expect(replayVerdict([click], [passed[0]!], false)).toEqual({ kind: 'completed' });
  });

  it('is diverged when a step could not be done, whatever came after', () => {
    expect(replayVerdict([click, check], [{ status: 'diverged', detail: 'Nothing matches.' }], false)).toEqual({
      kind: 'diverged',
      step: 0,
      reason: 'Nothing matches.',
    });
  });

  it('is stopped when the replay was stopped before the end', () => {
    expect(replayVerdict([click, check], [{ status: 'done', detail: null }], true)).toEqual({
      kind: 'stopped',
      step: 1,
    });
  });
});

describe('readStepsFile', () => {
  const doc = toStepsDocument({
    steps: [
      {
        action: 'goto',
        target: null,
        value: 'https://staging.test/cart',
        redacted: false,
        pageUrl: 'https://staging.test/cart',
        timestamp: 0,
      },
    ],
    startedAt: 0,
    startUrl: 'https://staging.test/cart',
  });
  const json = new TextEncoder().encode(JSON.stringify(doc));

  it('reads a steps.json, and the one inside a bug report archive', async () => {
    expect(await readStepsFile('steps.json', json)).toEqual(doc);
    const zip = createZip([
      { name: 'bug-report.md', data: '# Bug' },
      { name: 'steps.json', data: JSON.stringify(doc) },
    ]);
    expect(await readStepsFile('bug.zip', zip)).toEqual(doc);
  });

  it('reads a deflated steps.json, as a zip tool writes it', async () => {
    const deflated = new Uint8Array(
      await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
    );
    const stored = createZip([{ name: 'steps.json', data: deflated }]);
    // Same archive, marked as deflated with the real size in the central directory.
    const view = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
    view.setUint16(8, 8, true);
    const central = stored.length - 22 - (46 + 'steps.json'.length);
    view.setUint16(central + 10, 8, true);
    view.setUint32(central + 24, json.length, true);
    expect(await readStepsFile('bug.zip', stored)).toEqual(doc);
  });

  it('says what is wrong with a file that holds no steps', async () => {
    await expect(readStepsFile('other.zip', createZip([{ name: 'a.txt', data: 'x' }]))).rejects.toThrow(
      /has no steps\.json/,
    );
    await expect(readStepsFile('notes.json', new TextEncoder().encode('{"a":1}'))).rejects.toThrow(
      /is not a steps file/,
    );
  });
});
