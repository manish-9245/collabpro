import { sha256 } from 'js-sha256';

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required. Set it to a random 32+ character string.');
  }
  return secret;
}

function base64url(str: string | Uint8Array): string {
  let binary = '';
  const bytes = typeof str === 'string' ? new TextEncoder().encode(str) : str;
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function hexToBase64Url(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return base64url(bytes);
}

export interface SessionTokenPayload {
  id: string
  email: string
  name: string
  image?: string
  iat: number
  exp: number
}

export function signToken(payload: object): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const tokenPayload = {
    ...payload as object,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(tokenPayload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signatureHex = sha256.hmac(getSecret(), signatureInput);
  const signatureBase64Url = hexToBase64Url(signatureHex);

  return `${signatureInput}.${signatureBase64Url}`;
}

export function verifyToken(token: string): SessionTokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignatureHex = sha256.hmac(getSecret(), signatureInput);
  const expectedSignatureBase64Url = hexToBase64Url(expectedSignatureHex);

  if (expectedSignatureBase64Url !== signature) {
    return null;
  }

  try {
    const payloadStr = base64urlDecode(encodedPayload);
    const payload = JSON.parse(payloadStr) as SessionTokenPayload;

    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
      return null;
    }

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || Date.now() / 1000 >= payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
