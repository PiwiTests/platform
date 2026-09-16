import { describe, it, expect } from 'vitest';
import { BoundedEventQueue } from '../src/internal/streaming/bounded-queue.js';
import type { StreamEvent } from '../src/types.js';

// Minimal event factories. `pad` inflates the JSON size so tests can pin the
// byte budget to a predictable multiple of an event's size.
function ev(type: StreamEvent['type'], title: string, padLen = 0): StreamEvent {
  return { type, title, pad: 'x'.repeat(padLen) } as unknown as StreamEvent;
}
function sizeOf(e: StreamEvent): number {
  return JSON.stringify(e).length;
}
function titles(events: StreamEvent[]): string[] {
  return events.map((e) => (e as unknown as { title: string }).title);
}

describe('BoundedEventQueue', () => {
  it('is unbounded when maxBytes <= 0', () => {
    const q = new BoundedEventQueue(0);
    for (let i = 0; i < 1000; i++) q.enqueue(ev('step-end', `s${i}`, 100));
    expect(q.length).toBe(1000);
    expect(q.droppedCount).toBe(0);
  });

  it('preserves FIFO order and empties on takeAll', () => {
    const q = new BoundedEventQueue(0);
    q.enqueue(ev('begin', 'a'));
    q.enqueue(ev('complete', 'b'));
    q.enqueue(ev('step-end', 'c'));
    expect(titles(q.takeAll())).toEqual(['a', 'b', 'c']);
    expect(q.isEmpty).toBe(true);
    expect(q.bytes).toBe(0);
  });

  it('sheds step events first, keeping begin and complete', () => {
    const complete = ev('complete', 'c1', 1000);
    const budget = sizeOf(complete) * 2 + 50; // room for ~2 completes
    const q = new BoundedEventQueue(budget);

    // Completes first so every later step immediately overflows and is evicted.
    q.enqueue(ev('complete', 'c1', 1000));
    q.enqueue(ev('complete', 'c2', 1000));
    for (let i = 0; i < 5; i++) q.enqueue(ev('step-end', `s${i}`, 1000));

    expect(titles(q.snapshot())).toEqual(['c1', 'c2']);
    expect(q.droppedCount).toBe(5);
    expect(q.droppedByType['step-end']).toBe(5);
    expect(q.lostResults).toBe(false);
  });

  it('sheds begin before complete when both remain', () => {
    const complete = ev('complete', 'c1', 1000);
    const budget = sizeOf(complete) + 50; // room for ~1 complete
    const q = new BoundedEventQueue(budget);

    q.enqueue(ev('complete', 'c1', 1000));
    q.enqueue(ev('begin', 'b1', 1000)); // overflow → begin (tier 1) goes first

    expect(titles(q.snapshot())).toEqual(['c1']);
    expect(q.droppedByType.begin).toBe(1);
    expect(q.droppedByType.complete ?? 0).toBe(0);
    expect(q.lostResults).toBe(false);
  });

  it('sheds results only as a last resort and flags the loss, keeping the newest', () => {
    const complete = ev('complete', 'c1', 1000);
    const budget = Math.floor(sizeOf(complete) / 2); // smaller than one complete
    const q = new BoundedEventQueue(budget);

    q.enqueue(ev('complete', 'c1', 1000));
    q.enqueue(ev('complete', 'c2', 1000));
    q.enqueue(ev('complete', 'c3', 1000));

    // Oldest results shed first; the most recent one is always kept.
    expect(titles(q.snapshot())).toEqual(['c3']);
    expect(q.droppedCount).toBe(2);
    expect(q.droppedByType.complete).toBe(2);
    expect(q.lostResults).toBe(true);
  });

  it('keeps a single event even when it alone exceeds the budget', () => {
    const q = new BoundedEventQueue(10);
    q.enqueue(ev('complete', 'huge', 5000));
    expect(q.length).toBe(1);
    expect(q.droppedCount).toBe(0);
    expect(q.bytes).toBeGreaterThan(10); // soft bound: one oversized event is tolerated
  });

  it('tracks peak bytes across the queue lifetime', () => {
    const q = new BoundedEventQueue(0);
    q.enqueue(ev('complete', 'a', 500));
    const peakAfterOne = q.peakBytes;
    q.enqueue(ev('complete', 'b', 500));
    const peakAfterTwo = q.peakBytes;
    q.takeAll();
    expect(peakAfterTwo).toBeGreaterThan(peakAfterOne);
    expect(q.peakBytes).toBe(peakAfterTwo); // takeAll does not reset the peak
  });

  it('enforces the budget across prepend as well as enqueue', () => {
    const step = ev('step-end', 's', 500);
    const budget = sizeOf(step) * 2 + 20;
    const q = new BoundedEventQueue(budget);
    q.enqueue(ev('complete', 'c1', 500));
    // Prepend more steps than fit; they are oldest, but tier order sheds steps.
    q.prepend([ev('step-end', 's1', 500), ev('step-end', 's2', 500), ev('step-end', 's3', 500)]);
    expect(q.bytes).toBeLessThanOrEqual(budget);
    expect(titles(q.snapshot())).toContain('c1');
    expect(q.droppedByType['step-end']).toBeGreaterThan(0);
  });
});
