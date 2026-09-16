/**
 * Client-side Perfetto (Trace Event Format) export for demo mode.
 *
 * Collection and the trace builder are the shared implementation the server
 * uses; the demo only supplies its own base URL for the execution links.
 */
import { buildPerfettoTrace } from '#shared/perfetto/build';
import { collectExecutionPerfetto, collectRunPerfetto } from '#shared/handlers/perfetto';
import type { PerfettoRunInput } from '#shared/perfetto/types';
import { getDemoDb, getDemoDbBaseUrl } from '../db.client';

function respond(input: PerfettoRunInput | null, scope: 'run' | 'execution', fileName: string): Response {
  if (!input) {
    return new Response(JSON.stringify({ statusCode: 404, message: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const trace = buildPerfettoTrace(input, {
    scope,
    baseUrl: getDemoDbBaseUrl().replace(/\/+$/, ''),
    piwiVersion: 'demo',
  });

  return new Response(JSON.stringify(trace), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

export async function apiPerfettoTestRun(id: number): Promise<Response> {
  const input = await collectRunPerfetto(await getDemoDb(), id);
  return respond(input, 'run', `piwi-run-${id}-perfetto.json`);
}

export async function apiPerfettoTestRunCase(id: number): Promise<Response> {
  const input = await collectExecutionPerfetto(await getDemoDb(), id);
  return respond(input, 'execution', `piwi-execution-${id}-perfetto.json`);
}
