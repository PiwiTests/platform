import { describe, it, expect } from 'vitest';
import { detectScmHost, commitUrl, compareUrl, fileUrl, branchUrl } from '#shared/scm-urls';

describe('scm-urls', () => {
  it('detects the host from the repository URL', () => {
    expect(detectScmHost('https://github.com/acme/web')).toBe('github');
    expect(detectScmHost('https://gitlab.example.com/acme/web')).toBe('gitlab');
    expect(detectScmHost('https://bitbucket.org/acme/web')).toBe('bitbucket');
    expect(detectScmHost('https://git.acme.internal/acme/web')).toBeNull();
    expect(detectScmHost(null)).toBeNull();
    expect(detectScmHost('not a url')).toBeNull();
  });

  it('builds provider-specific commit URLs', () => {
    expect(commitUrl('https://github.com/acme/web', 'abc123')).toBe('https://github.com/acme/web/commit/abc123');
    expect(commitUrl('https://gitlab.com/acme/web', 'abc123')).toBe('https://gitlab.com/acme/web/-/commit/abc123');
    expect(commitUrl('https://bitbucket.org/acme/web', 'abc123')).toBe('https://bitbucket.org/acme/web/commits/abc123');
    // A trailing slash never doubles up.
    expect(commitUrl('https://github.com/acme/web/', 'abc123')).toBe('https://github.com/acme/web/commit/abc123');
    expect(commitUrl(null, 'abc123')).toBeNull();
    expect(commitUrl('https://example.com/acme/web', 'abc123')).toBeNull();
  });

  it('builds compare, file and branch URLs', () => {
    expect(compareUrl('https://github.com/acme/web', 'a', 'b')).toBe('https://github.com/acme/web/compare/a...b');
    expect(compareUrl('https://bitbucket.org/acme/web', 'a', 'b')).toBe(
      'https://bitbucket.org/acme/web/branches/compare/b..a#diff',
    );
    expect(fileUrl('https://github.com/acme/web', 'main', 'src/a.ts', 12)).toBe(
      'https://github.com/acme/web/blob/main/src/a.ts#L12',
    );
    expect(fileUrl('https://gitlab.com/acme/web', 'main', '/src/a.ts')).toBe(
      'https://gitlab.com/acme/web/-/blob/main/src/a.ts',
    );
    expect(branchUrl('https://github.com/acme/web', 'feat/x')).toBe('https://github.com/acme/web/tree/feat%2Fx');
  });
});
