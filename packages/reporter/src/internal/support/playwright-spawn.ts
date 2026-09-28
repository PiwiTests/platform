/**
 * How the command line starts `playwright test`: through the project's own
 * Playwright CLI with the current Node (no shell, no quoting), else through
 * `npx playwright`. Shared by `piwi probe` and `piwi flake`.
 */
import { spawn, type StdioOptions } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

/** The Playwright CLI the project in `cwd` resolves, or null. */
export function resolvePlaywrightCli(cwd: string = process.cwd()): string | null {
  const require = createRequire(path.join(cwd, 'noop.js'));
  for (const id of ['playwright/cli', '@playwright/test/cli', 'playwright/lib/cli/cli']) {
    try {
      return require.resolve(id);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export interface SpawnPlaywrightOptions {
  /** Where Playwright's output goes: the terminal, or appended to a file. */
  output?: 'inherit' | { file: string };
  /** The prefix of the message when Playwright cannot start (`piwi probe`). */
  command?: string;
}

/**
 * Run `playwright test` with these arguments and environment, and resolve with
 * its exit code (2 when it could not start).
 */
export function spawnPlaywright(
  playwrightArgs: string[],
  env: NodeJS.ProcessEnv,
  options: SpawnPlaywrightOptions = {},
): Promise<number> {
  const output = options.output ?? 'inherit';
  let fd: number | null = output === 'inherit' ? null : fs.openSync(output.file, 'a');
  const stdio: StdioOptions = fd === null ? 'inherit' : ['ignore', fd, fd];
  const cli = resolvePlaywrightCli();
  const child = cli
    ? spawn(process.execPath, [cli, 'test', ...playwrightArgs], { stdio, env })
    : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', ...playwrightArgs], {
        stdio,
        env,
      });
  return new Promise((resolve) => {
    const done = (code: number) => {
      if (fd !== null) fs.closeSync(fd);
      fd = null;
      resolve(code);
    };
    child.on('error', (err) => {
      console.error(`${options.command ?? 'piwi'}: could not start Playwright — ${err.message}`);
      done(2);
    });
    child.on('exit', (code) => done(code ?? 2));
  });
}
