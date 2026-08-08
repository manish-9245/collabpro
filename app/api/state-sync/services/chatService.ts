import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

/**
 * Per-file AI chat history, read/cleared through the state-sync RPC bus
 * (the same bus used for everything except the streaming send itself, which
 * needs its own route - see app/api/ai/chat/route.ts).
 *
 * Both paths key on `authUserEmail` (the caller), never on anything from
 * `args` - this alone makes history private per-collaborator with no extra
 * access-check code: a user cannot read or clear another user's rows
 * through this RPC no matter what they pass in args.
 */
export async function handleChatService(
  path: string,
  args: any,
  authUserEmail: string | null,
  ipAddress: string
): Promise<any> {
  switch (path) {
    case 'chat:getMessages': {
      const { fileId } = args || {};
      if (!fileId) throw new Error('fileId is required');
      return prisma.chatMessage.findMany({
        where: { fileId, userEmail: authUserEmail as string },
        orderBy: { createdAt: 'asc' },
      });
    }

    case 'chat:clearHistory': {
      const { fileId } = args || {};
      if (!fileId) throw new Error('fileId is required');
      await prisma.chatMessage.deleteMany({ where: { fileId, userEmail: authUserEmail as string } });
      void logAuditEvent(null, authUserEmail as string, 'ai_chat:history_cleared', { fileId }, ipAddress);
      return { success: true };
    }

    default:
      throw new Error(`Path ${path} not supported in chatService`);
  }
}
