import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Logger } from '../src/logger.js';

function captureConsole(): { stdout: string[]; stderr: string[]; restore: () => void } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: any[]) => {
    stdout.push(args.join(' '));
  };
  console.warn = (...args: any[]) => {
    stderr.push(args.join(' '));
  };
  console.error = (...args: any[]) => {
    stderr.push(args.join(' '));
  };
  return {
    stdout,
    stderr,
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

describe('Logger', () => {
  it('always prefixes with [Piwi Dashboard] ', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(false);
      log.info('hello');
      log.warn('careful');
      log.error('boom');
      assert.ok(cap.stdout.every((l) => l.startsWith('[Piwi Dashboard] ')));
      assert.ok(cap.stderr.every((l) => l.startsWith('[Piwi Dashboard] ')));
      assert.ok(cap.stdout.some((l) => l.includes('hello')));
      assert.ok(cap.stderr.some((l) => l.includes('careful')));
      assert.ok(cap.stderr.some((l) => l.includes('boom')));
    } finally {
      cap.restore();
    }
  });

  it('debug is silent when verbose=false', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(false);
      log.debug('hidden');
      assert.equal(cap.stdout.length, 0);
      assert.equal(cap.stderr.length, 0);
    } finally {
      cap.restore();
    }
  });

  it('debug writes to stdout when verbose=true', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(true);
      log.debug('shown');
      assert.equal(cap.stdout.length, 1);
      assert.ok(cap.stdout[0].includes('shown'));
      assert.equal(cap.stderr.length, 0);
    } finally {
      cap.restore();
    }
  });

  it('debugError writes to stderr only when verbose=true', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(false);
      log.debugError('hidden');
      assert.equal(cap.stderr.length, 0);

      const log2 = new Logger(true);
      log2.debugError('shown-err');
      assert.equal(cap.stderr.length, 1);
      assert.ok(cap.stderr[0].includes('shown-err'));
      assert.equal(cap.stdout.length, 0);
    } finally {
      cap.restore();
    }
  });

  it('info/warn/error always emit regardless of verbose', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(false);
      log.info('i');
      log.warn('w');
      log.error('e');
      assert.equal(cap.stdout.length, 1);
      assert.equal(cap.stderr.length, 2);
    } finally {
      cap.restore();
    }
  });
});
