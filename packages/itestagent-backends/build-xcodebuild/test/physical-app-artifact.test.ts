import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  PhysicalAppArtifactError,
  normalizePhysicalAppArtifact,
} from '../src/physical-app-artifact.js';
import type { XcodebuildProcessRunner } from '../src/xcodebuild-process-types.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'itestagent-artifact-test-'));
  roots.push(root);
  return root;
}

function createApp(root: string, name = 'Example'): string {
  const appPath = join(root, `${name}.app`);
  mkdirSync(appPath, { recursive: true });
  writeFileSync(join(appPath, 'Info.plist'), '<plist/>');
  writeFileSync(join(appPath, name), 'binary');
  return appPath;
}

function successfulRunner(onExtract?: (destination: string) => void): XcodebuildProcessRunner {
  return async (cmd, args) => {
    if (cmd === '/usr/bin/zipinfo') {
      if (args[0] === '-t') {
        return {
          exitCode: 0,
          stdout: '3 files, 4096 bytes uncompressed, 1024 bytes compressed: 75.0%',
          stderr: '',
        };
      }
      return {
        exitCode: 0,
        stdout: 'Payload/\nPayload/Example.app/\nPayload/Example.app/Info.plist\n',
        stderr: '',
      };
    }
    if (cmd === '/usr/bin/ditto') {
      onExtract?.(args[3] as string);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (cmd === '/usr/bin/plutil') {
      const key = args[1];
      const values: Record<string, string> = {
        CFBundleIdentifier: 'com.example.app',
        CFBundleExecutable: 'Example',
        CFBundleSupportedPlatforms: '["iPhoneOS"]',
      };
      return { exitCode: 0, stdout: values[key as string] ?? '', stderr: '' };
    }
    if (cmd === '/usr/bin/lipo') {
      return { exitCode: 0, stdout: 'arm64', stderr: '' };
    }
    if (cmd === '/usr/bin/codesign') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: `Unexpected command ${cmd}` };
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('normalizePhysicalAppArtifact', () => {
  test('validates a physical .app bundle and records traceable facts', async () => {
    const root = makeRoot();
    const appPath = createApp(root);
    const artifact = await normalizePhysicalAppArtifact({
      sourcePath: appPath,
      normalizationRoot: join(root, 'normalized'),
      expectedBundleId: 'com.example.app',
      run: successfulRunner(),
    });

    expect(artifact.sourceKind).toBe('app');
    expect(artifact.bundleId).toBe('com.example.app');
    expect(artifact.supportedPlatforms).toEqual(['iPhoneOS']);
    expect(artifact.architectures).toContain('arm64');
    expect(artifact.signingValid).toBe(true);
  });

  test('extracts exactly one Payload app from an IPA before validation', async () => {
    const root = makeRoot();
    const ipaPath = join(root, 'Example.ipa');
    writeFileSync(ipaPath, 'archive');
    const artifact = await normalizePhysicalAppArtifact({
      sourcePath: ipaPath,
      normalizationRoot: join(root, 'normalized'),
      run: successfulRunner((destination) => {
        const appPath = createApp(join(destination, 'Payload'));
        expect(basename(appPath)).toBe('Example.app');
      }),
    });

    expect(artifact.sourceKind).toBe('ipa');
    expect(artifact.appPath).toContain('/Payload/Example.app');
  });

  test('rejects archive traversal before extracting an IPA', async () => {
    const root = makeRoot();
    const ipaPath = join(root, 'Unsafe.ipa');
    writeFileSync(ipaPath, 'archive');
    let extracted = false;
    const run: XcodebuildProcessRunner = async (cmd) => {
      if (cmd === '/usr/bin/zipinfo') {
        return { exitCode: 0, stdout: 'Payload/../escape\n', stderr: '' };
      }
      extracted = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const promise = normalizePhysicalAppArtifact({
      sourcePath: ipaPath,
      normalizationRoot: join(root, 'normalized'),
      run,
    });
    await expect(promise).rejects.toBeInstanceOf(PhysicalAppArtifactError);
    await expect(promise).rejects.toMatchObject({ code: 'ipa_unsafe_entry' });
    expect(extracted).toBe(false);
  });

  test('rejects symbolic-link archive entries before extraction', async () => {
    const root = makeRoot();
    const ipaPath = join(root, 'Symlink.ipa');
    writeFileSync(ipaPath, 'archive');
    let extracted = false;
    const run: XcodebuildProcessRunner = async (cmd, args) => {
      if (cmd === '/usr/bin/zipinfo' && args[0] === '-1') {
        return { exitCode: 0, stdout: 'Payload/Link.app\n', stderr: '' };
      }
      if (cmd === '/usr/bin/zipinfo' && args[0] === '-l') {
        return {
          exitCode: 0,
          stdout: 'lrwxr-xr-x  3.0 unx  12 bx  12 stor 26-Sep-01 Payload/Link.app',
          stderr: '',
        };
      }
      if (cmd === '/usr/bin/zipinfo' && args[0] === '-t') {
        return {
          exitCode: 0,
          stdout: '1 file, 12 bytes uncompressed, 12 bytes compressed: 0.0%',
          stderr: '',
        };
      }
      extracted = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(
      normalizePhysicalAppArtifact({
        sourcePath: ipaPath,
        normalizationRoot: join(root, 'normalized'),
        run,
      }),
    ).rejects.toMatchObject({ code: 'ipa_unsafe_entry' });
    expect(extracted).toBe(false);
  });

  test('rejects excessive IPA expansion before extraction', async () => {
    const root = makeRoot();
    const ipaPath = join(root, 'Bomb.ipa');
    writeFileSync(ipaPath, 'archive');
    let extracted = false;
    const run: XcodebuildProcessRunner = async (cmd, args) => {
      if (cmd === '/usr/bin/zipinfo' && args[0] === '-1') {
        return { exitCode: 0, stdout: 'Payload/Example.app/Info.plist\n', stderr: '' };
      }
      if (cmd === '/usr/bin/zipinfo' && args[0] === '-t') {
        return {
          exitCode: 0,
          stdout: '1 file, 2147483648 bytes uncompressed, 1024 bytes compressed: 99.9%',
          stderr: '',
        };
      }
      extracted = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(
      normalizePhysicalAppArtifact({
        sourcePath: ipaPath,
        normalizationRoot: join(root, 'normalized'),
        run,
      }),
    ).rejects.toMatchObject({ code: 'ipa_payload_invalid' });
    expect(extracted).toBe(false);
  });

  test('rejects simulator-only application artifacts', async () => {
    const root = makeRoot();
    const appPath = createApp(root);
    const base = successfulRunner();
    const run: XcodebuildProcessRunner = async (cmd, args, options) => {
      if (cmd === '/usr/bin/plutil' && args[1] === 'CFBundleSupportedPlatforms') {
        return { exitCode: 0, stdout: '["iPhoneSimulator"]', stderr: '' };
      }
      return base(cmd, args, options);
    };

    await expect(
      normalizePhysicalAppArtifact({
        sourcePath: appPath,
        normalizationRoot: join(root, 'normalized'),
        run,
      }),
    ).rejects.toMatchObject({ code: 'artifact_incompatible' });
  });

  test('rejects bundle ID mismatch and invalid signatures', async () => {
    const root = makeRoot();
    const appPath = createApp(root);
    await expect(
      normalizePhysicalAppArtifact({
        sourcePath: appPath,
        normalizationRoot: join(root, 'normalized'),
        expectedBundleId: 'com.other.app',
        run: successfulRunner(),
      }),
    ).rejects.toMatchObject({ code: 'artifact_incompatible' });

    const base = successfulRunner();
    const invalidSignatureRunner: XcodebuildProcessRunner = async (cmd, args, options) => {
      if (cmd === '/usr/bin/codesign') {
        return { exitCode: 1, stdout: '', stderr: 'invalid signature' };
      }
      return base(cmd, args, options);
    };
    await expect(
      normalizePhysicalAppArtifact({
        sourcePath: appPath,
        normalizationRoot: join(root, 'normalized'),
        run: invalidSignatureRunner,
      }),
    ).rejects.toMatchObject({ code: 'artifact_incompatible' });
  });
});
