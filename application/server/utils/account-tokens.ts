import { randomBytes, createHash } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { accountTokens } from '../database/schema';

export type TokenPurpose = 'reset' | 'verify' | 'invite';

const TTL_MS: Record<TokenPurpose, number> = {
  reset: 60 * 60 * 1000, // 1 hour
  verify: 24 * 60 * 60 * 1000, // 24 hours
  invite: 72 * 60 * 60 * 1000, // 72 hours
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mint a new single-use token for a user. Returns the plaintext token to email. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mintAccountToken(
  db: LibSQLDatabase<any>,
  userId: number,
  purpose: TokenPurpose,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_MS[purpose]);

  // Invalidate any unused tokens of the same purpose for this user
  await db.delete(accountTokens).where(and(eq(accountTokens.userId, userId), eq(accountTokens.purpose, purpose)));

  await db.insert(accountTokens).values({ userId, purpose, tokenHash, expiresAt });
  return token;
}

export interface ValidatedToken {
  userId: number;
  purpose: TokenPurpose;
  tokenId: number;
}

/** Validate a token. Returns the validated token info or null if invalid/expired/used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function validateAccountToken(
  db: LibSQLDatabase<any>,
  token: string,
  purpose: TokenPurpose,
): Promise<ValidatedToken | null> {
  const tokenHash = hashToken(token);
  const now = new Date();

  const rows = await db
    .select()
    .from(accountTokens)
    .where(
      and(eq(accountTokens.tokenHash, tokenHash), eq(accountTokens.purpose, purpose), gt(accountTokens.expiresAt, now)),
    );

  const row = rows[0];
  if (!row || row.usedAt) return null;

  return { userId: row.userId, purpose: row.purpose as TokenPurpose, tokenId: row.id };
}

/** Mark a token as used (single-use enforcement). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function consumeAccountToken(db: LibSQLDatabase<any>, tokenId: number): Promise<void> {
  await db.update(accountTokens).set({ usedAt: new Date() }).where(eq(accountTokens.id, tokenId));
}
