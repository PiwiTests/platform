/** All notification event keys supported by the subscription system. */
export const NOTIFICATION_EVENTS = [
  'run.finished',
  'run.failed',
  'run.failed.default_branch',
  'cluster.new',
  'flakiness.spike',
  'perf.regression',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface RunFinishedPayload {
  runId: number;
  projectId: number;
  projectName: string;
  status: string;
  totalTests: number;
  failedTests: number;
  passedTests: number;
  flakyTests: number;
  branch?: string;
  isDefaultBranch?: boolean;
  flakinessRate?: number; // 0-1
}

export interface ClusterNewPayload {
  clusterId: number;
  projectId: number;
  projectName: string;
  signature: string;
  runId: number;
}

export type NotificationPayload = RunFinishedPayload | ClusterNewPayload;

/** Subject / title line for each event type. */
export function renderEventSubject(event: NotificationEvent, payload: NotificationPayload): string {
  switch (event) {
    case 'run.finished':
    case 'run.failed':
    case 'run.failed.default_branch': {
      const p = payload as RunFinishedPayload;
      return `Test run ${p.status} — ${p.projectName}${p.branch ? ` (${p.branch})` : ''}`;
    }
    case 'cluster.new': {
      const p = payload as ClusterNewPayload;
      return `New failure cluster — ${p.projectName}`;
    }
    case 'flakiness.spike': {
      const p = payload as RunFinishedPayload;
      return `Flakiness spike — ${p.projectName}`;
    }
    case 'perf.regression': {
      const p = payload as RunFinishedPayload;
      return `Performance regression — ${p.projectName}`;
    }
  }
}
