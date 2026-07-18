import { prisma } from '@/lib/db';
import { validateAndSanitizeWhiteboardElements } from '@/lib/canvas-validation';
import { getCachedFile, invalidateCachedFile } from '@/lib/redis-cache';
import { logAuditEvent } from '@/lib/audit';
import { FileService, extractTextFromWhiteboard } from '@/lib/file-service';
import {
  asJsonString,
  parseJsonIfString,
  asEditorDocument,
  asWhiteboardElements,
  mergeDocumentBlocks,
  mergeWhiteboardById,
  ConflictStrategy,
} from './helpers';
import * as Y from 'yjs';

function mergeWhiteboardPayloads(currentStr: string, incomingStr: string): string {
  try {
    const currentParsed = parseJsonIfString(currentStr);
    const incomingParsed = parseJsonIfString(incomingStr);

    if (currentParsed && typeof currentParsed === 'object' && (currentParsed as any).yjs && (currentParsed as any).data && 
        incomingParsed && typeof incomingParsed === 'object' && (incomingParsed as any).yjs && (incomingParsed as any).data) {
      const currentUpdate = Buffer.from((currentParsed as any).data, 'base64');
      const incomingUpdate = Buffer.from((incomingParsed as any).data, 'base64');
      const mergedUpdate = Y.mergeUpdates([new Uint8Array(currentUpdate), new Uint8Array(incomingUpdate)]);
      const base64 = Buffer.from(mergedUpdate).toString('base64');
      return JSON.stringify({
        yjs: true,
        data: base64
      });
    }
  } catch (e) {
    // Fallback to elements-based merge
  }

  try {
    const currentElements = asWhiteboardElements(currentStr || '[]');
    const incomingElements = asWhiteboardElements(incomingStr);
    const mergedElements = mergeWhiteboardById(currentElements, incomingElements);
    return JSON.stringify(mergedElements);
  } catch (e) {
    return incomingStr;
  }
}

interface DebounceEntry {
  timer: NodeJS.Timeout | null;
  mergedData: any;
  resolves: ((val: any) => void)[];
  rejects: ((err: any) => void)[];
}

const debouncedWrites = new Map<string, DebounceEntry>();

async function debounceWrite(
  key: string,
  data: any,
  mergeFn: (curr: any, inc: any) => any,
  writeFn: (finalData: any) => Promise<any>,
  delay = 50,
  initialValue: any = null
): Promise<any> {
  return new Promise((resolve, reject) => {
    const existing = debouncedWrites.get(key);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      existing.mergedData = mergeFn(existing.mergedData, data);
      existing.resolves.push(resolve);
      existing.rejects.push(reject);
      
      existing.timer = setTimeout(async () => {
        debouncedWrites.delete(key);
        try {
          const result = await writeFn(existing.mergedData);
          existing.resolves.forEach(res => res(result));
        } catch (err) {
          existing.rejects.forEach(rej => rej(err));
        }
      }, delay);
    } else {
      const seededData = initialValue !== null ? mergeFn(initialValue, data) : data;
      const entry: DebounceEntry = {
        timer: null,
        mergedData: seededData,
        resolves: [resolve],
        rejects: [reject]
      };
      
      entry.timer = setTimeout(async () => {
        debouncedWrites.delete(key);
        try {
          const result = await writeFn(entry.mergedData);
          entry.resolves.forEach(res => res(result));
        } catch (err) {
          entry.rejects.forEach(rej => rej(err));
        }
      }, delay);
      
      debouncedWrites.set(key, entry);
    }
  });
}

export async function handleFileService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  let result: any = null;

  switch (path) {
    case 'files:getFiles': {
      const { teamId, userEmail, scope } = args || {};
      let files = [];
      
      if (scope === 'org' && userEmail) {
        // Get all teams the user is member or creator of
        const createdTeams = await prisma.team.findMany({
          where: { createdBy: userEmail },
        });
        const memberships = await prisma.teamMember.findMany({
          where: { userEmail },
        });
        const memberTeamIds = memberships.map(m => m.teamId);
        const allTeamIds = [...createdTeams.map(t => t.id), ...memberTeamIds];
        
        files = await prisma.file.findMany({
          where: { teamId: { in: allTeamIds } },
          orderBy: { createdAt: 'desc' },
        });
      } else if (scope === 'personal' && userEmail) {
        files = await prisma.file.findMany({
          where: { teamId, createdBy: userEmail },
          orderBy: { createdAt: 'desc' },
        });
      } else {
        // Default: team scope
        files = await prisma.file.findMany({
          where: { teamId },
          orderBy: { createdAt: 'desc' },
        });
      }

      // Fetch user profiles for all file creators to attach real avatar and name
      const creatorEmails = Array.from(new Set(files.map(f => f.createdBy)));
      const users = await prisma.user.findMany({
        where: { email: { in: creatorEmails } },
      });
      
      const userMap = new Map(users.map(u => [u.email, u]));

      // Fetch team details to map teamId to teamName
      const teamIds = Array.from(new Set(files.map(f => f.teamId)));
      const teams = await prisma.team.findMany({
        where: { id: { in: teamIds } },
      });
      const teamMap = new Map(teams.map(t => [t.id, t]));
      
      result = files.map(file => {
        const creator = userMap.get(file.createdBy);
        const team = teamMap.get(file.teamId);
        return {
          ...file,
          creatorName: creator?.name || file.createdBy.split('@')[0],
          creatorImage: creator?.image || null,
          teamName: team?.teamName || null
        };
      });
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

      const file = await prisma.file.findUnique({
        where: { id: targetFileId },
        select: { document: true }
      });
      const currentDocStr = file ? file.document : '';

      result = await debounceWrite(`doc:${targetFileId}`, document, (curr, inc) => {
        try {
          return JSON.stringify(mergeDocumentBlocks(asEditorDocument(curr || '{"blocks":[]}'), asEditorDocument(inc)));
        } catch {
          return inc;
        }
      }, async (finalDoc) => {
        return FileService.updateFile(targetFileId, { document: finalDoc });
      }, 50, currentDocStr);
      break;
    }
    case 'files:updateWhiteboard': {
      const { _id, fileId, id, whiteboard } = args || {};
      const targetFileId = _id || fileId || id;
      if (!targetFileId) throw new Error("Missing file id. Pass `_id`, `fileId`, or `id`.");

      const file = await prisma.file.findUnique({
        where: { id: targetFileId },
        select: { whiteboard: true }
      });
      const currentWhiteboardStr = file ? file.whiteboard : '[]';

      result = await debounceWrite(`whiteboard:${targetFileId}`, whiteboard, (curr, inc) => {
        try {
          const parsedIncoming = parseJsonIfString(inc);
          if (parsedIncoming && typeof parsedIncoming === 'object' && (parsedIncoming as any).isDelta) {
            const delta = parsedIncoming as any;
            const updated = Array.isArray(delta.updated) ? delta.updated : [];
            const deleted = Array.isArray(delta.deleted) ? delta.deleted : [];

            const currentElements = asWhiteboardElements(curr || '[]');
            const currentMap = new Map<string, any>();
            currentElements.forEach((el: any) => { if (el && el.id) currentMap.set(el.id, el); });
            
            deleted.forEach((id: string) => { currentMap.delete(id); });
            updated.forEach((el: any) => { if (el && el.id) currentMap.set(el.id, el); });

            return JSON.stringify(Array.from(currentMap.values()));
          } else {
            return mergeWhiteboardPayloads(curr || '[]', inc);
          }
        } catch (e) {
          return inc;
        }
      }, async (finalWhiteboard) => {
        return FileService.updateFile(targetFileId, { whiteboard: finalWhiteboard });
      }, 50, currentWhiteboardStr);
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
          throw new Error("File not found");
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
          throw new Error("File not found");
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
        throw new Error("File not found");
      }
      
      // Find highest version
      const versions = await prisma.fileVersion.findMany({
        where: { fileId },
        orderBy: { version: 'desc' },
        take: 1,
      });
      const nextVer = versions.length > 0 ? versions[0].version + 1 : 1;

      result = await prisma.fileVersion.create({
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
      break;
    }
    case 'files:getVersions': {
      const { fileId } = args || {};
      result = await prisma.fileVersion.findMany({
        where: { fileId },
        orderBy: { createdAt: 'desc' },
      });
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
