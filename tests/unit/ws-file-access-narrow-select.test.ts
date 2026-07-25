import { describe, it, expect, vi } from 'vitest';
import { hasFileAccess } from '../../ws-server/file-access';

// Group 5 #4 (review round 2, P3): teamMember.findFirst() fetched the whole
// row just to check existence (`return !!teamMember`). Narrow the select.
describe('hasFileAccess teamMember lookup selects only what it needs', () => {
  it('does not select the full teamMember row', async () => {
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com', teamId: 'team-1' });
    const findFirst = vi.fn().mockResolvedValue({ userEmail: 'member@test.com' });
    const prismaClient = { file: { findUnique }, teamMember: { findFirst } };

    await hasFileAccess(prismaClient as any, 'file-1', 'member@test.com');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.any(Object) })
    );
    const callArgs = findFirst.mock.calls[0][0];
    expect(callArgs.select).not.toHaveProperty('id');
    expect(callArgs.select).not.toHaveProperty('joinedAt');
  });
});
