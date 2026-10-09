/**
 * The demo examples: concrete screens of the live demo that a docs page links
 * to. A feature page renders its own with `<DemoExamples />`, under its
 * `## Try it in the demo` heading.
 *
 * Plain ESM so the seed generator's world (plain Node), the tests and the docs
 * site (through the `#shared` alias) read the same file. Each entry's
 * `expect` says what the generated seed must hold for its route to show what
 * `shows` promises; `tests/unit/demo-seed-consistency.test.ts` checks every one
 * against the seed, so a seed change that moves an id fails there, naming the
 * example. The vocabulary is closed:
 *
 * - `testCase: { id, title }`, `project: { id, name }`, `cluster: { id, story }`,
 *   `run: { id, project }`: the entity the route opens (its id is the one in the
 *   route), by id and by what identifies it in the seed (a test title, a
 *   project name, a failure story key, the run's project name).
 * - `diagnosis: 'with-patch' | 'none'`: the cluster has a completed stored AI
 *   diagnosis with a suggested patch, or no stored diagnosis at all.
 * - `fixLanded: true`: the cluster's fix has landed.
 * - `lab`: the test's Flake Lab state (`#shared/flake-lab`'s `FlakeLabTestState`).
 * - `resources: 'leaky'`: the run's resource report names at least one leak.
 * - `incident: true`: the run is flagged as an environment incident.
 */

/** @type {readonly import('./demo-examples.d.mts').DemoExample[]} */
export const DEMO_EXAMPLES = [
  {
    id: 'environment-incident-run',
    doc: 'features/environment-incidents',
    title: 'E2E Checkout › a run against staging while it was down',
    shows:
      'Ten of eleven tests failed navigating to staging, so the run is an environment incident: not counted, with one incident marker.',
    route: '/test-runs/14',
    expect: { run: { id: 14, project: 'e2e-checkout' }, incident: true },
  },
  {
    id: 'ai-diagnosis-stored',
    doc: 'features/ai-diagnosis',
    title: 'Web Dashboard › Users table paginates 25 rows per page',
    shows:
      'A stored diagnosis traces the 50 user rows (51 with the header) to the API’s default page size and suggests a patch; the fix has since landed.',
    route: '/failure-clusters/10',
    expect: { cluster: { id: 10, story: 'users-table-page-size' }, diagnosis: 'with-patch', fixLanded: true },
  },
  {
    id: 'ai-diagnosis-simulated',
    doc: 'features/ai-diagnosis',
    title: 'E2E Checkout › should complete checkout with Apple Pay',
    shows:
      'No stored diagnosis: the Diagnose with AI button streams a simulated one, built from the cluster’s own data.',
    route: '/failure-clusters/2',
    expect: { cluster: { id: 2, story: 'checkout-email-renamed' }, diagnosis: 'none' },
  },
  {
    id: 'flake-lab-reproduced',
    doc: 'features/flake-lab',
    title: 'E2E Checkout › should apply discount code',
    shows: 'A cart delay reproduced it 3 times in 4 against a clean control.',
    route: '/test-cases/9?tab=flakiness',
    expect: { testCase: { id: 9, title: 'should apply discount code' }, lab: 'reproduced' },
  },
  {
    id: 'flake-lab-verified-fix',
    doc: 'features/flake-lab',
    title: 'UI Components › Table pagination works correctly',
    shows:
      'One suspect reproduced it and one did not, a first fix still failed and the second is verified, so its quarantine is proposed for release.',
    route: '/test-cases/35?tab=flakiness',
    expect: { testCase: { id: 35, title: 'Table pagination works correctly' }, lab: 'verified' },
  },
  {
    id: 'flake-lab-tab',
    doc: 'features/flake-lab',
    title: 'UI Components › Flake Lab tab',
    shows: 'Where each flaky test of the project stands in the lab, and the command it needs next.',
    route: '/projects/3?tab=flake-lab',
    expect: { project: { id: 3, name: 'ui-components' } },
  },
  {
    id: 'resources-leaky-run',
    doc: 'features/resource-leaks',
    title: 'Web Dashboard › the newest run’s Resources tab',
    shows:
      'A login fixture leaves a context open per test: each worker’s open pages climb test after test, and the machine runs short of CPU.',
    route: '/test-runs/62?tab=resources',
    expect: { run: { id: 62, project: 'web-dashboard' }, resources: 'leaky' },
  },
  {
    id: 'resources-leaky-timeline',
    doc: 'features/cpu-memory-disk',
    title: 'Web Dashboard › the newest run’s Timeline tab',
    shows:
      'Above the worker rows, the machine’s CPU and the run’s memory climb with the pages its login fixture leaves open; hover them for the values at each moment.',
    route: '/test-runs/62?tab=workers',
    expect: { run: { id: 62, project: 'web-dashboard' }, resources: 'leaky' },
  },
];

/** The examples a docs page renders, in registry order. */
export function demoExamplesFor(doc) {
  return DEMO_EXAMPLES.filter((example) => example.doc === doc);
}
