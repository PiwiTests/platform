import PiwiDashboardReporter from '@phenx/piwi-dashboard-reporter';
const { createGlobalSetup } = PiwiDashboardReporter;

async function cleanup() {
  try {
    const response = await fetch('http://localhost:3000/api/tests/cleanup', {
      method: 'DELETE',
    });
    if (!response.ok) {
      console.warn(`[Piwi Dashboard] Failed: ${response.status} ${await response.text()}`);
    } else {
      const result = await response.json();
      console.log(`[Piwi Dashboard] Removed ${result.projectsDeleted} test projects`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Piwi Dashboard] Error: ${message}`);
  }
}

export default createGlobalSetup(
  {
    serverUrl: 'http://localhost:3000',
    projectName: 'Piwi Dashboard',
    projectDescription: 'The Piwi Dashboard project',
    verbose: true,
  },
  cleanup,
);
