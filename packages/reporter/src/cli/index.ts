#!/usr/bin/env node
/**
 * `piwi` — the reporter package's command-line entry point.
 *
 * The reporter's job is to get results into the dashboard during
 * `playwright test`; the CLI covers the things that happen around a run:
 * setting a project up in the first place (`init`, `skills`) and acting on the
 * dashboard's history once a run has landed (`gate`).
 */
import { runAi } from './ai.js';
import { runGate } from './gate.js';
import { runInit } from './init.js';
import { runSelect, runRun } from './select.js';
import { findTemplatesDir, runSkills } from './skills.js';

const USAGE = `
piwi — companion commands for the Piwi Dashboard reporter

Usage:
  npx @piwitests/reporter <command> [options]

Commands:
  init      Wire a Playwright project up to a Piwi Dashboard
  skills    Install the Piwi agent skills into this project
  gate      Fail a CI job on the dashboard's analysis of a run
  select    Print the Playwright args for a saved test selection
  run       Run a saved test selection with playwright test
  ai        Manage committed natural-language AI-step artifacts

Run \`npx @piwitests/reporter <command> --help\` for a command's options.
(The published package is @piwitests/reporter; its command is piwi. Invoke it
through the package name so npx resolves this package, not an unrelated "piwi".)
`.trim();

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'init':
      return runInit(rest);
    case 'skills':
      return runSkills(rest, findTemplatesDir(__dirname));
    case 'gate':
      return runGate(rest);
    case 'select':
      return runSelect(rest);
    case 'run':
      return runRun(rest);
    case 'ai':
      return runAi(rest);
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      console.error(`piwi: unknown command "${command}"\n`);
      console.error(USAGE);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(`piwi: ${(e as Error).message}`);
    process.exitCode = 2;
  });
