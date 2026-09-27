import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'v1:';

/**
 * The built-in fallback used for `PIWI_SECRET_KEY` / `PIWI_AUTH_SECRET` when the
 * operator sets nothing. It is published in this repository, so any data keyed
 * on it is effectively unprotected — the auth and encryption paths refuse to
 * rely on it once real secrets are at stake.
 */
export const DEFAULT_INSECURE_SECRET = 'default-secret-change-in-production-use-random-string';

function deriveKey(secret: string): Buffer {
  // Purpose-specific derivation so DB encryption keys are distinct from session cookie keys
  return createHash('sha256').update(`piwi-db-encryption:${secret}`).digest();
}

/**
 * Encrypt a plaintext secret. Returns a `v1:<iv>:<tag>:<ciphertext>` string
 * that can be stored in the database.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  if (!secret || secret === DEFAULT_INSECURE_SECRET) {
    throw new Error(
      'Refusing to encrypt a secret without a configured PIWI_SECRET_KEY. Set PIWI_SECRET_KEY to a strong ' +
        "random value (node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\") before saving credentials.",
    );
  }
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
 * Whether secrets can be stored: `PIWI_SECRET_KEY` is set to something other
 * than the published development default, which `encryptSecret` refuses.
 */
export function canEncryptSecrets(): boolean {
  const key = process.env.PIWI_SECRET_KEY;
  return !!key && key !== DEFAULT_INSECURE_SECRET;
}

/**
 * Returns the secret key used for DB-level encryption.
 * Reads `PIWI_SECRET_KEY`; falls back to an insecure default so local dev
 * works out-of-the-box. Set this in production even when auth is disabled.
 */
export function getEncryptionKey(): string {
  return process.env.PIWI_SECRET_KEY || DEFAULT_INSECURE_SECRET;
}
