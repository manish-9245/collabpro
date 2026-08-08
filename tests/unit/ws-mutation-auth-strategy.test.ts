import { describe, it, expect } from 'vitest';
import { resolveMutationAuthStrategy } from '../../ws-server/file-access';

// Issue #234 regression: an earlier version of this logic checked
// `args._id || args.fileId` *before* special-casing `files:createFile`. That
// let a WS caller send `path: 'files:createFile'` with an `_id`/`fileId` for
// a file they legitimately have access to - the existing-file auth check
// passed for THAT file, then execution fell through into creating a new
// file under a completely different, never-checked `args.teamId`. Cubic
// caught this on the PR that introduced the fix; these cases pin the
// corrected precedence down.
describe('resolveMutationAuthStrategy (issue #234 regression — createFile team-check bypass)', () => {
  it('always routes files:createFile through the team check, even when args carries an _id for an accessible file', () => {
    const strategy = resolveMutationAuthStrategy('files:createFile', {
      _id: 'some-file-i-can-already-access',
      teamId: 'team-i-am-not-a-member-of',
    });
    expect(strategy).toEqual({ type: 'team', teamId: 'team-i-am-not-a-member-of' });
  });

  it('always routes files:createFile through the team check, even when args carries a fileId for an accessible file', () => {
    const strategy = resolveMutationAuthStrategy('files:createFile', {
      fileId: 'some-file-i-can-already-access',
      teamId: 'team-i-am-not-a-member-of',
    });
    expect(strategy).toEqual({ type: 'team', teamId: 'team-i-am-not-a-member-of' });
  });

  it('routes files:updateDocument (and other existing-row mutations) through the existing-file check', () => {
    expect(resolveMutationAuthStrategy('files:updateDocument', { _id: 'file-1' })).toEqual({
      type: 'existing',
      targetId: 'file-1',
    });
    expect(resolveMutationAuthStrategy('files:updateWhiteboard', { fileId: 'file-2' })).toEqual({
      type: 'existing',
      targetId: 'file-2',
    });
  });

  it('falls back to no auth strategy when neither createFile nor a target id applies', () => {
    expect(resolveMutationAuthStrategy('files:updateFileName', {})).toEqual({ type: 'none' });
  });
});
