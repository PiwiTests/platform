import { getDatabase } from '../database';
import { interruptStaleRuns } from '../utils/stale-runs';

const CHECK_INTERVAL_MS = 30 * 1000; // check every 30 seconds

async function cleanupStaleRuns() {
  try {
    const db = await getDatabase();
    const reaped = await interruptStaleRuns(db);
    if (reaped.length > 0) {
      console.log(`[StaleRunCleanup] Marked ${reaped.length} stale run(s) as interrupted: ${reaped.join(', ')}`);
    }
  } catch (error) {
    console.error('[StaleRunCleanup] Error during stale run cleanup:', error);
  }
}

export default defineNitroPlugin((nitroApp) => {
  // Run once at startup to recover any runs left hanging from a previous crash
  cleanupStaleRuns();

  const interval = setInterval(cleanupStaleRuns, CHECK_INTERVAL_MS);

  nitroApp.hooks.hook('close', () => {
    clearInterval(interval);
  });
});
