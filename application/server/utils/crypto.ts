import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'v1:';

function deriveKey(secret: string): Buffer {
  // Purpose-specific derivation so DB encryption keys are distinct from session cookie keys
  return createHash('sha256').update(`piwi-db-encryption:${secret}`).digest();
}

/**
 * Encrypt a plaintext secret. Returns a `v1:<iv>:<tag>:<ciphertext>` string
 * that can be stored in the database.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a value produced by `encryptSecret`. If the value does not start with
 * the `v1:` prefix it is treated as a legacy plaintext value and returned as-is,
 * allowing graceful in-place migration of existing stored secrets.
 */
export function decryptSecret(ciphertext: string, secret: string): string {
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }
  const parts = ciphertext.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

/**
 * Returns the secret key used for DB-level encryption.
 * Reads `PIWI_SECRET_KEY`; falls back to an insecure default so local dev
 * works out-of-the-box. Set this in production even when auth is disabled.
 */
export function getEncryptionKey(): string {
  return process.env.PIWI_SECRET_KEY || 'default-secret-change-in-production-use-random-string';
}
