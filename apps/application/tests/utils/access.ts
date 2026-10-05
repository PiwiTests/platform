/**
 * Accounts for the auth-enabled specs: a member holding one project role,
 * created through the access-management API in one call.
 */
import type { APIRequestContext } from '@playwright/test';
import { InstanceRole, type ProjectRole } from '#shared/permissions';
import type { UserProjectRoles } from '#shared/project-access';

/**
 * How the helpers call the server as an administrator: a Playwright request
 * context signed in as one (alone, its paths resolve against the config's
 * `baseURL`; with `baseUrl`, against that origin), or a server origin and the
 * session cookie (`name=value`) to send with `fetch`.
 */
export type AdminSession =
  | APIRequestContext
  | { request: APIRequestContext; baseUrl: string }
  | { baseUrl: string; cookie: string };

export interface CreateMemberOptions {
  username: string;
  password: string;
  /** The project role to grant; null leaves the member with no access at all. */
  role: ProjectRole | null;
  /** The project the role is held on; null or omitted for all projects, current and future. */
  projectId?: number | null;
  name?: string;
  email?: string;
  /** Also create an API key for the member, with this name. */
  apiKeyName?: string;
}

export interface CreatedMember {
  id: number;
  /** The plaintext API key, when `apiKeyName` was given. */
  apiKey?: string;
}

async function send(
  admin: AdminSession,
  method: string,
  path: string,
  data?: unknown,
): Promise<{ status: number; body: any }> {
  let status: number;
  let text: string;
  if ('cookie' in admin) {
    const res = await fetch(`${admin.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    status = res.status;
    text = await res.text();
  } else {
    const [request, baseUrl] = 'request' in admin ? [admin.request, admin.baseUrl] : [admin, ''];
    const res = await request.fetch(`${baseUrl}${path}`, { method, ...(data !== undefined ? { data } : {}) });
    status = res.status();
    text = await res.text();
  }
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: keep the text for the error message
  }
  return { status, body };
}

const ok = (res: { status: number }) => res.status >= 200 && res.status < 300;

function refused(what: string, res: { status: number; body: unknown }): Error {
  return new Error(`${what} failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
}

/**
 * Create a member (instance role `member`) whose only role binding is `role`
 * on `projectId`, or on all projects. An account already holding the username
 * (a database kept from an earlier run) is reused, password unchanged, and its
 * own bindings are replaced, so the access is the same either way.
 */
export async function createMember(admin: AdminSession, options: CreateMemberOptions): Promise<CreatedMember> {
  const { username, password, name, email, role, projectId = null, apiKeyName } = options;

  const created = await send(admin, 'POST', '/api/users', {
    username,
    password,
    role: InstanceRole.MEMBER,
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
  });
  let id: number;
  if (ok(created)) {
    id = created.body.user.id;
  } else if (created.status === 409) {
    const list = await send(admin, 'GET', '/api/users');
    const existing = (list.body?.items ?? []).find((u: { username: string }) => u.username === username);
    if (!existing) throw refused(`Looking up the existing user ${username}`, list);
    id = existing.id;
  } else {
    throw refused(`Creating the user ${username}`, created);
  }

  const roles: UserProjectRoles = {
    allProjects: role && projectId === null ? role : null,
    projects: role && projectId !== null ? [{ projectId, role }] : [],
  };
  const bound = await send(admin, 'PUT', `/api/users/${id}/projects`, roles);
  if (!ok(bound)) throw refused(`Setting the project roles of ${username}`, bound);

  if (!apiKeyName) return { id };
  const key = await send(admin, 'POST', `/api/users/${id}/api-keys`, { name: apiKeyName });
  if (!ok(key)) throw refused(`Creating an API key for ${username}`, key);
  return { id, apiKey: key.body.key };
}
