import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { withErrorHandler, HttpError } from '@/lib/api-middleware';

describe('withErrorHandler + HttpError', () => {
  it('maps a thrown HttpError to its own status code and message instead of a generic 500', async () => {
    const handler = async () => {
      throw new HttpError(404, 'File not found');
    };

    const wrapped = withErrorHandler(handler);
    const response = await wrapped({ method: 'GET', url: 'http://localhost/api/test' } as any);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('File not found');
  });

  it('still falls back to a generic 500 for a plain Error', async () => {
    const handler = async () => {
      throw new Error('boom');
    };

    const wrapped = withErrorHandler(handler);
    const response = await wrapped({ method: 'GET', url: 'http://localhost/api/test' } as any);

    expect(response.status).toBe(500);
  });

  it('returns the handler response untouched on success', async () => {
    const handler = async () => NextResponse.json({ ok: true }, { status: 200 });
    const wrapped = withErrorHandler(handler);
    const response = await wrapped({ method: 'GET', url: 'http://localhost/api/test' } as any);
    expect(response.status).toBe(200);
  });
});
