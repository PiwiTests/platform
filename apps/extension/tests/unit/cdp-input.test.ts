import { describe, expect, it } from 'vitest';
import {
  actionPoint,
  boxInTopViewport,
  chooseDriver,
  clickEvents,
  dragPathEvents,
  fallbackReasonOf,
  keyDefinition,
  keyEvents,
  parseCombo,
  readInputOps,
} from '../../src/shared/cdp-input.js';

const params = (events: Array<{ params: Record<string, unknown> }>) => events.map((e) => e.params);

describe('the trusted-input driver', () => {
  describe('keys', () => {
    it('describes a key as a US keyboard sends it', () => {
      expect(keyDefinition('Enter')).toMatchObject({ key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
      expect(keyDefinition('a')).toMatchObject({ code: 'KeyA', keyCode: 65, text: 'a' });
      expect(keyDefinition('7')).toMatchObject({ code: 'Digit7', keyCode: 55, text: '7' });
      expect(keyDefinition('?')).toMatchObject({ code: 'Slash', keyCode: 191, text: '?' });
      expect(keyDefinition('Space')).toMatchObject({ key: ' ', code: 'Space', text: ' ' });
      expect(keyDefinition('F5')).toMatchObject({ code: 'F5', keyCode: 116 });
      expect(keyDefinition('é')).toMatchObject({ key: 'é', keyCode: 0, text: 'é' });
    });

    it('reads ControlOrMeta as Ctrl, or ⌘ on a Mac', () => {
      expect(parseCombo('ControlOrMeta+K', false)).toEqual({ modifiers: ['Control'], key: 'K' });
      expect(parseCombo('ControlOrMeta+K', true)).toEqual({ modifiers: ['Meta'], key: 'K' });
      expect(parseCombo('Shift+Tab', false)).toEqual({ modifiers: ['Shift'], key: 'Tab' });
      expect(parseCombo('+', false)).toEqual({ modifiers: [], key: '+' });
      expect(parseCombo('Control++', false)).toEqual({ modifiers: ['Control'], key: '+' });
    });

    it('presses a key down and up, typing its text', () => {
      expect(params(keyEvents('Enter', false))).toEqual([
        expect.objectContaining({ type: 'keyDown', key: 'Enter', text: '\r', modifiers: 0 }),
        expect.objectContaining({ type: 'keyUp', key: 'Enter', modifiers: 0 }),
      ]);
    });

    it('holds the modifiers around the key, and types nothing with Ctrl', () => {
      const events = params(keyEvents('ControlOrMeta+Shift+K', false));
      expect(events.map((e) => [e.type, e.key, e.modifiers])).toEqual([
        ['rawKeyDown', 'Control', 2],
        ['rawKeyDown', 'Shift', 10],
        ['rawKeyDown', 'K', 10],
        ['keyUp', 'K', 10],
        ['keyUp', 'Shift', 2],
        ['keyUp', 'Control', 0],
      ]);
      expect(events[2]).not.toHaveProperty('text');
    });

    it('types the shifted letter with Shift alone', () => {
      expect(params(keyEvents('Shift+a', false))[1]).toMatchObject({ type: 'keyDown', text: 'A' });
    });

    it('names the editing command a Mac runs for ⌘A', () => {
      expect(params(keyEvents('ControlOrMeta+a', true))[1]).toMatchObject({ commands: ['selectAll'], modifiers: 4 });
      expect(params(keyEvents('ControlOrMeta+a', false))[1]).not.toHaveProperty('commands');
    });
  });

  describe('the mouse', () => {
    it('moves, then presses and releases once for a click, twice for a double click', () => {
      expect(params(clickEvents({ x: 10, y: 20 }, 1)).map((e) => [e.type, e.clickCount ?? null])).toEqual([
        ['mouseMoved', null],
        ['mousePressed', 1],
        ['mouseReleased', 1],
      ]);
      expect(params(clickEvents({ x: 10, y: 20 }, 2)).map((e) => [e.type, e.clickCount ?? null])).toEqual([
        ['mouseMoved', null],
        ['mousePressed', 1],
        ['mouseReleased', 1],
        ['mousePressed', 2],
        ['mouseReleased', 2],
      ]);
    });

    it('carries a drag in steps from one point to the other, the button held', () => {
      const events = params(dragPathEvents({ x: 0, y: 0 }, { x: 100, y: 50 }, 4));
      expect(events[1]).toMatchObject({ type: 'mousePressed', x: 0, y: 0 });
      expect(events.slice(2).map((e) => [e.x, e.y, e.buttons])).toEqual([
        [25, 12.5, 1],
        [50, 25, 1],
        [75, 37.5, 1],
        [100, 50, 1],
      ]);
    });
  });

  describe('where to act', () => {
    it('adds the frames around an element to its box', () => {
      expect(
        boxInTopViewport({ left: 5, top: 6, width: 10, height: 10 }, [
          { x: 100, y: 200 },
          { x: 10, y: 20 },
        ]),
      ).toEqual({ left: 115, top: 226, width: 10, height: 10 });
    });

    it('aims at the center of the visible part of the box', () => {
      const viewport = { width: 800, height: 600 };
      expect(actionPoint({ left: 100, top: 100, width: 50, height: 20 }, viewport)).toEqual({ x: 125, y: 110 });
      expect(actionPoint({ left: -100, top: 500, width: 300, height: 400 }, viewport)).toEqual({ x: 100, y: 550 });
      expect(actionPoint({ left: 900, top: 100, width: 50, height: 20 }, viewport)).toBeNull();
    });
  });

  describe('the driver', () => {
    it('plays with trusted input when attached, and with the page’s events otherwise, saying why', () => {
      expect(chooseDriver({ available: true, attached: true, previous: null })).toEqual({
        driver: 'cdp',
        reason: null,
      });
      expect(chooseDriver({ available: false, attached: false, previous: null })).toEqual({
        driver: 'synthetic',
        reason: 'unavailable',
      });
      expect(chooseDriver({ available: true, attached: false, previous: null, attachError: 'refused' })).toEqual({
        driver: 'synthetic',
        reason: 'refused',
      });
    });

    it('stays on the page’s events once the replay fell back', () => {
      const previous = { driver: 'synthetic' as const, reason: 'canceled' as const };
      expect(chooseDriver({ available: true, attached: true, previous })).toEqual(previous);
    });

    it('tells a cancelled bar from a closed tab and a refused attach', () => {
      expect(fallbackReasonOf('canceled_by_user', null)).toBe('canceled');
      expect(fallbackReasonOf('target_closed', null)).toBe('lost');
      expect(fallbackReasonOf(null, 'Another debugger is already attached to the tab with id: 4.')).toBe('refused');
      expect(fallbackReasonOf(null, 'Cannot access a chrome:// URL')).toBe('refused');
      expect(fallbackReasonOf(null, 'No tab with given id 4.')).toBe('lost');
    });
  });

  describe('what a replay script may ask for', () => {
    it('keeps well-formed operations and refuses anything else', () => {
      expect(
        readInputOps([
          { op: 'click', x: 1, y: 2, count: 2 },
          { op: 'press', combo: 'Enter' },
          { op: 'drag', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
        ]),
      ).toEqual([
        { op: 'click', x: 1, y: 2, count: 2 },
        { op: 'press', combo: 'Enter' },
        { op: 'drag', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
      ]);
      expect(readInputOps([{ op: 'click', x: 'a', y: 2, count: 1 }])).toBeNull();
      expect(readInputOps([{ op: 'evaluate', expression: '1' }])).toBeNull();
      expect(readInputOps([])).toBeNull();
      expect(readInputOps('click')).toBeNull();
    });
  });
});
