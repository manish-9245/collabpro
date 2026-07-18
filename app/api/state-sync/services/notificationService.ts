import { prisma } from '@/lib/db';

export async function handleNotificationService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  let result: any = null;

  switch (path) {
    case 'notifications:getNotifications': {
      const { userEmail } = args || {};
      result = await prisma.notification.findMany({
        where: { userEmail },
        orderBy: { createdAt: 'desc' },
      });
      break;
    }
    case 'notifications:markRead': {
      const { userEmail, notificationId } = args || {};
      if (notificationId) {
        result = await prisma.notification.update({
          where: { id: notificationId },
          data: { read: true },
        });
      } else {
        result = await prisma.notification.updateMany({
          where: { userEmail },
          data: { read: true },
        });
      }
      break;
    }
    case 'notifications:getInvitations': {
      const { userEmail } = args || {};
      result = await prisma.invitation.findMany({
        where: { inviteeEmail: userEmail, status: "pending" },
        orderBy: { createdAt: 'desc' },
      });
      break;
    }
    case 'notifications:respondToInvitation': {
      const { invitationId, response } = args || {}; // response: "accept" or "decline"
      const invite = await prisma.invitation.findUnique({
        where: { id: invitationId },
      });
      if (!invite) {
        throw new Error("Invitation not found");
      }

      const newStatus = response === 'accept' ? 'accepted' : 'declined';
      await prisma.invitation.update({
        where: { id: invitationId },
        data: { status: newStatus },
      });

      if (response === 'accept') {
        // Add as team member
        await prisma.teamMember.create({
          data: {
            teamId: invite.teamId,
            userEmail: invite.inviteeEmail,
            role: 'member',
          }
        });

        // Create acceptance notification for inviter
        await prisma.notification.create({
          data: {
            userEmail: invite.inviterEmail,
            title: "Invitation Accepted",
            message: `${invite.inviteeEmail} accepted your invitation to join team "${invite.teamName}"!`,
            type: "response"
          }
        });
      } else {
        // Create decline notification for inviter
        await prisma.notification.create({
          data: {
            userEmail: invite.inviterEmail,
            title: "Invitation Declined",
            message: `${invite.inviteeEmail} declined your invitation to join team "${invite.teamName}".`,
            type: "response"
          }
        });
      }

      result = { success: true, status: newStatus };
      break;
    }
    default:
      throw new Error(`Path ${path} not supported in notificationService`);
  }

  return result;
}
