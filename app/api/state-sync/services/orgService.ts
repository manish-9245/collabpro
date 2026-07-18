import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

export async function handleOrgService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  let result: any = null;

  switch (path) {
    case 'orgSettings:getSettings': {
      const { teamId } = args || {};
      if (!teamId) {
        throw new Error("teamId is required");
      }
      let settings = await prisma.orgSetting.findUnique({
        where: { teamId },
      });
      if (!settings) {
        settings = await prisma.orgSetting.create({
          data: {
            teamId,
            allowedDomains: "",
            ssoEnabled: false,
            ssoProvider: "saml",
            ssoMetadataUrl: "",
            seatLimit: 50,
          },
        });
      }
      result = settings;
      break;
    }
    case 'orgSettings:updateSettings': {
      const { teamId, allowedDomains, ssoEnabled, ssoProvider, ssoMetadataUrl, seatLimit } = args || {};
      if (!teamId) {
        throw new Error("teamId is required");
      }
      result = await prisma.orgSetting.upsert({
        where: { teamId },
        update: {
          allowedDomains: allowedDomains !== undefined ? allowedDomains : undefined,
          ssoEnabled: ssoEnabled !== undefined ? ssoEnabled : undefined,
          ssoProvider: ssoProvider !== undefined ? ssoProvider : undefined,
          ssoMetadataUrl: ssoMetadataUrl !== undefined ? ssoMetadataUrl : undefined,
          seatLimit: seatLimit !== undefined ? Number(seatLimit) : undefined,
        },
        create: {
          teamId,
          allowedDomains: allowedDomains || "",
          ssoEnabled: ssoEnabled || false,
          ssoProvider: ssoProvider || "saml",
          ssoMetadataUrl: ssoMetadataUrl || "",
          seatLimit: seatLimit ? Number(seatLimit) : 50,
        },
      });

      await logAuditEvent(
        teamId,
        authUserEmail || "unknown@collabpro.com",
        "settings:update",
        { allowedDomains, ssoEnabled, ssoProvider, ssoMetadataUrl, seatLimit },
        ipAddress
      );

      break;
    }
    case 'orgSettings:getSeatCount': {
      const { teamId } = args || {};
      if (!teamId) {
        throw new Error("teamId is required");
      }
      const membersCount = await prisma.teamMember.count({
        where: { teamId },
      });
      const pendingCount = await prisma.invitation.count({
        where: { teamId, status: "pending" },
      });
      const settings = await prisma.orgSetting.findUnique({
        where: { teamId },
      });
      const limit = settings ? settings.seatLimit : 50;
      
      result = {
        activeSeats: membersCount + 1, // members + 1 (the owner)
        pendingInvitations: pendingCount,
        seatLimit: limit,
      };
      break;
    }
    case 'securityAudit:getLogs': {
      const { teamId } = args || {};
      if (!teamId) {
        throw new Error("teamId is required");
      }
      result = await prisma.auditLog.findMany({
        where: { teamId },
        orderBy: { createdAt: 'desc' },
      });
      break;
    }
    case 'sharedLibrary:getItems': {
      const { teamId } = args || {};
      if (!teamId) {
        result = [];
        break;
      }
      result = await prisma.sharedLibraryItem.findMany({
        where: { teamId },
        orderBy: { updatedAt: 'desc' },
      });
      break;
    }
    case 'sharedLibrary:upsertItem': {
      const { id, teamId, name, description, sourceUrl, author, payload } = args || {};
      if (!teamId) {
        throw new Error("teamId is required.");
      }
      if (!name || typeof name !== "string") {
        throw new Error("name is required.");
      }
      if (!payload || typeof payload !== "string") {
        throw new Error("payload is required.");
      }

      const normalizedName = name.trim();
      if (!normalizedName) {
        throw new Error("name is required.");
      }

      let existing = null;
      if (id) {
        existing = await prisma.sharedLibraryItem.findFirst({
          where: { id, teamId },
        });
      }
      if (!existing) {
        existing = await prisma.sharedLibraryItem.findFirst({
          where: { teamId, name: normalizedName },
        });
      }

      if (existing) {
        result = await prisma.sharedLibraryItem.update({
          where: { id: existing.id },
          data: {
            name: normalizedName,
            description: description || "",
            sourceUrl: sourceUrl || "",
            author: author || "",
            payload,
          },
        });
      } else {
        result = await prisma.sharedLibraryItem.create({
          data: {
            teamId,
            name: normalizedName,
            description: description || "",
            sourceUrl: sourceUrl || "",
            author: author || "",
            payload,
          },
        });
      }
      break;
    }
    default:
      throw new Error(`Path ${path} not supported in orgService`);
  }

  return result;
}
