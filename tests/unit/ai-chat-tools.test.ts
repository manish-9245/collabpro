import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAiChatTool } from '@/lib/ai-chat-tools';

const mockFileFindUnique = vi.fn();
const mockFileUpdateMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      updateMany: (...args: any[]) => mockFileUpdateMany(...args),
    },
  },
}));

vi.mock('@/lib/redis-cache', () => ({
  invalidateCachedFile: vi.fn(),
}));

const fakePrisma = {
  file: {
    findUnique: (...args: any[]) => mockFileFindUnique(...args),
    updateMany: (...args: any[]) => mockFileUpdateMany(...args),
  },
} as any;

describe('lib/ai-chat-tools executeAiChatTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('update_document', () => {
    it('appends new blocks to the existing document by default', async () => {
      mockFileFindUnique
        .mockResolvedValueOnce({ document: JSON.stringify({ time: 1, blocks: [{ id: 'a', type: 'paragraph', data: { text: 'existing' } }] }) })
        .mockResolvedValueOnce({ document: JSON.stringify({ time: 1, blocks: [{ id: 'a', type: 'paragraph', data: { text: 'existing' } }] }) });
      mockFileUpdateMany.mockResolvedValueOnce({ count: 1 });

      const result = await executeAiChatTool(
        'update_document',
        JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: 'new block' } }] }),
        { prisma: fakePrisma, fileId: 'file-1' }
      );

      expect(result.summary).toContain('Added');
      expect(mockFileUpdateMany).toHaveBeenCalled();
      const savedDoc = JSON.parse(mockFileUpdateMany.mock.calls[0][0].data.document);
      expect(savedDoc.blocks).toHaveLength(2);
      expect(savedDoc.blocks[0].data.text).toBe('existing');
      expect(savedDoc.blocks[1].data.text).toBe('new block');
    });

    it('replace mode overwrites the document entirely', async () => {
      mockFileFindUnique.mockResolvedValueOnce({ document: JSON.stringify({ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'old' } }] }) });
      mockFileUpdateMany.mockResolvedValueOnce({ count: 1 });

      await executeAiChatTool(
        'update_document',
        JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: 'only this' } }], mode: 'replace' }),
        { prisma: fakePrisma, fileId: 'file-1' }
      );

      const savedDoc = JSON.parse(mockFileUpdateMany.mock.calls[0][0].data.document);
      expect(savedDoc.blocks).toEqual([{ type: 'paragraph', data: { text: 'only this' } }]);
    });

    it('rejects empty blocks array', async () => {
      await expect(
        executeAiChatTool('update_document', JSON.stringify({ blocks: [] }), { prisma: fakePrisma, fileId: 'file-1' })
      ).rejects.toThrow(/non-empty array/);
    });
  });

  describe('update_whiteboard', () => {
    it('rejects overlapping shapes with the same guardrail as the MCP tool', async () => {
      await expect(
        executeAiChatTool(
          'update_whiteboard',
          JSON.stringify({
            elements: [
              { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
              { id: 'b', type: 'rectangle', x: 50, y: 50, width: 100, height: 100 },
            ],
          }),
          { prisma: fakePrisma, fileId: 'file-1' }
        )
      ).rejects.toThrow(/overlap/);
      expect(mockFileUpdateMany).not.toHaveBeenCalled();
    });

    it('append mode sends an isDelta envelope so existing elements are preserved', async () => {
      mockFileFindUnique.mockResolvedValueOnce({ whiteboard: JSON.stringify({ elements: [{ id: 'existing', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 }] }) });
      mockFileUpdateMany.mockResolvedValueOnce({ count: 1 });

      const result = await executeAiChatTool(
        'update_whiteboard',
        JSON.stringify({ elements: [{ id: 'new', type: 'rectangle', x: 200, y: 0, width: 50, height: 50 }] }),
        { prisma: fakePrisma, fileId: 'file-1' }
      );

      expect(result.summary).toContain('Added');
      const savedBoard = JSON.parse(mockFileUpdateMany.mock.calls[0][0].data.whiteboard);
      const ids = savedBoard.elements.map((e: any) => e.id);
      expect(ids).toContain('existing');
      expect(ids).toContain('new');
    });

    it('unknown tool name throws', async () => {
      await expect(
        executeAiChatTool('delete_everything', '{}', { prisma: fakePrisma, fileId: 'file-1' })
      ).rejects.toThrow(/Unknown tool/);
    });
  });
});
