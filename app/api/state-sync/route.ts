import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { verifyApiKey, isReadOnlyOperation } from '@/lib/api-key-middleware';
import { mapConvexIds } from './services/helpers';
import { logger } from '@/lib/logger';
import { withErrorHandler } from '@/lib/api-middleware';

import { handleUserService } from './services/userService';
import { handleTeamService } from './services/teamService';
import { handleFileService } from './services/fileService';
import { handleOrgService } from './services/orgService';
import { handleNotificationService } from './services/notificationService';
import { handleSnykService } from './services/snykService';
import { handleSonarcloudService } from './services/sonarcloudService';
import { handleAiSettingsService } from './services/aiSettingsService';
import { handleChatService } from './services/chatService';
import { checkFileAccess } from '@/lib/file-access';
import { getClientIp } from '@/lib/rate-limiter';
import { checkTeamAccess as checkTeamAccessDb, type TeamAccessPrismaClient } from '@/lib/team-access';

async function checkTeamAccess(teamId: string, email: string): Promise<boolean> {
  return checkTeamAccessDb(prisma as unknown as TeamAccessPrismaClient, teamId, email);
}

async function POST_handler(request: Request) {
  const ipAddress = (request && request.headers && typeof request.headers.get === 'function')
    ? getClientIp(request)
    : '127.0.0.1';

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { path, args } = body || {};
  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'Path parameter required and must be a string' }, { status: 400 });
  }

  logger.info("Convex Mock Request received", { path });

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
      // This endpoint only ever receives POST requests (see the RPC-over-REST
      // convention below), so the HTTP method carries no read/write signal -
      // classify by the RPC path/action name instead.
      const verifyResult = await verifyApiKey(authHeader, !isReadOnlyOperation(path));
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

    // Enforce file-level access controls for authenticated users (Issue 140)
    const filePaths = [
      'files:getFileById',
      'files:updateDocument',
      'files:updateWhiteboard',
      'collabpro_update_document',
      'collabpro_update_whiteboard',
      'files:updateFileName',
      'files:updateFileFolder',
      'files:archiveFile',
      'files:deleteFile',
      'files:createVersion',
      'files:getVersions',
      'files:restoreVersion',
      'files:updateVersionNote',
      'files:upsertPresence',
      'files:clearPresence',
      'files:getActiveCollaborators',
      'chat:getMessages',
      'chat:clearHistory'
    ];

    if (filePaths.includes(path)) {
      let targetFileId = args?._id || args?.fileId || args?.id;
      if (!targetFileId && args?.versionId) {
        const version = await prisma.fileVersion.findUnique({
          where: { id: args.versionId }
        });
        if (version) {
          targetFileId = version.fileId;
        }
      }
      if (!targetFileId) {
        return NextResponse.json({ error: 'Bad Request: Missing file context' }, { status: 400 });
      }

      if (isGuest) {
        if (targetFileId !== guestFileId) {
          return NextResponse.json({ error: 'Forbidden: This shared link does not grant access to the requested file.' }, { status: 403 });
        }
      } else {
        const hasAccess = await checkFileAccess(targetFileId, authUserEmail);
        if (!hasAccess) {
          return NextResponse.json({ error: 'Forbidden: You do not have access to this file' }, { status: 403 });
        }
      }
    }

    // Enforce team-level access controls (Issue 140)
    const teamPaths = [
      'teams:getTeamProfile',
      'teams:updateTeamProfile',
      'teams:getTeamMembers',
      'teams:inviteMember',
      'teams:removeMember',
      'teams:leaveTeam',
      'files:getFiles',
      'files:createFile',
      'ai:getSettings',
      'ai:saveSettings',
      'ai:deleteSettings',
    ];

    if (teamPaths.includes(path)) {
      const targetTeamId = args?.teamId || args?.id;
      if (!targetTeamId) {
        return NextResponse.json({ error: 'Bad Request: Missing team context' }, { status: 400 });
      }

      const hasAccess = await checkTeamAccess(targetTeamId, authUserEmail);
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden: You do not have access to this team' }, { status: 403 });
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

    // MCP tool names aren't namespaced with ':' like the rest of this app's
    // RPC paths, so they need an explicit allowlist here rather than a
    // startsWith check. Both are already listed in filePaths above (the
    // access-control check) - collabpro_update_document was missing from
    // this dispatch condition, so it always fell through to the 404 below
    // despite having a complete handler in fileService.ts.
    const collabproFilePathAliases = ['collabpro_update_document', 'collabpro_update_whiteboard'];

    // Route delegation to discrete service handlers
    if (path.startsWith('user:')) {
      result = await handleUserService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('teams:') || path.startsWith('invitations:')) {
      result = await handleTeamService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('files:') || collabproFilePathAliases.includes(path)) {
      result = await handleFileService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('org:') || path.startsWith('orgSettings:') || path.startsWith('securityAudit:') || path.startsWith('sharedLibrary:')) {
      result = await handleOrgService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('notifications:')) {
      result = await handleNotificationService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('ai:')) {
      result = await handleAiSettingsService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('chat:')) {
      result = await handleChatService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('snyk:')) {
      result = await handleSnykService(path, args, authUserEmail, ipAddress);
    } else if (path.startsWith('sonarcloud:')) {
      result = await handleSonarcloudService(path, args, authUserEmail, ipAddress);
    } else {
      logger.error(`Convex Mock Error: Method ${path} not implemented`);
      return NextResponse.json({ error: `Method ${path} not implemented` }, { status: 404 });
    }

    const mappedResult = mapConvexIds(result);
    logger.info("Mapped output payload success", { path });
    return NextResponse.json({ data: mappedResult });
}

export const POST = withErrorHandler(POST_handler);
