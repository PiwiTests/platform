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
}): { nodes: Row[]; edges: Row[]; probes: Row[]; gaps: Row[] };
export declare function webDashboardRequests(title: string): Row[];
export declare function webDashboardFinalPage(title: string): string | null;
export declare function webDashboardStepTitles(title: string): Row[] | null;
