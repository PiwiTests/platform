import { describe, test, expect } from 'vitest';
import {
  buildJetbrainsHttpUrl,
  buildJetbrainsNavigateUrl,
  buildVscodeUrl,
  encodePathForUrl,
  joinWorkspacePath,
  parseLocation,
  VSCODE_CLI_COMMANDS,
} from '../../app/utils/ide-links';

describe('joinWorkspacePath', () => {
  test('joins a root and a relative path', () => {
    expect(joinWorkspacePath('/home/me/repo', 'tests/a.spec.ts')).toBe('/home/me/repo/tests/a.spec.ts');
  });

  test('trims a trailing slash on the root', () => {
    expect(joinWorkspacePath('/home/me/repo/', 'tests/a.spec.ts')).toBe('/home/me/repo/tests/a.spec.ts');
  });

  test('strips a leading ./ or / on the relative path', () => {
    expect(joinWorkspacePath('/root', './tests/a.spec.ts')).toBe('/root/tests/a.spec.ts');
    expect(joinWorkspacePath('/root', '/tests/a.spec.ts')).toBe('/root/tests/a.spec.ts');
  });

  test('normalizes backslashes on a Windows relative path', () => {
    expect(joinWorkspacePath('C:\\repo', 'tests\\a.spec.ts')).toBe('C:/repo/tests/a.spec.ts');
  });

  test('returns the relative path unchanged when the root is empty', () => {
    expect(joinWorkspacePath('', 'tests/a.spec.ts')).toBe('tests/a.spec.ts');
  });
});

describe('encodePathForUrl', () => {
  test('encodes spaces but keeps slashes and the drive colon', () => {
    expect(encodePathForUrl('C:/my repo/a.ts')).toBe('C:/my%20repo/a.ts');
  });

  test('encodes % first so it is not double-encoded', () => {
    expect(encodePathForUrl('/a%b/c#d?e')).toBe('/a%25b/c%23d%3Fe');
  });
});

describe('buildVscodeUrl', () => {
  test('builds a Unix absolute path with line and column', () => {
    expect(buildVscodeUrl({ scheme: 'vscode', absPath: '/home/me/repo/tests/a.spec.ts', line: 12, column: 3 })).toBe(
      'vscode://file/home/me/repo/tests/a.spec.ts:12:3',
    );
  });

  test('preserves the Windows drive colon and adds one slash after file', () => {
    expect(buildVscodeUrl({ scheme: 'vscode', absPath: 'C:\\repo\\tests\\a.spec.ts', line: 5 })).toBe(
      'vscode://file/C:/repo/tests/a.spec.ts:5',
    );
  });

  test('omits the position when no line is given', () => {
    expect(buildVscodeUrl({ scheme: 'cursor', absPath: '/repo/a.ts' })).toBe('cursor://file/repo/a.ts');
  });

  test('omits the column when only a line is given', () => {
    expect(buildVscodeUrl({ scheme: 'vscode-insiders', absPath: '/repo/a.ts', line: 9 })).toBe(
      'vscode-insiders://file/repo/a.ts:9',
    );
  });

  test('encodes a space in the path', () => {
    expect(buildVscodeUrl({ scheme: 'vscode', absPath: '/my repo/a.ts', line: 1 })).toBe(
      'vscode://file/my%20repo/a.ts:1',
    );
  });
});

describe('buildJetbrainsNavigateUrl', () => {
  test('puts line and column inside the path value', () => {
    expect(
      buildJetbrainsNavigateUrl({
        product: 'idea',
        projectName: 'my-app',
        relPath: 'tests/a.spec.ts',
        line: 12,
        column: 3,
      }),
    ).toBe('jetbrains://idea/navigate/reference?project=my-app&path=tests/a.spec.ts:12:3');
  });

  test('encodes a project name with a space', () => {
    expect(buildJetbrainsNavigateUrl({ product: 'webstorm', projectName: 'My App', relPath: 'a.ts' })).toBe(
      'jetbrains://webstorm/navigate/reference?project=My%20App&path=a.ts',
    );
  });
});

describe('buildJetbrainsHttpUrl', () => {
  test('builds an endpoint on the default port with a double slash for an absolute path', () => {
    expect(buildJetbrainsHttpUrl({ port: 63342, path: '/home/me/repo/a.ts', line: 4, column: 2 })).toBe(
      'http://localhost:63342/api/file//home/me/repo/a.ts:4:2',
    );
  });

  test('honors a custom port', () => {
    expect(buildJetbrainsHttpUrl({ port: 63350, path: 'tests/a.ts', line: 7 })).toBe(
      'http://localhost:63350/api/file/tests/a.ts:7',
    );
  });
});

describe('VSCODE_CLI_COMMANDS', () => {
  test('maps each flavor to the command it installs on the PATH', () => {
    expect(VSCODE_CLI_COMMANDS).toEqual({
      vscode: 'code',
      'vscode-insiders': 'code-insiders',
      vscodium: 'codium',
      cursor: 'cursor',
    });
  });
});

describe('parseLocation (re-exported)', () => {
  test('parses filePath:line:column', () => {
    expect(parseLocation('tests/login.spec.ts:12:5')).toEqual({
      filePath: 'tests/login.spec.ts',
      line: 12,
      column: 5,
    });
  });

  test('handles a Windows path with a drive letter', () => {
    expect(parseLocation('C:\\repo\\tests\\login.spec.ts:10:5')).toEqual({
      filePath: 'C:\\repo\\tests\\login.spec.ts',
      line: 10,
      column: 5,
    });
  });
});
