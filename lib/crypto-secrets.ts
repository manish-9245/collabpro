import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Reversible encryption for secrets the server must send onward as
 * plaintext (e.g. a team's LLM provider API key) - unlike ApiKey.hashedKey
 * (one-way SHA-256, fine for comparison-only auth tokens), this can't be a
 * hash. AES-256-GCM: authenticated encryption, so a tampered ciphertext
 * fails to decrypt instead of silently producing garbage.
 *
 * Key is HKDF-derived from SESSION_SECRET (already required app-wide, see
 * lib/session-auth/jwt.ts) rather than a new env var - a distinct `info`
 * string keeps this cryptographically separate from SESSION_SECRET's JWT-
 * signing use.
 */

const ALGO = 'aes-256-gcm';
const HKDF_INFO = 'collabpro-ai-settings-encryption';
const IV_LENGTH = 12; // GCM standard 96-bit IV

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required to encrypt/decrypt secrets.');
  }
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(32), HKDF_INFO, 32));
}

/** Returns "iv:authTag:ciphertext", each base64-encoded. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString('base64')).join(':');
}

export function decryptSecret(packed: string): string {
  const [ivB64, tagB64, ctB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted secret payload.');
  }
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
