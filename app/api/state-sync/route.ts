import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { verifyApiKey } from '@/lib/api-key-middleware';
import { mapConvexIds } from './services/helpers';

import { handleUserService } from './services/userService';
import { handleTeamService } from './services/teamService';
import { handleFileService } from './services/fileService';
import { handleOrgService } from './services/orgService';
import { handleNotificationService } from './services/notificationService';

export async function POST(request: Request) {
  try {
    const ipAddress = (request && request.headers && typeof request.headers.get === 'function')
      ? (request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1')
      : '127.0.0.1';
    const { path, args } = await request.json();
    console.log("Convex Mock Request: path =", path, "args =", JSON.stringify(args || {}));

    if (!path) {
      return NextResponse.json({ error: 'Path parameter required' }, { status: 400 });
    }

    // --- SECURITY & AUTHORIZATION CHECK ---
    let authUserEmail: string | null = null;
    let isGuest = false;
    let guestRole = 'viewer';
    let guestFileId = '';

    // 1. Try Cookie Session Auth (Standard Web Client)
    const session = getServerSession();
    const sessionUser = await session.getUser();
    if (sessionUser && sessionUser.email) {
      authUserEmail = sessionUser.email;
    }

    // 2. Try API Key Auth (MCP Automation Tools & Programmatic Agents)
    if (!authUserEmail) {
      const authHeader = request.headers.get('authorization');
      const verifyResult = await verifyApiKey(authHeader, request.method);
      if (verifyResult.isValid) {
        authUserEmail = verifyResult.userEmail;
      } else if (authHeader) {
        // If they provided a key but it is invalid/expired/forbidden, fail fast!
        return NextResponse.json({ error: verifyResult.error }, { status: verifyResult.statusCode || 401 });
      }
    }

    // 3. Try Shared Link (Guest Access)
    if (!authUserEmail) {
      let sharedLinkId = request.headers.get('x-shared-link-id');
      if (!sharedLinkId && args && typeof args === 'object') {
        sharedLinkId = args.sharedLinkId;
      }

      if (sharedLinkId) {
        const link = await prisma.sharedLink.findUnique({
          where: { id: sharedLinkId }
        });

        if (!link) {
          return NextResponse.json({ error: 'Forbidden: Share link not found' }, { status: 403 });
        }

        // Check active status
        if (!link.isActive) {
          return NextResponse.json({ error: 'Forbidden: This shared link is currently inactive' }, { status: 403 });
        }

        // Check expiration
        if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
          return NextResponse.json({ error: 'Forbidden: This sharing link has expired' }, { status: 410 });
        }

        // Valid shared link! Grant guest access
        isGuest = true;
        guestRole = link.role; // 'viewer', 'commenter', 'editor'
        guestFileId = link.fileId;
        authUserEmail = `guest_${link.id}@collabpro.guest`;
      }
    }

    // 4. Fallback: Reject unauthenticated calls
    if (!authUserEmail) {
      return NextResponse.json({ 
        error: 'Unauthorized: Valid cookie session, API key, or shared link is required.' 
      }, { status: 401 });
    }

    // If guest, enforce scope restrictions and file boundaries
    if (isGuest) {
      // 1. Enforce file boundary
      const requestedFileId = args?.fileId || args?._id || args?.id;
      if (requestedFileId && requestedFileId !== guestFileId) {
        return NextResponse.json({ 
          error: 'Forbidden: This shared link does not grant access to the requested file.' 
        }, { status: 403 });
      }

      // 2. Enforce write/mutation restriction
      const mutationPaths = [
        'files:updateDocument',
        'files:updateWhiteboard',
        'collabpro_update_whiteboard'
      ];
      if (mutationPaths.includes(path) && guestRole !== 'editor') {
        return NextResponse.json({ 
          error: 'Forbidden: Guest does not have write permissions for this shared link.' 
        }, { status: 403 });
      }
    }

    // Auto-default email arguments to the authenticated user's email if missing
    if (args && typeof args === 'object') {
      if (!args.userEmail) {
        args.userEmail = authUserEmail;
      }
      if (!args.email) {
        args.email = authUserEmail;
      }
      if (!args.createdBy) {
        args.createdBy = authUserEmail;
      }
    }

    let result: any = null;

    // Route delegation to discrete service handlers
    if (path.startsWith('user:')) {
      result = await handleUserService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('teams:') || path.startsWith('invitations:')) {
      result = await handleTeamService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('files:') || path === 'collabpro_update_whiteboard') {
      result = await handleFileService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('org:')) {
      result = await handleOrgService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('notifications:')) {
      result = await handleNotificationService(path, args, authUserEmail, ipAddress);
    } else {
      console.error(`Convex Mock Error: Method ${path} not implemented`);
      return NextResponse.json({ error: `Method ${path} not implemented` }, { status: 404 });
    }

    const mappedResult = mapConvexIds(result);
    console.log("Mapped output payload:", JSON.stringify(mappedResult));
    return NextResponse.json({ data: mappedResult });
  } catch (error: any) {
    console.error('Convex mock API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
