/**
 * Type declarations for the demo's resource data. See `demo-resources.mjs`.
 */
import type { WireExecutionResources, WireResourceReport } from '@piwitests/core/wire';

export declare function demoExecutionResources(input: {
  seq: number;
  durationMs: number;
  openAtStart?: number;
  leaky?: boolean;
}): WireExecutionResources;

export declare function demoOpenPages(testsInWorker: number, leaky: boolean): number[];

export declare function demoResourceReport(input: {
  leaky?: boolean;
  handle?: boolean;
  wallMs: number;
  workers: Array<{ worker: number; tests: number }>;
  fixtureFile: string;
  handleTest: { title: string; file: string };
  artifactBytes: number;
  shardIndex?: number | null;
}): WireResourceReport;
