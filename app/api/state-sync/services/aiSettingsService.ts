import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import { encryptSecret } from '@/lib/crypto-secrets';

/**
 * Team-scoped AI provider settings (OpenAI-compatible: baseUrl + apiKey +
 * model). Read is open to any team member (harmless - baseUrl/model/masked
 * key only, never the real key); write is owner-only, following this app's
 * only ownership convention (`Team.createdBy === email` - there is no
 * "admin" role, see teamService.ts's identical inline checks).
 */
export async function handleAiSettingsService(
  path: string,
  args: any,
  authUserEmail: string | null,
  ipAddress: string
): Promise<any> {
  switch (path) {
    case 'ai:getSettings': {
      const { teamId } = args || {};
      if (!teamId) throw new Error('teamId is required');
      const row = await prisma.teamAiSettings.findUnique({ where: { teamId } });
      if (!row) return null;
      // Never return encryptedKey.
      return { teamId: row.teamId, baseUrl: row.baseUrl, model: row.model, maskedKey: row.maskedKey, updatedAt: row.updatedAt };
    }

    case 'ai:saveSettings': {
      const { teamId, baseUrl, apiKey, model } = args || {};
      if (!teamId || !baseUrl || !model) throw new Error('teamId, baseUrl, and model are required');

      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team || team.createdBy !== authUserEmail) {
        throw new Error('Forbidden: only the team owner can configure AI settings');
      }

      const data: { baseUrl: string; model: string; updatedBy: string; encryptedKey?: string; maskedKey?: string } = {
        baseUrl,
        model,
        updatedBy: authUserEmail as string,
      };
      // Blank apiKey on an edit means "keep the existing key" - only touch
      // encryptedKey/maskedKey when a new one was actually typed.
      if (apiKey) {
        data.encryptedKey = encryptSecret(apiKey);
        data.maskedKey = `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}`;
      }

      const existing = await prisma.teamAiSettings.findUnique({ where: { teamId } });
      if (!existing && !apiKey) {
        throw new Error('An API key is required when configuring AI settings for the first time');
      }

      const result = await prisma.teamAiSettings.upsert({
        where: { teamId },
        update: data,
        create: {
          teamId,
          baseUrl,
          model,
          updatedBy: authUserEmail as string,
          encryptedKey: data.encryptedKey as string,
          maskedKey: data.maskedKey as string,
        },
      });

      void logAuditEvent(teamId, authUserEmail as string, 'ai_settings:updated', { teamId }, ipAddress);
      return { teamId: result.teamId, baseUrl: result.baseUrl, model: result.model, maskedKey: result.maskedKey };
    }

    case 'ai:deleteSettings': {
      const { teamId } = args || {};
      if (!teamId) throw new Error('teamId is required');

      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team || team.createdBy !== authUserEmail) {
        throw new Error('Forbidden: only the team owner can remove AI settings');
      }

      await prisma.teamAiSettings.deleteMany({ where: { teamId } });
      void logAuditEvent(teamId, authUserEmail as string, 'ai_settings:deleted', { teamId }, ipAddress);
      return { success: true };
    }

    default:
      throw new Error(`Path ${path} not supported in aiSettingsService`);
  }
}
