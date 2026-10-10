/**
 * Type declarations for the web-dashboard Test Map model. See `demo-test-map.mjs`.
 */

type Row = Record<string, unknown>;

export declare const WEB_DASHBOARD_PROJECT_ID: number;

export declare function buildWebDashboardTestMap(input: {
  caseIds: Map<string, number>;
  runIds: number[];
  features: Map<string, string | null>;
  at: number;
}): { nodes: Row[]; edges: Row[]; probes: Row[]; gaps: Row[]; functions: Row[] };
export declare function webDashboardRequests(title: string): Row[];
export declare function webDashboardFinalPage(title: string): string | null;
/** The console lines a passing execution of a test logs, or null for a test that logs none. */
export declare function webDashboardPassingConsole(title: string): Row[] | null;
export declare function webDashboardStepTitles(title: string): Row[] | null;
/** The gap keys each detector should raise on the web-dashboard project, from the model's ground truth. */
export declare function expectedWebDashboardGaps(): Record<string, string[]>;
/** The web-dashboard tests the seed makes untrusted (flaky). */
export declare const WEB_DASHBOARD_UNTRUSTED_TESTS: string[];
