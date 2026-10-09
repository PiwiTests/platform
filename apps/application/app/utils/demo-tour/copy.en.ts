import type { TourCopyShape } from './types';

/**
 * The guided tour in English, the source language: every other copy file has
 * exactly its keys, which the compiler checks. `{count}` is filled with
 * `fillTourText`; `{{current}}` and `{{total}}` are driver.js's own progress
 * placeholders. A dashboard label is `**bold**`, as the screen spells it.
 */
export const EN_COPY = {
  ui: {
    launch: 'Guided tour',
    promptTitle: 'Take a guided tour?',
    promptBody:
      'Pick what you do, and the tour walks you through the screens you would use most, on this demo’s sample data.',
    roles: 'Your role',
    stopCount: '{count} stops',
    later: 'Later',
    dismiss: 'Don’t show again',
    language: 'Language',
    next: 'Next',
    back: 'Back',
    done: 'Done',
    progress: '{{current}} of {{total}}',
    close: 'End the tour',
    docs: 'Read the docs',
    finishedTitle: 'That’s the tour',
    finishedBody: 'The other roles’ tours are under Guided tour, in the banner.',
  },
  profiles: {
    developer: {
      label: 'Developer',
      hint: 'Debug a failure and fix it',
      stops: {
        failure: {
          title: 'One failure, read top to bottom',
          body: 'Every failing execution opens on this block. The headline is the error, **Most likely** names the cause found in the evidence, and **Next** is the one step to take, often a change you can copy.',
        },
        evidence: {
          title: 'The evidence, kept after CI',
          body: 'The trace’s timeline, the screen at the moment it failed, the network calls and the console, stored with the run. The tab that opens first is the one the leading clue points to.',
        },
        locator: {
          title: 'The locator you should have used',
          body: 'When a locator stops matching, Piwi ranks replacements from what the element looked like in the last passing run. Copy the one you want, or check it against the page in the picker.',
        },
        diagnosis: {
          title: 'An AI diagnosis, checked against your code',
          body: 'With an AI key, a cluster is explained from its evidence and the commits since it last passed. This one traces the 50 rows to the API’s default page size and suggests a patch that applies.',
        },
        mcp: {
          title: 'Ask from your editor',
          body: 'Piwi is an MCP server: Claude Code, Cursor or Copilot can read failing clusters and their evidence, and propose a fix without leaving the editor. Pick your client to get its configuration.',
        },
        simulate: {
          title: 'Watch a run arrive',
          body: '**Simulate a test run** replays a reporter’s stream, so a new run arrives live and its failures join the clusters you just saw.',
        },
      },
    },
    qa: {
      label: 'QA engineer',
      hint: 'Flaky, slow and missing tests',
      stops: {
        inbox: {
          title: 'Failures, grouped by cause',
          body: 'Failing tests across every project, grouped by root cause: forty red tests become the few problems behind them. Triage a group once and every test in it follows.',
        },
        flaky: {
          title: 'Flaky tests, ranked by cost',
          body: 'Each flaky test is scored by how often it flips and the CI minutes its retries waste, with its likely cause. Quarantine one to keep it running without failing the build.',
        },
        suspects: {
          title: 'What makes it flaky',
          body: 'Piwi compares this test’s passing and failing executions and ranks what differs. Here a slower cart API comes first, and the Flake Lab reproduced the failure 3 times in 4.',
        },
        lab: {
          title: 'Prove a fix before releasing a test',
          body: 'The Flake Lab reruns a flaky test under each suspect condition, then under the fix. When the fix holds, it proposes releasing the test from quarantine.',
        },
        slow: {
          title: 'Slow tests and wasted time',
          body: 'The tests that cost the most CI time, and how their duration moved run after run: a test getting slower shows here before it starts timing out.',
        },
        gaps: {
          title: 'What your tests miss',
          body: 'The Test Map lays out the app’s pages and actions, and lists the scenarios no test covers yet, ranked so you know which test to write next.',
        },
      },
    },
    product: {
      label: 'Product owner',
      hint: 'Quality over time, and reports',
      stops: {
        health: {
          title: 'Every project at a glance',
          body: 'Each project’s latest pass rate and its trend over recent runs. A red row is a project failing right now; open it to see what broke.',
        },
        analytics: {
          title: 'Quality over time',
          body: 'Pass rate, flaky rate, time to fix and the CI time lost to failures, across projects and against the targets your team set.',
        },
        dashboards: {
          title: 'A dashboard per team',
          body: 'Save the widgets a team watches as its own dashboard, share it with a read-only link, or put it on a screen in TV mode.',
        },
        reports: {
          title: 'Reports that send themselves',
          body: 'Schedule a quality report, as PDF or Excel, in English or French, and Piwi emails it every week or month. Each one is kept here as a snapshot.',
        },
        issue: {
          title: 'Failures become tickets',
          body: 'Link a failure cluster to a Jira issue, or let Piwi open one when a failure crosses a threshold. The ticket’s status shows on the failure itself.',
        },
        personas: {
          title: 'See it as your team does',
          body: '**Acting as** switches between seeded people, a QA lead, a product owner, a stakeholder who can only read, to show what each role sees and can change.',
        },
      },
    },
    platform: {
      label: 'DevOps / platform',
      hint: 'CI speed and machine health',
      stops: {
        timeline: {
          title: 'Where the run’s time went',
          body: 'Each worker’s tests on one timeline, with the machine’s CPU and memory above them: idle workers, long setup hooks and a machine running short all show here.',
        },
        leaks: {
          title: 'Leaks between tests',
          body: 'Piwi counts the pages and contexts each test leaves open. Here a login fixture leaks a context per test, so every worker slows down as the run goes on.',
        },
        incident: {
          title: 'When staging is down, not the tests',
          body: 'Ten of eleven tests failed reaching staging, so Piwi flagged the run as an environment incident: one marker on the charts instead of ten failures in the stats.',
        },
        alerts: {
          title: 'Alerts where you work',
          body: 'Send a run’s verdict, a new failure cluster or an environment incident to Slack, email or a signed webhook, per project and per event.',
        },
        setup: {
          title: 'Connect your CI',
          body: 'The reporter configuration and CI snippets for this instance, and what each next step switches on: capture fixtures, a source-control token, an AI key.',
        },
        simulate: {
          title: 'Watch a run stream in',
          body: '**Simulate a test run** replays a reporter’s stream. Pick **Leaky run** to watch the resource tracks climb as the run arrives.',
        },
      },
    },
  },
} satisfies TourCopyShape;
