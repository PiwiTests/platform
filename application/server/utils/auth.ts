import type { H3Event } from 'h3';
import { useSession, updateSession, clearSession as h3ClearSession } from 'h3';
import { getDatabase } from '../database';
import { users, apiKeys } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { User } from '../database/schema';
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { Role } from '../../shared/types';

const scryptAsync = promisify(scrypt);

// Password hashing using scrypt
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
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
}

// Get session from cookie
export async function getUserSession(event: H3Event): Promise<SessionData | null> {
  const config = useRuntimeConfig(event);
  if (!config.authEnabled) {
    return null;
  }

  try {
    const session = await useSession<SessionData>(event, {
      password: config.authSecret,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

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

  await updateSession<SessionData>(
    event,
    {
      password: config.authSecret,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
    sessionData,
  );
}

// Clear session cookie
export async function clearUserSession(event: H3Event): Promise<void> {
  const config = useRuntimeConfig(event);
  await h3ClearSession(event, {
    password: config.authSecret,
  });
}

// Get current user from session
export async function getCurrentUser(event: H3Event): Promise<User | null> {
  const session = await getUserSession(event);
  if (!session) {
    return null;
  }

  const db = await getDatabase();
  const userResults = await db.select().from(users).where(eq(users.id, session.userId));
  return userResults[0] || null;
}

// Verify user credentials and return user
export async function verifyUser(username: string, password: string): Promise<User | null> {
  const db = await getDatabase();
  const userResults = await db.select().from(users).where(eq(users.username, username));
  const user = userResults[0];

  if (!user) {
    return null;
  }

  // OAuth-only users have empty password and cannot log in with credentials
  if (!user.password) {
    return null;
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return null;
  }

  return user;
}

// Create a new user
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

// Check if user has required role
export function hasRole(user: User | null, requiredRoles: Role[]): boolean {
  if (!user) {
    return false;
  }
  return requiredRoles.includes(user.role as Role);
}

// Check if authentication is enabled
export function isAuthEnabled(event?: H3Event): boolean {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig();
  // Nitro overrides runtimeConfig from NUXT_* env vars at startup. Since
  // environment variables are always strings, a boolean `true` from the
  // config file becomes the string `"true"` after the override.
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // 1. Try API key authentication (preferred for CI/reporter usage)
  const apiKeyValue = extractApiKey(event);
  if (apiKeyValue) {
    const user = await getUserByApiKey(apiKeyValue);
    if (!user) {
      throw createError({
        statusCode: 401,
        message: 'Invalid or expired API key',
      });
    }

    if (allowedRoles && !hasRole(user, allowedRoles)) {
      throw createError({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
    }

    return user;
  }

  // 2. Fall back to session cookie
  const user = await getCurrentUser(event);
  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required',
    });
  }

  if (allowedRoles && !hasRole(user, allowedRoles)) {
    throw createError({
      statusCode: 403,
      message: 'Insufficient permissions',
    });
  }

  return user;
}
