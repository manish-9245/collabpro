import { prisma as defaultPrisma } from '@/lib/db';

export class NotificationService {
  private prisma: any;

  constructor(prismaClient: any = defaultPrisma) {
    this.prisma = prismaClient;
  }

  async handle(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
    let result: any = null;

    switch (path) {
      case 'notifications:getNotifications': {
        const { userEmail } = args || {};
        const targetUserEmail = authUserEmail || userEmail;
        if (!targetUserEmail) {
          throw new Error("Authentication required");
        }
        result = await this.prisma.notification.findMany({
          where: { userEmail: targetUserEmail },
          orderBy: { createdAt: 'desc' },
        });
        break;
      }
      case 'notifications:markRead': {
        const { userEmail, notificationId } = args || {};
        const targetUserEmail = authUserEmail || userEmail;
        if (!targetUserEmail) {
          throw new Error("Authentication required");
        }

        if (notificationId) {
          const notification = await this.prisma.notification.findUnique({
            where: { id: notificationId },
          });
          if (notification && notification.userEmail !== targetUserEmail) {
            throw new Error("Access denied: You cannot modify notifications belonging to other users.");
          }
          result = await this.prisma.notification.update({
            where: { id: notificationId },
            data: { read: true },
          });
        } else {
          result = await this.prisma.notification.updateMany({
            where: { userEmail: targetUserEmail },
            data: { read: true },
          });
        }
        break;
      }
      case 'notifications:getInvitations': {
        const { userEmail } = args || {};
        const targetUserEmail = authUserEmail || userEmail;
        if (!targetUserEmail) {
          throw new Error("Authentication required");
        }
        result = await this.prisma.invitation.findMany({
          where: { inviteeEmail: targetUserEmail, status: "pending" },
          orderBy: { createdAt: 'desc' },
        });
        break;
      }
      case 'notifications:respondToInvitation': {
        const { invitationId, response } = args || {}; // response: "accept" or "decline"
        
        if (response !== 'accept' && response !== 'decline') {
          throw new Error("Invalid response value: Must be 'accept' or 'decline'.");
        }
        
        const resultData = await this.prisma.$transaction(async (tx: any) => {
          const invite = await tx.invitation.findUnique({
            where: { id: invitationId },
          });
          if (!invite) {
            throw new Error("Invitation not found");
          }
          if (invite.status !== 'pending') {
            throw new Error("Invitation has already been responded to.");
          }

          // Verify the responder is the authorized invitee
          if (authUserEmail && invite.inviteeEmail !== authUserEmail) {
            throw new Error("Access denied: You cannot respond to an invitation sent to another user.");
          }

          const newStatus = response === 'accept' ? 'accepted' : 'declined';
          await tx.invitation.update({
            where: { id: invitationId },
            data: { status: newStatus },
          });

          if (response === 'accept') {
            // Recheck seat limit during invitation acceptance
            const orgSettings = await tx.orgSetting.findUnique({
              where: { teamId: invite.teamId },
            });
            const activeSeats = (await tx.teamMember.count({ where: { teamId: invite.teamId } })) + 1;
            const limit = orgSettings ? orgSettings.seatLimit : 50;
            if (activeSeats >= limit) {
              throw new Error(`Seat limit reached: This team has reached its maximum seat capacity of ${limit} members.`);
            }

            // Add as team member
            await tx.teamMember.create({
              data: {
                teamId: invite.teamId,
                userEmail: invite.inviteeEmail,
                role: 'member',
              }
            });

            // Create acceptance notification for inviter
            await tx.notification.create({
              data: {
                userEmail: invite.inviterEmail,
                title: "Invitation Accepted",
                message: `${invite.inviteeEmail} accepted your invitation to join team "${invite.teamName}"!`,
                type: "response"
              }
            });
          } else {
            // Create decline notification for inviter
            await tx.notification.create({
              data: {
                userEmail: invite.inviterEmail,
                title: "Invitation Declined",
                message: `${invite.inviteeEmail} declined your invitation to join team "${invite.teamName}".`,
                type: "response"
              }
            });
          }

          return { success: true, status: newStatus };
        });

        result = resultData;
        break;
      }
      default:
        throw new Error(`Path ${path} not supported in notificationService`);
    }

    return result;
  }
}

export async function handleNotificationService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  const service = new NotificationService();
  return service.handle(path, args, authUserEmail, ipAddress);
}
