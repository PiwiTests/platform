import { test, expect } from '@playwright/test';
import { dryRun, LAB, prepareExtension, record, replay, saveResult, stepsOf } from './harness.js';
import { SCENARIOS } from './scenarios.js';

/**
 * One test per scenario: record it with the extension, replay the recording
 * with the extension, and write the spec Playwright runs next (`specs.config.ts`).
 * A replay passes when it plays every step and ends on the page the recording
 * ended on. `LAB_DRY=1` only drives each scenario in a plain browser.
 */

test.beforeAll(() => {
  if (!LAB.dry) prepareExtension();
});

for (const scenario of SCENARIOS) {
  test(scenario.name, async ({}, testInfo) => {
    test.setTimeout(6 * 60_000);
    if (LAB.dry) {
      testInfo.annotations.push({ type: 'ended on', description: await dryRun(scenario) });
      return;
    }

    const recording = await record(scenario);
    const { doc, lines } = stepsOf(scenario, recording);
    const replayed = await replay(scenario, doc);
    saveResult(scenario.name, {
      name: scenario.name,
      knownGap: scenario.knownGap ?? null,
      steps: lines,
      recordedEndUrl: recording.endUrl,
      replay: replayed,
    });
    testInfo.annotations.push({ type: 'steps', description: lines.join('\n') });
    await testInfo.attach('steps.json', { body: JSON.stringify(doc, null, 2), contentType: 'application/json' });

    if (scenario.knownGap) {
      testInfo.annotations.push({ type: 'known gap', description: scenario.knownGap });
      return;
    }
    if (scenario.hovers != null) {
      const hovers = doc.steps.filter((s) => s.action === 'hover').length;
      expect(hovers, `the recording holds the hovers its clicks depend on:\n${lines.join('\n')}`).toBe(scenario.hovers);
    }
    expect(replayed.reason, `the replay played every step`).toBeNull();
    expect(replayed.status).toBe('done');
    expect(replayed.endUrl, 'the replay ends on the page the recording ended on').toBe(recording.endUrl);
  });
}
