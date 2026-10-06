/**
 * The pages the suite opens: the projects list, every tab of a project (and
 * the Failures tab's three segments), and the test-run page's tabs. Each opens
 * the dataset's large project or its newest failing run.
 */

/** @param {{ projectId: number, runId: number }} manifest */
export function pageScenarios({ projectId, runId }) {
  const project = (tab) => `/projects/${projectId}${tab ? `?tab=${tab}` : ''}`;
  const run = (tab) => `/test-runs/${runId}${tab ? `?tab=${tab}` : ''}`;
  return [
    { id: 'projects', label: 'Projects list', path: '/projects' },
    { id: 'project-runs', label: 'Project › Runs', path: project() },
    { id: 'project-tests', label: 'Project › Tests', path: project('tests') },
    { id: 'project-failures', label: 'Project › Failures › Clusters', path: project('failures') },
    { id: 'project-flaky', label: 'Project › Failures › Flaky', path: project('flaky-tests') },
    { id: 'project-quarantine', label: 'Project › Failures › Quarantine', path: project('quarantine') },
    { id: 'project-flake-lab', label: 'Project › Flake Lab', path: project('flake-lab') },
    { id: 'project-gaps', label: 'Project › Gaps', path: project('gaps') },
    { id: 'project-performance', label: 'Project › Performance', path: project('performance') },
    { id: 'project-settings', label: 'Project › Settings', path: project('settings') },
    { id: 'run-tests', label: 'Test run › Tests', path: run() },
    { id: 'run-changes', label: 'Test run › Changes', path: run('changes') },
    { id: 'run-timeline', label: 'Test run › Timeline', path: run('workers') },
  ];
}

/**
 * API calls measured on their own besides the ones the pages make in the
 * browser: the ones a page makes while it renders on the server, which the
 * browser never sees.
 */
export function knownApiPaths({ projectId, runId }) {
  return [
    '/api/auth/me',
    '/api/capabilities',
    `/api/projects/${projectId}/capabilities`,
    '/api/projects',
    '/api/projects/menu',
    `/api/projects/${projectId}`,
    `/api/projects/${projectId}/markers`,
    `/api/test-runs/${runId}`,
  ];
}

/** Whether a request the browser made is an API read worth replaying on its own. */
export function isReplayableApi(method, url) {
  if (method !== 'GET') return false;
  const { pathname } = new URL(url, 'http://x');
  return pathname.startsWith('/api/') && !/\/(stream|events)$/.test(pathname);
}
