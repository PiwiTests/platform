/**
 * What the server supplies to the shared dashboard handlers: who is asking,
 * and the translation of their refusals into API errors.
 */
import type { H3Event } from 'h3';
import type { User } from '../database/schema';
import { isAuthEnabled } from './auth';
import { apiError } from './api-error';
import { Role } from '#shared/types';
import { DashboardError, type DashboardActor } from '#shared/handlers/dashboards';

export function dashboardActor(event: H3Event, user: User): DashboardActor {
  const authEnabled = isAuthEnabled(event);
  return {
    id: authEnabled ? user.id : null,
    role: authEnabled ? (user.role as Role) : null,
    authEnabled,
  };
}

/** Run a dashboard handler, turning its refusals into API errors. */
export async function dashboardRoute<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DashboardError) throw apiError({ statusCode: error.statusCode, message: error.message });
    throw error;
  }
}
