import type { H3Event } from 'h3'
import { useSession, updateSession, clearSession as h3ClearSession } from 'h3'
import { getDatabase } from '../database'
import { users } from '../database/schema'
import { eq } from 'drizzle-orm'
import type { User } from '../database/schema'
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

// Password hashing using scrypt
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer
  return `${salt}:${derivedKey.toString('hex')}`
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, storedHash] = hash.split(':')
  if (!salt || !storedHash) {
    return false
  }
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer
  const storedHashBuffer = Buffer.from(storedHash, 'hex')
  return timingSafeEqual(derivedKey, storedHashBuffer)
}

// Session management using encrypted cookies
interface SessionData {
  userId: number
  username: string
  role: string
}

// Get session from cookie
export async function getUserSession(event: H3Event): Promise<SessionData | null> {
  const config = useRuntimeConfig(event)
  if (!config.authEnabled) {
    return null
  }

  try {
    const session = await useSession<SessionData>(event, {
      password: config.authSecret,
      maxAge: 60 * 60 * 24 * 7 // 7 days
    })

    if (!session.data || !session.data.userId) {
      return null
    }

    return session.data
  } catch {
    // Invalid or expired session
    return null
  }
}

// Set session in cookie
export async function setUserSession(event: H3Event, sessionData: SessionData): Promise<void> {
  const config = useRuntimeConfig(event)

  await updateSession<SessionData>(event, {
    password: config.authSecret,
    maxAge: 60 * 60 * 24 * 7 // 7 days
  }, sessionData)
}

// Clear session cookie
export async function clearUserSession(event: H3Event): Promise<void> {
  const config = useRuntimeConfig(event)
  await h3ClearSession(event, {
    password: config.authSecret
  })
}

// Get current user from session
export async function getCurrentUser(event: H3Event): Promise<User | null> {
  const session = await getUserSession(event)
  if (!session) {
    return null
  }

  const db = getDatabase()
  const userResults = await db.select().from(users).where(eq(users.id, session.userId))
  return userResults[0] || null
}

// Verify user credentials and return user
export async function verifyUser(username: string, password: string): Promise<User | null> {
  const db = getDatabase()
  const userResults = await db.select().from(users).where(eq(users.username, username))
  const user = userResults[0]

  if (!user) {
    return null
  }

  const valid = await verifyPassword(password, user.password)
  if (!valid) {
    return null
  }

  return user
}

// Create a new user
export async function createUser(username: string, password: string, role: string, name?: string): Promise<User> {
  const db = getDatabase()
  const hashedPassword = await hashPassword(password)

  const result = await db.insert(users).values({
    username,
    password: hashedPassword,
    role,
    name: name || null
  }).returning()

  const user = result[0]
  if (!user) {
    throw new Error('Failed to create user')
  }

  return user
}

// Check if user has required role
export function hasRole(user: User | null, requiredRoles: string[]): boolean {
  if (!user) {
    return false
  }
  return requiredRoles.includes(user.role)
}

// Check if authentication is enabled
export function isAuthEnabled(event?: H3Event): boolean {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  return config.authEnabled === true
}

// Require authentication - throw error if not authenticated
export async function requireAuth(event: H3Event, allowedRoles?: string[]): Promise<User> {
  if (!isAuthEnabled(event)) {
    // If auth is disabled, create a virtual admin user
    return {
      id: 0,
      username: 'system',
      password: '',
      role: 'administrator',
      name: 'System',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }

  const user = await getCurrentUser(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required'
    })
  }

  if (allowedRoles && !hasRole(user, allowedRoles)) {
    throw createError({
      statusCode: 403,
      message: 'Insufficient permissions'
    })
  }

  return user
}
