import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateAndSanitizeWhiteboardElements } from '@/lib/canvas-validation';
import { getCachedFile, invalidateCachedFile } from '@/lib/redis-cache';
import { logAuditEvent } from '@/lib/audit';
import { FileService, extractTextFromWhiteboard } from '@/lib/file-service';
import { HttpError } from '@/lib/api-middleware';
import {
  asJsonString,
  parseJsonIfString,
  asEditorDocument,
  asWhiteboardElements,
  mergeDocumentBlocks,
  mergeWhiteboardById,
  ConflictStrategy,
} from './helpers';
import { casUpdateDocument as sharedCasUpdateDocument, casUpdateWhiteboard as sharedCasUpdateWhiteboard } from '@/lib/cas-writes';

// FileVersion snapshots store a full copy of `document` and `whiteboard` on
// every checkpoint (Issue 200). Without a cap this grows unbounded, so
// files:createVersion prunes down to the most recent N after every insert.
const MAX_RETAINED_VERSIONS = 50;

// Hard ceiling on any client-supplied `take`/page-size argument. Without
// this, pagination is cosmetic - a caller can still request an effectively
// unbounded page and get the full dataset (including, pre-#190/#200, every
// document/whiteboard blob) in one call.
const MAX_PAGE_SIZE = 100;

function resolvePageSize(take: unknown, fallback = 50): number {
  if (!Number.isInteger(take) || (take as number) <= 0) return fallback;
  return Math.min(take as number, MAX_PAGE_SIZE);
}

// review round 2 (Groups 1 & 2): the CAS writers used to live here, but had
// two bugs — the predicate compared against a normalized/synthesized current
// value instead of the exact raw row (so a brand-new file's default empty
// document/whiteboard could never be saved, since the DB has "" but the
// predicate compared against a synthesized default object), and full-snapshot
// saves used union-merge instead of replace semantics (so a deleted
// block/element always reappeared). Both are fixed in the canonical
// `lib/cas-writes.ts`, which is also what the standalone WS gateway now
// calls — "don't reimplement, reuse." The old local mergeWhiteboardPayloads
// (Yjs-update-based union merge) is gone along with the yjs dependency
// itself (issue #188) — superseded by the shared CAS writers below, which
// route legacy rows through lib/legacy-crdt-decode.ts instead.
function casUpdateDocument(targetFileId: string, incomingDocument: unknown) {
  return sharedCasUpdateDocument(prisma as any, targetFileId, incomingDocument, {
    onPersisted: (fileId) => invalidateCachedFile(fileId),
  });
}

function casUpdateWhiteboard(targetFileId: string, incomingWhiteboard: unknown) {
  return sharedCasUpdateWhiteboard(prisma as any, targetFileId, incomingWhiteboard, {
    onPersisted: (fileId) => invalidateCachedFile(fileId),
  });
}

export async function handleFileService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  let result: any = null;

  switch (path) {
    case 'files:getFiles': {
      const { teamId, userEmail, scope, take, cursor } = args || {};

      const pageSize = resolvePageSize(take);

      // Excludes `document` and `whiteboard` - the dashboard/sidebar list
      // views never render the full blobs, but this path is polled every
      // ~4s per client, so shipping them here was pure wasted bandwidth
      // (Issue 190). `whiteboardText` is kept: it's the small derived
      // search-index text FileList.tsx matches against, not the raw canvas.
      const listSelect = {
        id: true,
        fileName: true,
        teamId: true,
        createdBy: true,
        archive: true,
        folder: true,
        createdAt: true,
        whiteboardText: true,
      } as const;

      const paginationArgs = {
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        select: listSelect,
        take: pageSize + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      };

      let files: any[] = [];

      if (scope === 'org' && userEmail) {
        // Get all teams the user is member or creator of
        const createdTeams = await prisma.team.findMany({
          where: { createdBy: userEmail },
          select: { id: true },
        });
        const memberships = await prisma.teamMember.findMany({
          where: { userEmail },
          select: { teamId: true },
        });
        const memberTeamIds = memberships.map(m => m.teamId);
        const allTeamIds = [...createdTeams.map(t => t.id), ...memberTeamIds];

        files = await prisma.file.findMany({
          where: { teamId: { in: allTeamIds } },
          ...paginationArgs,
        });
      } else if (scope === 'personal' && userEmail) {
        files = await prisma.file.findMany({
          where: { teamId, createdBy: userEmail },
          ...paginationArgs,
        });
      } else {
        // Default: team scope
        files = await prisma.file.findMany({
          where: { teamId },
          ...paginationArgs,
        });
      }

      let nextCursor: string | null = null;
      if (files.length > pageSize) {
        // Lookahead row only proves another page exists - discard it and
        // point the cursor at the last row we're actually returning.
        files.pop();
        nextCursor = files[files.length - 1].id;
      }

      // Fetch user profiles for all file creators to attach real avatar and name
      const creatorEmails = Array.from(new Set(files.map(f => f.createdBy)));
      const users = await prisma.user.findMany({
        where: { email: { in: creatorEmails } },
        select: { email: true, name: true, image: true },
      });

      const userMap = new Map(users.map(u => [u.email, u]));

      // Fetch team details to map teamId to teamName
      const teamIds = Array.from(new Set(files.map(f => f.teamId)));
      const teams = await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, teamName: true },
      });
      const teamMap = new Map(teams.map(t => [t.id, t]));

      const items = files.map(file => {
        const creator = userMap.get(file.createdBy);
        const team = teamMap.get(file.teamId);
        return {
          ...file,
          creatorName: creator?.name || file.createdBy.split('@')[0],
          creatorImage: creator?.image || null,
          teamName: team?.teamName || null
        };
      });

      result = { items, nextCursor };
      break;
    }
    case 'files:getFileById': {
      const { _id } = args || {};
      result = _id ? await getCachedFile(_id) : null;
      break;
    }
    case 'files:createFile': {
      const { fileName, teamId, createdBy, archive, document, whiteboard, folder } = args || {};
      result = await prisma.file.create({
        data: {
          fileName,
          teamId,
          createdBy,
          archive: archive ?? false,
          document: document ?? '',
          whiteboard: whiteboard ?? '',
          whiteboardText: whiteboard ? extractTextFromWhiteboard(whiteboard) : '',
          folder: folder ?? null,
        },
      });
      break;
    }
    case 'files:updateDocument': {
      const { _id, fileId, id, document } = args || {};
      const targetFileId = _id || fileId || id;
      if (!targetFileId) throw new Error("Missing file id. Pass `_id`, `fileId`, or `id`.");

      result = await casUpdateDocument(targetFileId, document);
      break;
    }
    case 'files:updateWhiteboard': {
      const { _id, fileId, id, whiteboard } = args || {};
      const targetFileId = _id || fileId || id;
      if (!targetFileId) throw new Error("Missing file id. Pass `_id`, `fileId`, or `id`.");

      result = await casUpdateWhiteboard(targetFileId, whiteboard);
      break;
    }
    case 'collabpro_update_document': {
      const {
        _id,
        fileId,
        document,
        baseDocument,
        conflictStrategy = 'merge',
        append = false
      } = args || {};
      const targetFileId = _id || fileId;
      if (!targetFileId) {
        throw new Error("Missing file id. Pass `_id` or `fileId`.");
      }
      if (document === undefined || document === null) {
        throw new Error("Missing `document` payload.");
      }

      const strategy: ConflictStrategy = ['reject', 'merge', 'overwrite'].includes(conflictStrategy) ? conflictStrategy : 'merge';
      const hasBase = baseDocument !== undefined;
      const normalizedIncomingDoc = asEditorDocument(document);
      const incomingDocString = asJsonString(normalizedIncomingDoc);
      const normalizedBaseString = hasBase ? asJsonString(asEditorDocument(baseDocument)) : undefined;

      let attempts = 0;
      while (attempts < 3) {
        attempts += 1;
        const file = await prisma.file.findUnique({
          where: { id: targetFileId },
          select: { id: true, document: true }
        });

        if (!file) {
          throw new HttpError(404, "File not found");
        }

        const currentDocString = file.document || asJsonString({ time: Date.now(), blocks: [], version: "2.8.1" });
        const conflictDetected = normalizedBaseString !== undefined && currentDocString !== normalizedBaseString;
        if (conflictDetected && strategy === 'reject') {
          result = {
            updated: false,
            conflict: true,
            tool: 'collabpro_update_document',
            resolution: 'rejected',
            currentDocument: parseJsonIfString(currentDocString)
          };
          break;
        }

        const currentDoc = asEditorDocument(currentDocString);
        const nextDoc = append || (conflictDetected && strategy === 'merge')
          ? mergeDocumentBlocks(currentDoc, normalizedIncomingDoc)
          : normalizedIncomingDoc;
        const nextDocString = asJsonString(nextDoc);

        const updated = await prisma.file.updateMany({
          where: { id: targetFileId, document: currentDocString },
          data: { document: nextDocString }
        });

        if (updated.count === 1) {
          await invalidateCachedFile(targetFileId);
          result = {
            updated: true,
            conflict: conflictDetected,
            tool: 'collabpro_update_document',
            resolution: conflictDetected ? (strategy === 'merge' ? 'merged' : 'overwritten') : (append ? 'appended' : 'updated'),
            document: nextDoc
          };
          break;
        }
      }

      if (!result) {
        throw new Error("Unable to update document due to concurrent updates. Please retry.");
      }
      break;
    }
    case 'collabpro_update_whiteboard': {
      const {
        _id,
        fileId,
        whiteboard,
        baseWhiteboard,
        conflictStrategy = 'merge',
        merge = true
      } = args || {};
      const targetFileId = _id || fileId;
      if (!targetFileId) {
        throw new Error("Missing file id. Pass `_id` or `fileId`.");
      }
      if (whiteboard === undefined || whiteboard === null) {
        throw new Error("Missing `whiteboard` payload.");
      }

      const strategy: ConflictStrategy = ['reject', 'merge', 'overwrite'].includes(conflictStrategy) ? conflictStrategy : 'merge';
      const hasBase = baseWhiteboard !== undefined;
      const normalizedIncomingElements = validateAndSanitizeWhiteboardElements(asWhiteboardElements(whiteboard));
      const incomingWhiteboardString = asJsonString(normalizedIncomingElements);
      const normalizedBaseString = hasBase ? asJsonString(asWhiteboardElements(baseWhiteboard)) : undefined;

      let attempts = 0;
      while (attempts < 3) {
        attempts += 1;
        const file = await prisma.file.findUnique({
          where: { id: targetFileId },
          select: { id: true, whiteboard: true }
        });

        if (!file) {
          throw new HttpError(404, "File not found");
        }

        const currentWhiteboardString = file.whiteboard || '[]';
        const conflictDetected = normalizedBaseString !== undefined && currentWhiteboardString !== normalizedBaseString;
        if (conflictDetected && strategy === 'reject') {
          result = {
            updated: false,
            conflict: true,
            tool: 'collabpro_update_whiteboard',
            resolution: 'rejected',
            currentWhiteboard: parseJsonIfString(currentWhiteboardString)
          };
          break;
        }

        const currentElements = asWhiteboardElements(currentWhiteboardString);
        const nextElements = merge || (conflictDetected && strategy === 'merge')
          ? mergeWhiteboardById(currentElements, normalizedIncomingElements)
          : normalizedIncomingElements;
        const nextWhiteboardString = asJsonString(nextElements);
        const nextText = extractTextFromWhiteboard(nextWhiteboardString);

        const updated = await prisma.file.updateMany({
          where: { id: targetFileId, whiteboard: currentWhiteboardString },
          data: { 
            whiteboard: nextWhiteboardString,
            whiteboardText: nextText
          }
        });

        if (updated.count === 1) {
          await invalidateCachedFile(targetFileId);
          result = {
            updated: true,
            conflict: conflictDetected,
            tool: 'collabpro_update_whiteboard',
            resolution: conflictDetected ? (strategy === 'merge' ? 'merged' : 'overwritten') : (merge ? 'merged' : 'updated'),
            whiteboard: nextElements
          };
          break;
        }
      }

      if (!result) {
        throw new Error("Unable to update whiteboard due to concurrent updates. Please retry.");
      }
      break;
    }
    case 'files:updateFileName': {
      const { _id, fileName } = args || {};
      result = await FileService.renameFile(_id, fileName);
      break;
    }
    case 'files:updateFileFolder': {
      const { _id, folder } = args || {};
      result = await FileService.moveFile(_id, folder);
      break;
    }
    case 'files:archiveFile': {
      const { _id, archive } = args || {};
      result = await FileService.archiveFile(_id, archive);
      break;
    }
    case 'files:deleteFile': {
      const { _id } = args || {};
      let fileRecord = null;
      if (prisma.file && typeof prisma.file.findUnique === 'function') {
        fileRecord = await prisma.file.findUnique({
          where: { id: _id },
        });
      }
      if (fileRecord) {
        await logAuditEvent(
          fileRecord.teamId,
          authUserEmail || "unknown@collabpro.com",
          "file:delete",
          { fileId: _id, fileName: fileRecord.fileName },
          ipAddress
        );
      }

      // Delete all file versions first
      await prisma.fileVersion.deleteMany({
        where: { fileId: _id },
      });
      await prisma.filePresence.deleteMany({
        where: { fileId: _id },
      });
      // Delete all shared links
      await prisma.sharedLink.deleteMany({
        where: { fileId: _id },
      });
      // Delete the file via unified FileService
      await FileService.deleteFile(_id);
      result = { success: true };
      break;
    }
    case 'files:createVersion': {
      const { fileId, createdByName, createdByImage, note } = args || {};
      const file = await prisma.file.findUnique({
        where: { id: fileId },
      });
      if (!file) {
        throw new HttpError(404, "File not found");
      }

      // Create the new checkpoint and prune old ones atomically so a file
      // never accumulates more than MAX_RETAINED_VERSIONS full document +
      // whiteboard blob snapshots (Issue 200).
      //
      // CONCURRENCY: the transaction makes one request's insert+prune atomic,
      // but under READ COMMITTED two concurrent createVersion calls for the
      // *same* file can both read "highest version is N" before either
      // commits, and both then try to insert N+1. The @@unique([fileId,
      // version]) constraint on FileVersion turns that race into a P2002
      // unique-violation on the loser instead of silently allowing duplicate
      // version numbers — retry with a freshly recomputed version number
      // until it succeeds (or we give up after a bounded number of tries).
      const MAX_VERSION_CONFLICT_RETRIES = 10;
      let attempt = 0;
      let created: any = null;
      while (true) {
        attempt += 1;
        try {
          created = await prisma.$transaction(async (tx) => {
            // Serialize concurrent createVersion calls for the *same* file so
            // the version-number race below can't be forced into exhausting
            // the bounded P2002 retries by sustained same-file contention
            // (e.g. 11+ concurrent checkpoints on one file). Different files
            // hash to different lock keys and proceed fully in parallel.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fileId}))`;

            // Find highest version. On a retry, this re-read happens inside a
            // fresh transaction/statement, so it sees whatever the previously
            // "winning" concurrent request just committed.
            const versions = await tx.fileVersion.findMany({
              where: { fileId },
              orderBy: { version: 'desc' },
              take: 1,
            });
            const nextVer = versions.length > 0 ? versions[0].version + 1 : 1;

            const createdRow = await tx.fileVersion.create({
              data: {
                fileId,
                document: file.document,
                whiteboard: file.whiteboard,
                version: nextVer,
                createdByName: createdByName || "Author",
                createdByImage: createdByImage || "",
                note: note || "",
              },
            });

            const keep = await tx.fileVersion.findMany({
              where: { fileId },
              orderBy: { version: 'desc' },
              take: MAX_RETAINED_VERSIONS,
              select: { id: true },
            });
            await tx.fileVersion.deleteMany({
              where: { fileId, id: { notIn: keep.map(v => v.id) } },
            });

            return createdRow;
          });
          break;
        } catch (err: unknown) {
          const isVersionConflict =
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002';
          if (isVersionConflict && attempt < MAX_VERSION_CONFLICT_RETRIES) {
            continue;
          }
          throw err;
        }
      }
      result = created;
      break;
    }
    case 'files:getVersions': {
      const { fileId, versionId, take, cursor } = args || {};

      if (versionId) {
        // Single-version fetch with the full document/whiteboard blobs, for
        // restore/preview. Not paginated — this is always exactly one row.
        //
        // SECURITY: the route-level access check (app/api/state-sync/route.ts)
        // authorizes the caller against `fileId` when it's present in args —
        // NOT against whichever file `versionId` actually belongs to. A
        // caller with legitimate access to file A could otherwise pair A's
        // fileId (which passes that check) with an unrelated file B's
        // versionId and read B's content. Scoping this query by fileId (when
        // supplied) closes that IDOR: a versionId that doesn't belong to the
        // requested file simply doesn't match, same as "not found". When
        // fileId is omitted, route.ts itself already resolves and checks
        // access against the version's real owning file before we get here,
        // so no additional constraint is needed in that case.
        result = await prisma.fileVersion.findFirst({
          where: { id: versionId, ...(fileId ? { fileId } : {}) },
        });
        if (!result) {
          throw new Error("Version not found");
        }
        break;
      }

      const pageSize = resolvePageSize(take);

      // Fetch one extra row to know whether another page exists, without a
      // separate count() query.
      const rows = await prisma.fileVersion.findMany({
        where: { fileId },
        orderBy: [{ version: 'desc' }],
        select: {
          id: true,
          version: true,
          createdAt: true,
          createdByName: true,
          createdByImage: true,
          note: true,
        },
        take: pageSize + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | null = null;
      if (rows.length > pageSize) {
        // The lookahead row only tells us a next page exists - discard it.
        // The cursor for the next page is the last row we're actually
        // returning, so the next request's `skip: 1` starts right after it.
        rows.pop();
        nextCursor = rows[rows.length - 1].id;
      }

      result = { items: rows, nextCursor };
      break;
    }
    case 'files:restoreVersion': {
      const { versionId } = args || {};
      const version = await prisma.fileVersion.findUnique({
        where: { id: versionId },
      });
      if (!version) {
        throw new Error("Version not found");
      }
      
      result = await prisma.file.update({
        where: { id: version.fileId },
        data: {
          document: version.document,
          whiteboard: version.whiteboard,
          whiteboardText: extractTextFromWhiteboard(version.whiteboard),
        },
      });
      if (version.fileId) {
        await invalidateCachedFile(version.fileId);
      }
      break;
    }
    case 'files:updateVersionNote': {
      const { versionId, note } = args || {};
      result = await prisma.fileVersion.update({
        where: { id: versionId },
        data: { note },
      });
      break;
    }
    case 'files:upsertPresence': {
      const { fileId, userEmail, userName, userImage, userColor, workspaceStatus } = args || {};
      if (!fileId || !userEmail) {
        throw new Error("fileId and userEmail are required for presence updates");
      }
      result = await prisma.filePresence.upsert({
        where: {
          fileId_userEmail: {
            fileId,
            userEmail,
          },
        },
        create: {
          fileId,
          userEmail,
          userName: userName || userEmail.split('@')[0] || "Collaborator",
          userImage: userImage || "",
          userColor: userColor || "#6366f1",
          workspaceStatus: workspaceStatus || "Viewing workspace",
        },
        update: {
          userName: userName || userEmail.split('@')[0] || "Collaborator",
          userImage: userImage || "",
          userColor: userColor || "#6366f1",
          workspaceStatus: workspaceStatus || "Viewing workspace",
          lastSeenAt: new Date(),
        },
      });
      break;
    }
    case 'files:clearPresence': {
      const { fileId, userEmail } = args || {};
      if (!fileId || !userEmail) {
        result = { success: false };
        break;
      }
      result = await prisma.filePresence.deleteMany({
        where: { fileId, userEmail },
      });
      break;
    }
    case 'files:getActiveCollaborators': {
      const { fileId, currentUserEmail } = args || {};
      if (!fileId) {
        result = [];
        break;
      }
      const activeSince = new Date(Date.now() - 15_000);
      result = await prisma.filePresence.findMany({
        where: {
          fileId,
          lastSeenAt: { gte: activeSince },
          ...(currentUserEmail ? { userEmail: { not: currentUserEmail } } : {}),
        },
        orderBy: { lastSeenAt: 'desc' },
      });
      break;
    }
    default:
      throw new Error(`Path ${path} not supported in fileService`);
  }

  return result;
}
