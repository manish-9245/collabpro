import { prisma } from './db';

/**
 * Persists an immutable security audit event into the database.
 */
export async function logAuditEvent(
  teamId: string, 
  userEmail: string, 
  action: string, 
  context: any, 
  ipAddress: string = "127.0.0.1"
) {
  try {
    await prisma.auditLog.create({
      data: {
        teamId,
        userEmail,
        action,
        context: JSON.stringify(context || {}),
        ipAddress: ipAddress || "127.0.0.1",
      }
    });
  } catch (err) {
    console.error("[AUDIT LOG ERROR]", err);
  }
}
