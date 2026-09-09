import { randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const identitySchema = z
  .object({
    deviceId: z.string().min(1).max(256),
    bundleId: z.string().min(1).max(256),
    buildReference: z.string().min(1).max(4096),
    executable: z.string().min(1).max(4096),
    pid: z.number().int().positive(),
    // A provider must document and verify this device process generation, not invent a nonce.
    generation: z.string().min(1).max(256),
  })
  .strict();
const targetSchema = identitySchema.omit({ pid: true, generation: true });
export type MemorySessionTarget = z.infer<typeof targetSchema>;
export type MemoryProcessIdentity = z.infer<typeof identitySchema>;
export type MemoryIdentityObservation =
  | { status: 'verified'; identity: MemoryProcessIdentity }
  | { status: 'unknown' };

/** Metadata-only process discovery cannot establish process continuity. */
export function metadataMemoryIdentity(): MemoryIdentityObservation {
  return { status: 'unknown' };
}

export type MemorySessionState =
  | 'preflight'
  | 'preparing'
  | 'prepared'
  | 'capturing'
  | 'exported'
  | 'closing'
  | 'closed';
const eventSchema = z
  .object({
    protocolVersion: z.literal(2),
    sessionId: z.string().uuid(),
    sequence: z.number().int().positive(),
    state: z.enum(['preparing', 'prepared', 'capturing', 'exported', 'closing', 'closed']),
    cleanupVerified: z.boolean().optional(),
  })
  .strict();

/** Internal protocol gate. It neither launches tools nor accepts raw AX/diagnostic payloads. */
export class MemorySessionProtocol {
  readonly sessionId: string;
  #state: MemorySessionState = 'preflight';
  #sequence = 0;
  #identity: MemoryProcessIdentity | undefined;
  #target: MemorySessionTarget;
  #cancelled = false;
  #cleanupVerified = false;

  constructor(sessionId: string, target: MemorySessionTarget) {
    this.#target = targetSchema.parse(target);
    this.sessionId = z.string().uuid().parse(sessionId);
  }
  get state() {
    return this.#state;
  }
  get cancelled() {
    return this.#cancelled;
  }
  get cleanupVerified() {
    return this.#cleanupVerified;
  }
  cancel() {
    this.#cancelled = true;
  }

  accept(raw: string, observation: MemoryIdentityObservation = { status: 'unknown' }): void {
    if (Buffer.byteLength(raw, 'utf8') > 1024) throw new Error('session.protocol_invalid');
    let event: z.infer<typeof eventSchema>;
    try {
      event = eventSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error('session.protocol_invalid');
    }
    if (event.sessionId !== this.sessionId || event.sequence !== this.#sequence + 1)
      throw new Error('session.protocol_invalid');
    if (this.#cancelled && event.state !== 'closing' && event.state !== 'closed')
      throw new Error('session.cancelled');
    const next: Record<MemorySessionState, readonly MemorySessionState[]> = {
      preflight: ['preparing', 'closing'],
      preparing: ['prepared', 'closing'],
      prepared: ['capturing', 'closing'],
      capturing: ['exported', 'closing'],
      exported: ['closing'],
      closing: ['closed'],
      closed: [],
    };
    if (!next[this.#state].includes(event.state)) throw new Error('session.transition_invalid');
    if ((event.state === 'closed') !== (event.cleanupVerified !== undefined))
      throw new Error('session.protocol_invalid');
    if (['prepared', 'capturing', 'exported'].includes(event.state)) this.verifyTarget(observation);
    this.#state = event.state;
    this.#sequence = event.sequence;
    this.#cleanupVerified = event.state === 'closed' && event.cleanupVerified === true;
  }

  /** Called again at WDA readiness and both sides of business execution. */
  verifyTarget(observation: MemoryIdentityObservation): void {
    if (this.#cancelled) throw new Error('session.cancelled');
    const parsed =
      observation.status === 'verified'
        ? identitySchema.safeParse(observation.identity)
        : undefined;
    if (!parsed?.success) throw new Error('session.target_identity_unverifiable');
    if (
      Object.keys(this.#target).some(
        (key) =>
          parsed.data[key as keyof MemorySessionTarget] !==
          this.#target[key as keyof MemorySessionTarget],
      )
    )
      throw new Error('session.target_changed');
    if (
      this.#identity &&
      Object.keys(parsed.data).some(
        (key) =>
          parsed.data[key as keyof MemoryProcessIdentity] !==
          this.#identity?.[key as keyof MemoryProcessIdentity],
      )
    )
      throw new Error('session.target_changed');
    this.#identity = parsed.data;
  }
}

/** The caller supplies the common helpers root, never a version or request directory. */
export function reserveXcodeMemoryLease(helpersRoot: string) {
  if (resolve(helpersRoot) !== helpersRoot || realpathSync(helpersRoot) !== helpersRoot)
    throw new Error('session.root_invalid');
  const root = lstatSync(helpersRoot);
  if (!root.isDirectory() || root.uid !== process.getuid?.() || (root.mode & 0o022) !== 0)
    throw new Error('session.root_invalid');
  const path = join(helpersRoot, 'xcode-memory-session.lock');
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch {
    throw new Error('session.instance_conflict');
  }
  const inode = lstatSync(path);
  const sessionId = randomUUID();
  const owner = join(path, 'owner.json');
  const contents = JSON.stringify({ protocolVersion: 2, sessionId });
  // Publication errors retain the reservation; an unknown lease is never reclaimed.
  writeFileSync(owner, contents, { mode: 0o600, flag: 'wx' });
  let released = false;
  return {
    sessionId,
    release(protocol: MemorySessionProtocol) {
      if (released) return;
      if (
        protocol.sessionId !== sessionId ||
        !protocol.cleanupVerified ||
        protocol.state !== 'closed'
      )
        throw new Error('session.cleanup_unverified');
      const current = lstatSync(path);
      if (current.isSymbolicLink() || current.dev !== inode.dev || current.ino !== inode.ino)
        throw new Error('session.lease_changed');
      const fd = openSync(owner, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size > 1024 ||
          stat.uid !== process.getuid?.() ||
          (stat.mode & 0o077) !== 0 ||
          readFileSync(fd, 'utf8') !== contents
        )
          throw new Error('session.lease_changed');
      } finally {
        closeSync(fd);
      }
      unlinkSync(owner);
      // Unknown children prevent removal. No recursive deletion or stale-lock takeover.
      rmdirSync(path);
      released = true;
    },
  };
}
