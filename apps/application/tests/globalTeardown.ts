import { resolveE2ETarget, targetAuthHeaders } from './desktop-target';

export default async function globalTeardown() {
  const target = resolveE2ETarget();
  try {
    const response = await fetch(`${target.baseUrl}/api/tests/cleanup`, {
      method: 'DELETE',
      headers: targetAuthHeaders(target),
    });
    if (!response.ok) {
      console.warn(`[Cleanup] Failed: ${response.status} ${await response.text()}`);
    } else {
      const result = await response.json();
      console.log(`[Cleanup] Removed ${result.projectsDeleted} test projects`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Cleanup] Error: ${message}`);
  }
}
