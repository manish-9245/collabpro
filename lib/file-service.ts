import { prisma } from './db';
import { getCachedFile, invalidateCachedFile } from './redis-cache';
import { decodeCrdtState } from './crdt';

/**
 * Extracts indexable search string terms from CRDT encoded whiteboard canvases
 */
export function extractTextFromWhiteboard(whiteboard: string | null | undefined): string {
  if (!whiteboard) return "";
  try {
    const decoded = decodeCrdtState(whiteboard, []);
    let elements: any[] = [];
    if (Array.isArray(decoded)) {
      elements = decoded;
    } else if (decoded && typeof decoded === 'object') {
      if (Array.isArray((decoded as any).elements)) {
        elements = (decoded as any).elements;
      } else {
        elements = Object.values(decoded);
      }
    }

    const textParts: string[] = [];
    for (const elem of elements) {
      if (elem && typeof elem === 'object') {
        if (elem.type === 'text' && typeof elem.text === 'string' && elem.text.trim()) {
          textParts.push(elem.text.trim());
        }
      }
    }
    return textParts.join(" ");
  } catch (error) {
    console.error("[extractTextFromWhiteboard] error:", error);
    return "";
  }
}

/**
 * A highly unified, deep service module encapsulating all File database updates, 
 * whiteboard content validations, and cache invalidation triggers behind a single seam.
 * Provides maximum leverage and locality to eliminate duplicate invalidation blocks.
 */
export class FileService {
  /**
   * Fetches a file via Cache-Aside strategy
   */
  static async getFile(fileId: string): Promise<any> {
    return getCachedFile(fileId);
  }

  /**
   * General file updater: automatically invalidates the Redis cache entry on successful database write
   */
  static async updateFile(fileId: string, data: any): Promise<any> {
    const updateData = { ...data };
    
    // Automatically extract text index from whiteboard payload if updating canvas
    if ('whiteboard' in updateData) {
      updateData.whiteboardText = extractTextFromWhiteboard(updateData.whiteboard);
    }

    const result = await prisma.file.update({
      where: { id: fileId },
      data: updateData,
    });

    // Enforce transactional invalidation immediately at the database boundary
    await invalidateCachedFile(fileId);

    return result;
  }

  /**
   * Renames a file cleanly
   */
  static async renameFile(fileId: string, fileName: string): Promise<any> {
    return this.updateFile(fileId, { fileName });
  }

  /**
   * Moves a file into a folder (or root if null)
   */
  static async moveFile(fileId: string, folder: string | null): Promise<any> {
    return this.updateFile(fileId, { folder: folder || null });
  }

  /**
   * Archives or restores a file
   */
  static async archiveFile(fileId: string, archive: boolean): Promise<any> {
    return this.updateFile(fileId, { archive });
  }

  /**
   * Deletes a file and invalidates its cache entry
   */
  static async deleteFile(fileId: string): Promise<void> {
    if (prisma.file && typeof prisma.file.delete === 'function') {
      await prisma.file.delete({
        where: { id: fileId },
      });
    }
    await invalidateCachedFile(fileId);
  }
}
