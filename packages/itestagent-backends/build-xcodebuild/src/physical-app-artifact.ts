import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type { PhysicalAppArtifact, PhysicalPreflightFailureCode } from 'itestagent-contracts';
import type { XcodebuildProcessRunner } from './xcodebuild-process-types.js';

export class PhysicalAppArtifactError extends Error {
  constructor(
    readonly code: PhysicalPreflightFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'PhysicalAppArtifactError';
  }
}

export interface NormalizePhysicalAppArtifactInput {
  sourcePath: string;
  normalizationRoot: string;
  sourceKind?: PhysicalAppArtifact['sourceKind'];
  expectedBundleId?: string;
  run: XcodebuildProcessRunner;
}

function fail(code: PhysicalPreflightFailureCode, message: string): never {
  throw new PhysicalAppArtifactError(code, message);
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

function validateArchiveEntries(raw: string): void {
  const entries = raw.split(/\r?\n/u).filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    fail('ipa_payload_invalid', 'The IPA archive is empty.');
  }
  if (entries.length > 100_000) {
    fail('ipa_payload_invalid', `The IPA contains too many entries: ${entries.length}.`);
  }

  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (
      normalized.includes('\0') ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//u.test(normalized) ||
      segments.includes('..')
    ) {
      fail('ipa_unsafe_entry', `The IPA contains an unsafe archive entry: ${entry}`);
    }
  }
}

function validateArchiveMetadata(raw: string): void {
  if (raw.split(/\r?\n/u).some((line) => /^\s*l[rwx-]{9}\s/u.test(line))) {
    fail('ipa_unsafe_entry', 'The IPA contains a symbolic-link entry.');
  }
}

function findUniquePayloadApp(extractionRoot: string): string {
  const payloadPath = join(extractionRoot, 'Payload');
  if (!existsSync(payloadPath)) {
    fail('ipa_payload_invalid', 'The IPA does not contain a Payload directory.');
  }

  const apps = readdirSync(payloadPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => join(payloadPath, entry.name));
  if (apps.length !== 1) {
    fail(
      'ipa_payload_invalid',
      `The IPA must contain exactly one Payload/*.app bundle; found ${apps.length}.`,
    );
  }

  const resolvedRoot = realpathSync(extractionRoot);
  const resolvedApp = realpathSync(apps[0] as string);
  if (!isWithin(resolvedRoot, resolvedApp)) {
    fail('ipa_unsafe_entry', 'The IPA application bundle resolves outside the extraction root.');
  }

  return resolvedApp;
}

async function runRequired(
  run: XcodebuildProcessRunner,
  cmd: string,
  args: string[],
  code: PhysicalPreflightFailureCode,
  description: string,
): Promise<string> {
  const result = await run(cmd, args);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
    fail(code, `${description}: ${detail}`);
  }
  return result.stdout.trim();
}

async function readPlistValue(
  run: XcodebuildProcessRunner,
  infoPlistPath: string,
  key: string,
  format: 'raw' | 'json' = 'raw',
): Promise<string> {
  return runRequired(
    run,
    '/usr/bin/plutil',
    ['-extract', key, format, '-o', '-', infoPlistPath],
    'artifact_invalid',
    `Could not read ${key} from ${basename(infoPlistPath)}`,
  );
}

function parsePlatforms(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value;
    }
  } catch {
    // Classified below as an invalid artifact.
  }
  fail('artifact_invalid', 'CFBundleSupportedPlatforms is not a string array.');
}

/** Normalize an explicit .app/.ipa and prove it is installable on a physical iPhone. */
export async function normalizePhysicalAppArtifact(
  input: NormalizePhysicalAppArtifactInput,
): Promise<PhysicalAppArtifact> {
  const sourcePath = resolve(input.sourcePath);
  if (!existsSync(sourcePath)) {
    fail('app_source_unresolved', `Application source does not exist: ${sourcePath}`);
  }

  const sourceStat = lstatSync(sourcePath);
  const extension = extname(sourcePath).toLowerCase();
  let appPath: string;
  let inferredSourceKind: PhysicalAppArtifact['sourceKind'];

  if (sourceStat.isDirectory() && extension === '.app') {
    appPath = realpathSync(sourcePath);
    inferredSourceKind = 'app';
  } else if (sourceStat.isFile() && extension === '.ipa') {
    mkdirSync(input.normalizationRoot, { recursive: true });
    const archiveEntries = await runRequired(
      input.run,
      '/usr/bin/zipinfo',
      ['-1', sourcePath],
      'ipa_payload_invalid',
      'Could not inspect the IPA archive',
    );
    validateArchiveEntries(archiveEntries);
    const archiveMetadata = await runRequired(
      input.run,
      '/usr/bin/zipinfo',
      ['-l', sourcePath],
      'ipa_payload_invalid',
      'Could not inspect IPA entry metadata',
    );
    validateArchiveMetadata(archiveMetadata);

    const extractionRoot = mkdtempSync(join(resolve(input.normalizationRoot), 'itestagent-ipa-'));
    await runRequired(
      input.run,
      '/usr/bin/ditto',
      ['-x', '-k', sourcePath, extractionRoot],
      'ipa_payload_invalid',
      'Could not extract the IPA archive',
    );
    appPath = findUniquePayloadApp(extractionRoot);
    inferredSourceKind = 'ipa';
  } else {
    fail('artifact_invalid', 'Physical app source must be an .app directory or an .ipa file.');
  }

  const infoPlistPath = join(appPath, 'Info.plist');
  if (!existsSync(infoPlistPath)) {
    fail('artifact_invalid', 'The application bundle does not contain Info.plist.');
  }

  const [bundleId, executable, platformsRaw] = await Promise.all([
    readPlistValue(input.run, infoPlistPath, 'CFBundleIdentifier'),
    readPlistValue(input.run, infoPlistPath, 'CFBundleExecutable'),
    readPlistValue(input.run, infoPlistPath, 'CFBundleSupportedPlatforms', 'json'),
  ]);
  const supportedPlatforms = parsePlatforms(platformsRaw);
  if (!supportedPlatforms.includes('iPhoneOS')) {
    fail('artifact_incompatible', 'The application does not support the iPhoneOS platform.');
  }
  if (input.expectedBundleId !== undefined && bundleId !== input.expectedBundleId) {
    fail(
      'artifact_incompatible',
      `Application bundle ID ${bundleId} does not match expected bundle ID ${input.expectedBundleId}.`,
    );
  }

  const executablePath = join(appPath, executable);
  if (!existsSync(executablePath) || !isWithin(appPath, realpathSync(executablePath))) {
    fail('artifact_invalid', `Application executable is missing or unsafe: ${executable}`);
  }
  const architecturesRaw = await runRequired(
    input.run,
    '/usr/bin/lipo',
    ['-archs', executablePath],
    'artifact_invalid',
    'Could not inspect application architectures',
  );
  const architectures = architecturesRaw.split(/\s+/u).filter(Boolean);
  if (!architectures.includes('arm64')) {
    fail('artifact_incompatible', 'The application executable does not contain arm64.');
  }

  await runRequired(
    input.run,
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', appPath],
    'artifact_incompatible',
    'Application code signature verification failed',
  );

  return {
    sourceKind: input.sourceKind ?? inferredSourceKind,
    sourcePath,
    appPath,
    bundleId,
    executable,
    supportedPlatforms,
    architectures,
    signingValid: true,
  };
}
