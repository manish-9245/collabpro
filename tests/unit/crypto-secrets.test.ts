import { describe, it, expect, beforeEach } from 'vitest';
import { encryptSecret, decryptSecret } from '@/lib/crypto-secrets';

describe('lib/crypto-secrets', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
  });

  it('round-trips a secret through encrypt then decrypt', () => {
    const packed = encryptSecret('sk-super-secret-api-key');
    expect(decryptSecret(packed)).toBe('sk-super-secret-api-key');
  });

  it('never stores the plaintext in the packed ciphertext', () => {
    const packed = encryptSecret('sk-super-secret-api-key');
    expect(packed).not.toContain('sk-super-secret-api-key');
  });

  it('produces a different ciphertext each time (random IV) even for the same plaintext', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it('rejects a tampered ciphertext instead of silently returning garbage (GCM auth tag)', () => {
    const packed = encryptSecret('sk-super-secret-api-key');
    const [iv, tag, ct] = packed.split(':');
    const tamperedCt = Buffer.from(ct, 'base64');
    tamperedCt[0] ^= 0xff;
    const tampered = [iv, tag, tamperedCt.toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws if SESSION_SECRET is unset', () => {
    delete process.env.SESSION_SECRET;
    expect(() => encryptSecret('x')).toThrow(/SESSION_SECRET/);
  });
});
