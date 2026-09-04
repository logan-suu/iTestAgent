import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  type ArtifactIndex,
  ArtifactIndexSchema,
  RUN_STEPS_SCHEMA_VERSION,
  type RunPlanDocument,
  type RunResult,
  type RunStep,
  RunStepsDocumentSchema,
  assertValidRunBundleDocuments,
  isSafeRunId,
} from 'itestagent-contracts';

const activeRunIds = new Set<string>();
const BUNDLE_DIRECTORY_TYPES = new Set(['xcresult', 'trace']);

export interface RunWriterArtifactInput {
  id: string;
  type: ArtifactIndex['artifacts'][number]['type'];
  sourcePath: string;
  /** Trusted staging root that must contain the source path. */
  sourceRoot?: string;
  relativePath?: string;
  mimeType?: string;
  relatedStep?: string;
  relatedCase?: string;
  backend?: string;
  redactionStatus: ArtifactIndex['artifacts'][number]['redactionStatus'];
}

export interface RunWriterCommitInput {
  result: RunResult;
  artifactIndex: ArtifactIndex;
  summary: string;
}

export interface RunWriterHooks {
  checkpoint?(steps: readonly RunStep[]): Promise<void>;
  committed?(input: RunWriterCommitInput & { steps: readonly RunStep[] }): Promise<void>;
}

export interface MeasuredPath {
  sizeBytes: number;
  sha256: string;
  directory: boolean;
}

function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) throw new Error('unsafe runId');
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep);
}

async function assertContainedPathHasNoSymlink(root: string, target: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (!isInside(resolvedRoot, resolvedTarget)) {
    throw new Error('artifact path must remain inside its declared root');
  }
  const rootRealPath = await realpath(resolvedRoot);
  const targetRealPath = await realpath(resolvedTarget);
  if (!isInside(rootRealPath, targetRealPath)) {
    throw new Error('artifact path must remain inside its declared root');
  }
  let current = resolvedRoot;
  for (const component of [
    '',
    ...relative(resolvedRoot, resolvedTarget).split(sep).filter(Boolean),
  ]) {
    if (component) current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('artifact path must not contain symlinks');
    }
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.tmp-${crypto.randomUUID()}`;
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}

async function hashFileContents(
  hash: ReturnType<typeof createHash>,
  path: string,
): Promise<number> {
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return sizeBytes;
}

export async function measureRunArtifactPath(
  path: string,
  expectedType: string,
  containmentRoot?: string,
): Promise<MeasuredPath> {
  if (containmentRoot) await assertContainedPathHasNoSymlink(containmentRoot, path);
  const rootStat = await lstat(path);
  if (rootStat.isSymbolicLink()) throw new Error('artifact must not be a symlink');
  if (rootStat.isFile()) {
    if (rootStat.size <= 0) throw new Error('artifact file must be non-empty');
    const hash = createHash('sha256');
    const sizeBytes = await hashFileContents(hash, path);
    if (sizeBytes !== rootStat.size) throw new Error('artifact changed while being measured');
    return {
      sizeBytes,
      sha256: hash.digest('hex'),
      directory: false,
    };
  }
  if (!rootStat.isDirectory() || !BUNDLE_DIRECTORY_TYPES.has(expectedType)) {
    throw new Error('only xcresult and trace artifacts may be directories');
  }

  const suffix = expectedType === 'xcresult' ? '.xcresult' : '.trace';
  if (!path.endsWith(suffix)) throw new Error(`${expectedType} bundle must use ${suffix} suffix`);
  const entries: Array<{ relativePath: string; path: string; sizeBytes: number }> = [];
  async function visit(dir: string): Promise<void> {
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children) {
      const childPath = join(dir, child.name);
      const stat = await lstat(childPath);
      if (stat.isSymbolicLink()) throw new Error('artifact bundle must not contain symlinks');
      if (stat.isDirectory()) await visit(childPath);
      else if (stat.isFile())
        entries.push({
          relativePath: relative(path, childPath),
          path: childPath,
          sizeBytes: stat.size,
        });
      else throw new Error('artifact bundle contains an unsupported filesystem entry');
    }
  }
  await visit(path);
  if (entries.length === 0) throw new Error('artifact bundle must be non-empty');
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const entry of entries) {
    const relativePathBytes = Buffer.byteLength(entry.relativePath);
    hash.update(`${relativePathBytes}:`);
    hash.update(entry.relativePath);
    hash.update(`:${entry.sizeBytes}:`);
    const measuredSize = await hashFileContents(hash, entry.path);
    if (measuredSize !== entry.sizeBytes) throw new Error('artifact changed while being measured');
    sizeBytes += measuredSize;
  }
  return { sizeBytes, sha256: hash.digest('hex'), directory: true };
}

async function securePermissions(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isDirectory()) {
    await chmod(path, 0o700);
    for (const child of await readdir(path)) await securePermissions(join(path, child));
  } else {
    await chmod(path, 0o600);
  }
}

async function assertDirectoryChainHasNoSymlink(
  root: string,
  targetDirectory: string,
): Promise<void> {
  const chain = relative(root, targetDirectory).split(sep).filter(Boolean);
  let current = root;
  for (const component of ['', ...chain]) {
    if (component) current = join(current, component);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('artifact destination path must contain only real directories');
    }
  }
}

export class RunWriter {
  readonly runId: string;
  readonly runDir: string;
  readonly artifactsDir: string;
  private plan?: RunPlanDocument;
  private steps: RunStep[] = [];
  private released = false;
  private lockFd?: number;
  private readonly lockToken = crypto.randomUUID();
  private readonly lockPath: string;

  private constructor(
    runId: string,
    runsRoot: string,
    private readonly hooks: RunWriterHooks,
  ) {
    this.runId = runId;
    this.runDir = join(runsRoot, runId);
    this.artifactsDir = join(this.runDir, 'artifacts');
    this.lockPath = join(this.runDir, '.writer.lock');
  }

  static recoverStaleLock(runId: string, runsRoot: string): boolean {
    assertSafeRunId(runId);
    if (activeRunIds.has(runId)) return false;
    const runDir = join(runsRoot, runId);
    const lockPath = join(runDir, '.writer.lock');
    if (!existsSync(lockPath) || existsSync(join(runDir, 'result.json'))) return false;
    const stat = lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid run writer lock');
    let owner: { pid?: unknown; token?: unknown };
    try {
      owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown; token?: unknown };
    } catch {
      throw new Error('invalid run writer lock');
    }
    if (
      typeof owner.pid !== 'number' ||
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.token !== 'string' ||
      owner.token.length === 0
    ) {
      throw new Error('invalid run writer lock');
    }
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
    }
    try {
      unlinkSync(lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  static async begin(
    runId: string,
    runsRoot: string,
    hooks: RunWriterHooks = {},
  ): Promise<RunWriter> {
    assertSafeRunId(runId);
    if (activeRunIds.has(runId)) throw new Error(`run "${runId}" already has an active writer`);
    const writer = new RunWriter(runId, runsRoot, hooks);
    activeRunIds.add(runId);
    try {
      await mkdir(writer.runDir, { recursive: true, mode: 0o700 });
      const runStat = await lstat(writer.runDir);
      if (!runStat.isDirectory() || runStat.isSymbolicLink()) {
        throw new Error('run directory must be a real directory');
      }
      try {
        writer.lockFd = openSync(writer.lockPath, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(`run "${runId}" already has an active writer`);
        }
        throw error;
      }
      writeFileSync(
        writer.lockFd,
        JSON.stringify({
          pid: process.pid,
          token: writer.lockToken,
          createdAt: new Date().toISOString(),
        }),
        'utf8',
      );
      chmodSync(writer.lockPath, 0o600);
      await access(join(writer.runDir, 'result.json')).then(
        () => {
          throw new Error(`run "${runId}" is already committed`);
        },
        () => undefined,
      );
      await mkdir(writer.artifactsDir, { recursive: true, mode: 0o700 });
      await assertDirectoryChainHasNoSymlink(writer.runDir, writer.artifactsDir);
      await chmod(writer.runDir, 0o700);
      await chmod(writer.artifactsDir, 0o700);
      return writer;
    } catch (error) {
      writer.release();
      throw error;
    }
  }

  async writePlan(plan: RunPlanDocument): Promise<void> {
    if (plan.runId !== this.runId) throw new Error('plan runId does not match writer runId');
    this.plan = structuredClone(plan);
    await atomicWrite(join(this.runDir, 'plan.yaml'), `${JSON.stringify(plan, null, 2)}\n`);
  }

  async checkpoint(steps: readonly RunStep[]): Promise<void> {
    const document = RunStepsDocumentSchema.parse({
      schemaVersion: RUN_STEPS_SCHEMA_VERSION,
      runId: this.runId,
      steps,
    });
    this.steps = structuredClone(document.steps);
    await atomicWrite(join(this.runDir, 'steps.json'), `${JSON.stringify(document, null, 2)}\n`);
    await this.hooks.checkpoint?.(this.steps);
  }

  async importArtifact(input: RunWriterArtifactInput): Promise<ArtifactIndex['artifacts'][number]> {
    const source = resolve(input.sourcePath);
    const sourceMeasurement = await measureRunArtifactPath(source, input.type, input.sourceRoot);
    const fallbackName = `${input.id}-${basename(source)}`;
    const relativePath = input.relativePath ?? join('artifacts', fallbackName);
    const destination = resolve(this.runDir, relativePath);
    if (!relativePath.startsWith(`artifacts${sep}`) || !isInside(this.artifactsDir, destination)) {
      throw new Error(
        'artifact destination must remain inside the current run artifacts directory',
      );
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await assertDirectoryChainHasNoSymlink(this.artifactsDir, dirname(destination));
    if (source !== destination) {
      await cp(source, destination, {
        recursive: sourceMeasurement.directory,
        errorOnExist: true,
        force: false,
      });
    }
    await securePermissions(destination);
    const stored = await measureRunArtifactPath(destination, input.type, this.artifactsDir);
    if (
      stored.sha256 !== sourceMeasurement.sha256 ||
      stored.sizeBytes !== sourceMeasurement.sizeBytes
    ) {
      throw new Error('stored artifact integrity mismatch');
    }
    return {
      id: input.id,
      type: input.type,
      path: relativePath.split(sep).join('/'),
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      relatedStep: input.relatedStep,
      relatedCase: input.relatedCase,
      backend: input.backend,
      redactionStatus: input.redactionStatus,
    };
  }

  async commit(input: RunWriterCommitInput): Promise<void> {
    if (!this.plan) throw new Error('plan must be written before commit');
    const artifactIndex = ArtifactIndexSchema.parse(input.artifactIndex);
    for (const artifact of artifactIndex.artifacts) {
      const artifactPath = resolve(this.runDir, artifact.path);
      if (!artifact.path.startsWith('artifacts/') || !isInside(this.artifactsDir, artifactPath)) {
        throw new Error(`unsafe artifact path: ${artifact.path}`);
      }
      const measured = await measureRunArtifactPath(artifactPath, artifact.type, this.artifactsDir);
      if (artifact.sha256 !== measured.sha256 || artifact.sizeBytes !== measured.sizeBytes) {
        throw new Error(`artifact integrity mismatch: ${artifact.id}`);
      }
    }
    const stepsDocument = RunStepsDocumentSchema.parse({
      schemaVersion: RUN_STEPS_SCHEMA_VERSION,
      runId: this.runId,
      steps: this.steps,
    });
    assertValidRunBundleDocuments({
      plan: this.plan,
      steps: stepsDocument,
      result: input.result,
      artifactIndex,
    });
    await this.checkpoint(this.steps);
    await atomicWrite(
      join(this.runDir, 'artifact-index.json'),
      `${JSON.stringify(artifactIndex, null, 2)}\n`,
    );
    await atomicWrite(join(this.runDir, 'summary.md'), input.summary);
    await atomicWrite(
      join(this.runDir, 'result.json'),
      `${JSON.stringify(input.result, null, 2)}\n`,
    );
    await this.hooks.committed?.({ ...input, artifactIndex, steps: this.steps });
    this.release();
  }

  abort(): void {
    this.release();
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    activeRunIds.delete(this.runId);
    if (this.lockFd !== undefined) {
      closeSync(this.lockFd);
      this.lockFd = undefined;
    }
    try {
      const owner = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { token?: unknown };
      if (owner.token === this.lockToken) unlinkSync(this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A malformed or replaced lock is left in place for explicit recovery.
      }
    }
  }
}
