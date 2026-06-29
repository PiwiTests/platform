import { describe, it, expect } from 'vitest';
import { Logger } from '../src/internal/support/logger.js';

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
      expect(cap.stdout.every((l) => l.startsWith('[Piwi Dashboard] '))).toBeTruthy();
      expect(cap.stderr.every((l) => l.startsWith('[Piwi Dashboard] '))).toBeTruthy();
      expect(cap.stdout.some((l) => l.includes('hello'))).toBeTruthy();
      expect(cap.stderr.some((l) => l.includes('careful'))).toBeTruthy();
      expect(cap.stderr.some((l) => l.includes('boom'))).toBeTruthy();
    } finally {
      cap.restore();
    }
  });

  it('debug is silent when verbose=false', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(false);
      log.debug('hidden');
      expect(cap.stdout.length).toBe(0);
      expect(cap.stderr.length).toBe(0);
    } finally {
      cap.restore();
    }
  });

  it('debug writes to stdout when verbose=true', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(true);
      log.debug('shown');
      expect(cap.stdout.length).toBe(1);
      expect(cap.stdout[0].includes('shown')).toBeTruthy();
      expect(cap.stderr.length).toBe(0);
    } finally {
      cap.restore();
    }
  });

  it('debugError writes to stderr only when verbose=true', () => {
    const cap = captureConsole();
    try {
      const log = new Logger(false);
      log.debugError('hidden');
      expect(cap.stderr.length).toBe(0);

      const log2 = new Logger(true);
      log2.debugError('shown-err');
      expect(cap.stderr.length).toBe(1);
      expect(cap.stderr[0].includes('shown-err')).toBeTruthy();
      expect(cap.stdout.length).toBe(0);
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
      expect(cap.stdout.length).toBe(1);
      expect(cap.stderr.length).toBe(2);
    } finally {
      cap.restore();
    }
  });
});
