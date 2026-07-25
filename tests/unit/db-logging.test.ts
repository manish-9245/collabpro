import { describe, it, expect } from 'vitest';
import { formatConnectionLogLine } from '@/lib/db';

describe('DB connection log redaction (Issue 194)', () => {
  const FAKE_CONNECTION_STRING =
    'postgresql://postgres:SuperSecretFakePassword123@fakehost:5432/faketestdb';
  const FAKE_PASSWORD_FRAGMENT = 'SuperSecretFakePassword123';

  it('never includes the credential (or any substring of it) in the formatted log line', () => {
    const line = formatConnectionLogLine(FAKE_CONNECTION_STRING);

    expect(line).not.toContain(FAKE_PASSWORD_FRAGMENT);
    // Also guard against partial-substring leaks (e.g. truncated password fragments)
    for (let len = 8; len <= FAKE_PASSWORD_FRAGMENT.length; len++) {
      expect(line).not.toContain(FAKE_PASSWORD_FRAGMENT.slice(0, len));
    }
  });

  it('includes the host and database name so the log line stays useful for debugging', () => {
    const line = formatConnectionLogLine(FAKE_CONNECTION_STRING);

    expect(line).toContain('fakehost');
    expect(line).toContain('faketestdb');
  });

  it('handles an undefined connection string gracefully without throwing', () => {
    expect(() => formatConnectionLogLine(undefined)).not.toThrow();
    const line = formatConnectionLogLine(undefined);
    expect(line).toBeTypeOf('string');
    expect(line).not.toContain('undefined://');
  });

  it('handles a malformed connection string gracefully without throwing', () => {
    expect(() => formatConnectionLogLine('not-a-valid-url')).not.toThrow();
    const line = formatConnectionLogLine('not-a-valid-url');
    expect(line).toBeTypeOf('string');
    expect(line).not.toContain('not-a-valid-url');
  });
});
