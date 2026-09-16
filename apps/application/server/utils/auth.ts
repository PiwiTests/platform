import type { H3Event } from 'h3';
import { apiError } from './api-error';
import { useSession, updateSession, clearSession as h3ClearSession } from 'h3';
import { getDatabase } from '../database';
import { users, apiKeys, appSettings } from '../database/schema';
import { eq, sql } from 'drizzle-orm';
import type { User } from '../database/schema';
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { Role } from '#shared/types';
import type { DrizzleDB } from '#shared/handlers/db';
import { getRouteRequiredRoles } from './route-required-roles';

const scryptAsync = promisify(scrypt);

// Password hashing using scrypt
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, storedHash] = hash.split(':');
  if (!salt || !storedHash) {
    return false;
  }
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedHashBuffer = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(derivedKey, storedHashBuffer);
}

// Session management using encrypted cookies
export interface SessionData {
  userId: number;
  username: string;
  role: Role;
  // The user's session epoch at sign-in. A later bump (password/role change,
  // unlink) makes this stale, which invalidates the session server-side.
  sessionEpoch?: number;
}

// The key h3 uses to seal/unseal the session cookie. `PIWI_AUTH_SECRET` from the
// runtime environment wins over the build-time-baked config value, so the
// prebuilt image honors a secret supplied at run time (see isAuthEnabled).
function getSessionPassword(config: ReturnType<typeof useRuntimeConfig>): string {
  return process.env.PIWI_AUTH_SECRET || config.authSecret;
}

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

/**
 * Name of the sealed session cookie. Set explicitly rather than left to h3's
 * default (`h3`) so the public cookie name reads as ours and does not leak the
 * framework — the name is frozen contract at 1.0 (documented in the OpenAPI
 * `sessionCookie` scheme in nuxt.config.ts).
 */
export const SESSION_COOKIE_NAME = 'piwi_session';

/**
 * Config for the sealed session cookie, shared by every session operation so its
 * attributes stay consistent (including on clear).
 *
 * `httpOnly` and `secure` keep the cookie out of reach of page scripts and off
 * plaintext connections. `sameSite: 'lax'` is set explicitly rather than left to
 * the browser's implicit default so the cookie is withheld from cross-site
 * subrequests — a CSRF defense for the cookie-authenticated API — while still
 * riding top-level navigations, which OAuth callbacks and ordinary links into
 * the dashboard depend on. These are pinned here rather than inherited from h3's
 * defaults so the posture cannot silently change across h3 versions.
 */
function sessionOptions(config: ReturnType<typeof useRuntimeConfig>) {
  return {
    name: SESSION_COOKIE_NAME,
    password: getSessionPassword(config),
    maxAge: SESSION_MAX_AGE_SEC,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
    },
  };
}

// Get session from cookie
export async function getUserSession(event: H3Event): Promise<SessionData | null> {
  const config = useRuntimeConfig(event);
  if (!isAuthEnabled(event)) {
    return null;
  }

  try {
    const session = await useSession<SessionData>(event, sessionOptions(config));

    if (!session.data || !session.data.userId) {
      return null;
    }

    return session.data;
  } catch {
    // Invalid or expired session
    return null;
  }
}

// Set session in cookie
export async function setUserSession(event: H3Event, sessionData: SessionData): Promise<void> {
  const config = useRuntimeConfig(event);
  await updateSession<SessionData>(event, sessionOptions(config), sessionData);
}

// Clear session cookie
export async function clearUserSession(event: H3Event): Promise<void> {
  const config = useRuntimeConfig(event);
  await h3ClearSession(event, sessionOptions(config));
}

// Get current user from session
export async function getCurrentUser(event: H3Event): Promise<User | null> {
  const session = await getUserSession(event);
  if (!session) {
    return null;
  }

  const db = await getDatabase();
  const userResults = await db.select().from(users).where(eq(users.id, session.userId));
  const user = userResults[0];
  if (!user) {
    return null;
  }

  // A session minted before the user's epoch was last bumped is revoked.
  if ((session.sessionEpoch ?? 0) !== (user.sessionEpoch ?? 0)) {
    return null;
  }

  return user;
}

/**
 * Revoke every existing session for a user by advancing their session epoch.
 * Sessions carry the epoch they were minted with; `getCurrentUser` rejects any
 * whose epoch no longer matches. Returns the new epoch so the caller can
 * immediately re-issue the current device a valid session if desired.
 */
export async function revokeUserSessions(userId: number): Promise<number> {
  const db = await getDatabase();
  const rows = await db
    .update(users)
    .set({ sessionEpoch: sql`${users.sessionEpoch} + 1` })
    .where(eq(users.id, userId))
    .returning({ sessionEpoch: users.sessionEpoch });
  return rows[0]?.sessionEpoch ?? 0;
}

// A syntactically-valid scrypt hash (salt:hex) used only to spend the same
// verification work for a nonexistent or password-less account as for a real
// one. Its value is irrelevant — the comparison always fails; it exists solely
// so login response timing can't be used to tell whether a username exists.
const DUMMY_PASSWORD_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

// Verify user credentials and return user
export async function verifyUser(username: string, password: string): Promise<User | null> {
  const db = await getDatabase();
  const userResults = await db.select().from(users).where(eq(users.username, username));
  const user = userResults[0];

  // Equalize response time whether or not the account exists and has a
  // password: a missing or OAuth-only (password-less) account still spends one
  // scrypt verification against a dummy hash, so login timing can't be used to
  // enumerate which usernames are registered (audit L3).
  if (!user || !user.password) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return null;
  }

  return user;
}

// Create a new user
/** Whether the users table is empty — i.e. initial setup (`POST /api/auth/setup`) is still available. */
export async function needsInitialSetup(): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  return existing.length === 0;
}

export async function createUser(username: string, password: string, role: Role, name?: string): Promise<User> {
  const db = await getDatabase();
  const hashedPassword = await hashPassword(password);

  const result = await db
    .insert(users)
    .values({
      username,
      password: hashedPassword,
      role,
      name: name || null,
    })
    .returning();

  const user = result[0];
  if (!user) {
    throw new Error('Failed to create user');
  }

  return user;
}

/** Sentinel key marking that initial setup has been performed. */
const INITIAL_SETUP_KEY = 'initial_setup_completed';

/**
 * Atomically claim the one-time initial-setup slot, returning true for exactly
 * one caller.
 *
 * `needsInitialSetup` (a SELECT) and `createUser` (a later INSERT) are separate
 * statements, so two concurrent `POST /api/auth/setup` requests could both see
 * an empty users table and each create an administrator. Claiming a sentinel row
 * with `INSERT ... ON CONFLICT DO NOTHING` closes that window: SQLite and
 * Postgres both resolve the primary-key conflict atomically, so only the first
 * of any set of concurrent callers inserts the row (and goes on to create the
 * admin) while the rest conflict and get false. Callers must still gate on
 * `needsInitialSetup()` first, so an instance seeded by other means (OAuth, a
 * fixture) is never re-opened merely because the sentinel is absent.
 */
export async function claimInitialSetup(db?: DrizzleDB): Promise<boolean> {
  const database = db ?? (await getDatabase());
  const inserted = await database
    .insert(appSettings)
    .values({ key: INITIAL_SETUP_KEY, value: true, updatedAt: new Date() })
    .onConflictDoNothing({ target: appSettings.key })
    .returning({ key: appSettings.key });
  return inserted.length > 0;
}

/**
 * Release a claim made by `claimInitialSetup` so setup can be retried. Only the
 * claim winner calls this, and only when admin creation failed after the claim —
 * the losing callers were already rejected, so there is no window for a second
 * admin to slip through.
 */
export async function releaseInitialSetup(db?: DrizzleDB): Promise<void> {
  const database = db ?? (await getDatabase());
  await database.delete(appSettings).where(eq(appSettings.key, INITIAL_SETUP_KEY));
}

// Check if user has required role
export function hasRole(user: User | null, requiredRoles: Role[]): boolean {
  if (!user) {
    return false;
  }
  return requiredRoles.includes(user.role as Role);
}

// Check if authentication is enabled.
//
// `PIWI_AUTH_ENABLED` is read from the runtime environment first: on the
// prebuilt image the config value is baked at build time (when the variable is
// unset), so the env check is what lets an operator turn auth on at run time.
// The baked `config.authEnabled` remains the fallback for source builds and for
// the `NUXT_AUTH_ENABLED` runtime override.
export function isAuthEnabled(event?: H3Event): boolean {
  if (process.env.PIWI_AUTH_ENABLED === 'true') {
    return true;
  }
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig();
  return String(config.authEnabled) === 'true';
}

// ---------------------------------------------------------------------------
// API key helpers
// ---------------------------------------------------------------------------

const API_KEY_PREFIX = 'pd_';
const API_KEY_BYTES = 32; // 256 bits of entropy → 64-char hex string

/**
 * Generate a new API key.
 * Returns the plaintext key (shown ONCE to the user) and the data to persist.
 */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(API_KEY_BYTES).toString('hex');
  const plaintext = `${API_KEY_PREFIX}${raw}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const prefix = raw.slice(0, 8);
  return { plaintext, hash, prefix };
}

/**
 * Hash a plaintext API key the same way generateApiKey does.
 * Used for verification.
 */
function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Look up a user by a plaintext API key value.
 * Updates `last_used_at` on a successful match.
 * Returns null if the key does not exist, is expired, or belongs to no user.
 */
export async function getUserByApiKey(plaintext: string): Promise<User | null> {
  if (!plaintext.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const hash = hashApiKey(plaintext);
  const db = await getDatabase();

  const keyResults = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash));
  const key = keyResults[0];

  if (!key) {
    return null;
  }

  // Check expiry
  if (key.expiresAt && key.expiresAt < new Date()) {
    return null;
  }

  // Update last used at most once per hour to avoid excessive write load
  const ONE_HOUR_MS = 60 * 60 * 1000;
  if (!key.lastUsedAt || new Date().getTime() - key.lastUsedAt.getTime() > ONE_HOUR_MS) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  }

  const userResults = await db.select().from(users).where(eq(users.id, key.userId));
  return userResults[0] || null;
}

/**
 * Extract the Bearer token from the Authorization header, or the value of the
 * X-API-Key header.  Returns null if neither is present or if the value does
 * not start with the API key prefix.
 */
function extractApiKey(event: H3Event): string | null {
  const authHeader = getRequestHeader(event, 'authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.startsWith(API_KEY_PREFIX)) {
      return match[1];
    }
  }

  const xApiKey = getRequestHeader(event, 'x-api-key');
  if (xApiKey?.startsWith(API_KEY_PREFIX)) {
    return xApiKey;
  }

  return null;
}

// Require authentication - throw error if not authenticated
export async function requireAuth(event: H3Event, allowedRoles?: Role[]): Promise<User> {
  if (!isAuthEnabled(event)) {
    // If auth is disabled, create a virtual admin user
    return {
      id: 0,
      username: 'system',
      password: '',
      role: Role.ADMINISTRATOR,
      name: 'System',
      avatarUrl: null,
      oauthProvider: null,
      oauthProviderId: null,
      email: null,
      emailVerified: false,
      sessionEpoch: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Roles come from the route's `x-required-roles` meta (the single source of
  // truth, also shown in /docs); an explicit `allowedRoles` argument overrides
  // it for the rare route that computes its own authorization.
  const roles = allowedRoles ?? getRouteRequiredRoles(event) ?? undefined;

  // 1. Try API key authentication (preferred for CI/reporter usage)
  const apiKeyValue = extractApiKey(event);
  if (apiKeyValue) {
    const user = await getUserByApiKey(apiKeyValue);
    if (!user) {
      throw apiError({
        statusCode: 401,
        message: 'Invalid or expired API key',
      });
    }

    if (roles && !hasRole(user, roles)) {
      throw apiError({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
    }

    return user;
  }

  // 2. Fall back to session cookie
  const user = await getCurrentUser(event);
  if (!user) {
    throw apiError({
      statusCode: 401,
      message: 'Authentication required',
    });
  }

  if (roles && !hasRole(user, roles)) {
    throw apiError({
      statusCode: 403,
      message: 'Insufficient permissions',
    });
  }

  return user;
}
