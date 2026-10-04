import { resolveE2ETarget, targetAuthHeaders } from './desktop-target';

async function preCleanup() {
  const target = resolveE2ETarget();
  try {
    const response = await fetch(`${target.baseUrl}/api/tests/cleanup`, {
      method: 'DELETE',
      headers: targetAuthHeaders(target),
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
// which injects the reporter's own global-setup module. Do NOT call
// `createGlobalSetup()` here as well: it would register the run a second time
// (same instanceId), cancelling the first.
export default async function globalSetup(_config: any) {
  await preCleanup();
}
