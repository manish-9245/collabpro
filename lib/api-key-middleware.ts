import { prisma } from '@/lib/db';
import { createHash } from 'crypto';

export interface ApiKeyVerificationResult {
  isValid: boolean;
  userEmail: string | null;
  scope: string | null;
  error?: string;
  statusCode?: number;
}

/**
 * Hash a plain text API Key with SHA-256 for secure DB comparison
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Verify an authorization header containing a CollabPro PAT and return verification details
 */
export async function verifyApiKey(
  authorizationHeader: string | null,
  requestMethod?: string
): Promise<ApiKeyVerificationResult> {
  if (!authorizationHeader) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Authorization header missing',
      statusCode: 401
    };
  }

  const parts = authorizationHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Invalid authorization format. Expected "Bearer <token>"',
      statusCode: 401
    };
  }

  const token = parts[1].trim();
  if (!token.startsWith('collabpro_pat_')) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Invalid API key prefix',
      statusCode: 401
    };
  }

  const hashedToken = hashApiKey(token);

  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { hashedKey: hashedToken }
  });

  if (!apiKeyRecord) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Invalid API key or token has been revoked',
      statusCode: 401
    };
  }

  // Check Expiry
  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'API key has expired',
      statusCode: 401
    };
  }

  // Check Scope
  if (requestMethod && apiKeyRecord.scope === 'read-only') {
    const uppercaseMethod = requestMethod.toUpperCase();
    const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(uppercaseMethod);
    if (isWriteOperation) {
      return {
        isValid: false,
        userEmail: apiKeyRecord.userEmail,
        scope: apiKeyRecord.scope,
        error: 'Forbidden: API key has read-only access scope',
        statusCode: 403
      };
    }
  }

  return {
    isValid: true,
    userEmail: apiKeyRecord.userEmail,
    scope: apiKeyRecord.scope
  };
}
