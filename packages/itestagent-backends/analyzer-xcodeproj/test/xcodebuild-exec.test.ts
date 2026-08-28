import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  type SpawnSyncFn,
  XcodebuildError,
  findProjectFile,
  overrideSpawnSync,
  runList,
  runShowBuildSettings,
} from '../src/xcodebuild-exec';

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), 'utf-8');
}

function mockSpawn(fn: SpawnSyncFn) {
  overrideSpawnSync(fn);
}

function resetSpawn() {
  overrideSpawnSync(undefined);
}

function withTempProject(entries: string[], fn: (root: string) => void): void {
  const dir = mkdtempSync(resolve(tmpdir(), 'xcodebuild-exec-test-'));
  try {
    for (const entry of entries) {
      if (entry.endsWith('.xcworkspace') || entry.endsWith('.xcodeproj')) {
        mkdirSync(resolve(dir, entry), { recursive: true });
      } else {
        writeFileSync(resolve(dir, entry), '', 'utf-8');
      }
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('runList', () => {
  afterEach(() => {
    resetSpawn();
  });

  it('parses xcodebuild -list -json output', () => {
    const jsonOutput = readFixture('xcodebuild-list-json.json');

    mockSpawn((cmd) => {
      if (cmd === 'xcodebuild') {
        return { exitCode: 0, stdout: jsonOutput, stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: 'unknown command' };
    });

    const result = runList('/fake/project');

    expect(result.json).not.toBeNull();
    if (result.json) {
      expect(result.json.project.name).toBe('MyApp');
      expect(result.json.project.schemes).toContain('MyApp');
      expect(result.json.project.schemes).toContain('MyAppTests');
      expect(result.json.project.schemes).toContain('MyAppUITests');
      expect(result.json.project.configurations).toContain('Debug');
      expect(result.json.project.configurations).toContain('Release');
    }
  });

  it('falls back to text parsing when -json fails', () => {
    const textOutput = readFixture('xcodebuild-list-text.txt');

    mockSpawn((cmd, args) => {
      if (args?.includes('-json')) {
        return { exitCode: 1, stdout: '', stderr: 'unknown option' };
      }
      return { exitCode: 0, stdout: textOutput, stderr: '' };
    });

    const result = runList('/fake/project');

    expect(result.json).toBeNull();
    expect(result.text.schemes).toContain('MyApp');
    expect(result.text.configurations).toContain('Debug');
    expect(result.text.targets).toContain('MyApp');

    // Informational lines must not leak into the configurations array
    expect(result.text.configurations).not.toContain(
      expect.stringContaining('If no build configuration'),
    );
  });

  it('falls back to text parsing when -json exits 0 with unparseable stdout', () => {
    const textOutput = readFixture('xcodebuild-list-text.txt');

    mockSpawn((_cmd, args) => {
      if (args?.includes('-json')) {
        return { exitCode: 0, stdout: 'not-json-at-all', stderr: '' };
      }
      return { exitCode: 0, stdout: textOutput, stderr: '' };
    });

    const result = runList('/fake/project');

    expect(result.json).toBeNull();
    expect(result.text.schemes).toContain('MyApp');
  });

  it('falls back to text parsing when -json output lacks project.schemes', () => {
    const textOutput = readFixture('xcodebuild-list-text.txt');

    mockSpawn((_cmd, args) => {
      if (args?.includes('-json')) {
        return { exitCode: 0, stdout: JSON.stringify({ project: { name: 'MyApp' } }), stderr: '' };
      }
      return { exitCode: 0, stdout: textOutput, stderr: '' };
    });

    const result = runList('/fake/project');

    expect(result.json).toBeNull();
    expect(result.text.schemes).toContain('MyApp');
  });

  it('throws XcodebuildError when both JSON and text fail', () => {
    mockSpawn(() => ({ exitCode: 1, stdout: '', stderr: 'xcodebuild: error' }));

    expect(() => runList('/fake/project')).toThrow(XcodebuildError);
  });
});

describe('runShowBuildSettings', () => {
  afterEach(() => {
    resetSpawn();
  });

  it('parses xcodebuild -showBuildSettings output', () => {
    const settingsOutput = readFixture('showBuildSettings.txt');

    mockSpawn(() => ({
      exitCode: 0,
      stdout: settingsOutput,
      stderr: '',
    }));

    const result = runShowBuildSettings('/fake/project', 'MyApp', 'Debug');

    expect(result.settings.PRODUCT_BUNDLE_IDENTIFIER).toBe('com.example.MyApp');
    expect(result.settings.PRODUCT_NAME).toBe('MyApp');
    expect(result.settings.IPHONEOS_DEPLOYMENT_TARGET).toBe('16.0');
    expect(result.settings.SWIFT_VERSION).toBe('5.0');
    expect(result.settings.ARCHS).toBe('arm64');
    expect(result.settings.INFOPLIST_FILE).toBe('MyApp/Info.plist');
  });

  it('throws XcodebuildError on failure', () => {
    mockSpawn(() => ({
      exitCode: 65,
      stdout: '',
      stderr: 'xcodebuild: error: Unable to find a target named "NoTarget"',
    }));

    expect(() => runShowBuildSettings('/fake/project', 'NoTarget')).toThrow(XcodebuildError);
  });

  it('passes -project for a directory containing only an .xcodeproj', () => {
    withTempProject(['MyApp.xcodeproj'], (root) => {
      let seenArgs: string[] = [];
      mockSpawn((_cmd, args) => {
        seenArgs = args ?? [];
        return { exitCode: 1, stdout: '', stderr: 'stop early' };
      });

      expect(() => runShowBuildSettings(root, 'MyApp')).toThrow(XcodebuildError);
      expect(seenArgs).toContain('-project');
      expect(seenArgs).not.toContain('-workspace');
      expect(seenArgs).toContain(resolve(root, 'MyApp.xcodeproj'));
    });
  });

  it('passes -workspace for a directory containing an .xcworkspace', () => {
    withTempProject(['MyApp.xcworkspace'], (root) => {
      let seenArgs: string[] = [];
      mockSpawn((_cmd, args) => {
        seenArgs = args ?? [];
        return { exitCode: 1, stdout: '', stderr: 'stop early' };
      });

      expect(() => runShowBuildSettings(root, 'MyApp')).toThrow(XcodebuildError);
      expect(seenArgs).toContain('-workspace');
      expect(seenArgs).not.toContain('-project');
      expect(seenArgs).toContain(resolve(root, 'MyApp.xcworkspace'));
    });
  });

  it('keeps the full value when a setting value itself contains "="', () => {
    const settingsOutput = [
      'Build settings from command line:',
      '    OTHER_LDFLAGS = -framework "Foo=Bar"',
      '    PRODUCT_BUNDLE_IDENTIFIER = com.example.MyApp',
      '',
    ].join('\n');

    mockSpawn(() => ({ exitCode: 0, stdout: settingsOutput, stderr: '' }));

    const result = runShowBuildSettings('/fake/project', 'MyApp');
    expect(result.settings.OTHER_LDFLAGS).toBe('-framework "Foo=Bar"');
    expect(result.settings.PRODUCT_BUNDLE_IDENTIFIER).toBe('com.example.MyApp');
  });
});

describe('findProjectFile', () => {
  it('returns null for non-existent directory', () => {
    const result = findProjectFile('/non/existent/path/12345');
    expect(result).toBeNull();
  });

  it('returns null for a directory with no Xcode project entries', () => {
    withTempProject(['README.md', 'Sources'], (root) => {
      expect(findProjectFile(root)).toBeNull();
    });
  });

  it('detects a standalone .xcodeproj', () => {
    withTempProject(['MyApp.xcodeproj'], (root) => {
      const result = findProjectFile(root);
      expect(result?.type).toBe('xcode_project');
      expect(result?.path).toBe(resolve(root, 'MyApp.xcodeproj'));
    });
  });

  it('prefers .xcworkspace over .xcodeproj when both exist', () => {
    withTempProject(['MyApp.xcworkspace', 'MyApp.xcodeproj'], (root) => {
      const result = findProjectFile(root);
      expect(result?.type).toBe('xcode_workspace');
      expect(result?.path).toBe(resolve(root, 'MyApp.xcworkspace'));
    });
  });
});
