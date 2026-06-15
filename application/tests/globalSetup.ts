import PiwiDashboardReporter from '@phenx/piwi-dashboard-reporter';
const { createGlobalSetup } = PiwiDashboardReporter;

const _setup = createGlobalSetup({
  serverUrl: 'http://localhost:3000',
  projectName: 'Piwi Dashboard',
  projectDescription: 'The Piwi Dashboard project',
  verbose: true,
});

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

export default async function globalSetup(config: any) {
  await preCleanup();
  return _setup(config);
}
