export default async function globalTeardown() {
  try {
    const response = await fetch('http://localhost:3000/api/tests/cleanup', {
      method: 'DELETE',
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
