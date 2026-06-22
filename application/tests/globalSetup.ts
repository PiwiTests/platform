async function preCleanup() {
  try {
    const response = await fetch('http://localhost:3000/api/tests/cleanup', {
      method: 'DELETE',
    });
    if (!response.ok) {
      console.warn(`[Setup Cleanup] Failed: ${response.status} ${await response.text()}`);
    } else {
      const result = await response.json();
      console.log(`[Setup Cleanup] Removed ${result.projectsDeleted} test projects`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Setup Cleanup] Error: ${message}`);
  }
}

// NOTE: Piwi run registration is handled by `wrapConfig()` in playwright.config.ts,
// which injects the reporter's own global-setup module. We must NOT call
// `createGlobalSetup()` here as well — doing so registered the run twice (same
// instanceId), and the second registration cancelled the first, leaving an
// orphaned "full"/cancelled run with no test cases alongside the real run.
export default async function globalSetup(_config: any) {
  await preCleanup();
}
