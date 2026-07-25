import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import { logger } from '@/lib/logger';
import { parseChangelog, loadChangelog } from '@/lib/release-notes';

describe('parseChangelog', () => {
  it('parses a minimal changelog into structured releases', () => {
    const md = [
      '# Releases',
      '',
      '## [1.0.0] - 2026-01-01',
      'Initial release.',
      '',
      '### New Capabilities',
      '- Did a thing',
      '',
    ].join('\n');

    const result = parseChangelog(md);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('1.0.0');
    expect(result[0].date).toBe('2026-01-01');
    expect(result[0].sections[0].items).toContain('Did a thing');
  });
});

describe('loadChangelog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and parses the real CHANGELOG.md checked into the project root', () => {
    // Regression guard for the Docker image shipping without CHANGELOG.md
    // (it was previously listed in .dockerignore, which made /releases
    // render with no content in production). This asserts against the
    // real file at the real project root, the same way app/releases/page.tsx
    // resolves it via process.cwd().
    const projectRoot = path.resolve(__dirname, '../../');
    const releases = loadChangelog(projectRoot);

    expect(releases.length).toBeGreaterThan(0);
    expect(releases[0]).toHaveProperty('version');
    expect(releases[0]).toHaveProperty('sections');
  });

  it('logs an error and returns an empty array instead of silently producing empty content when the file is missing', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const releases = loadChangelog('/definitely/does/not/exist/on/this/machine');

    expect(releases).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/CHANGELOG\.md/i);
  });
});
