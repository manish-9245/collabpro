import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'super-secret-collabpro-key-12345678-abcdefgh';

function base64url(str: Buffer | string): string {
  const base64 = typeof str === 'string' ? Buffer.from(str).toString('base64') : str.toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function signToken(payload: object): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(signatureInput)
    .digest();
  
  return `${signatureInput}.${base64url(signature)}`;
}

export function verifyToken(token: string): any {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  const [encodedHeader, encodedPayload, signature] = parts;
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  
  const expectedSignature = crypto
    .createHmac('sha256', SECRET)
    .update(signatureInput)
    .digest();
  
  if (base64url(expectedSignature) !== signature) {
    return null;
  }
  
  try {
    const payloadStr = base64urlDecode(encodedPayload);
    return JSON.parse(payloadStr);
  } catch {
    return null;
  }
}
