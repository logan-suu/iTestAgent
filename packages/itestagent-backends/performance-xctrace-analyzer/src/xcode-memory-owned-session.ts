import { z } from 'zod';
import {
  MemorySessionProtocol,
  type MemorySessionTarget,
  reserveXcodeMemoryLease,
} from './xcode-memory-session.js';

const closedSchema = z
  .object({
    protocolVersion: z.literal(1),
    sessionId: z.string().uuid(),
    scope: z.literal('owned_app_only'),
    reason: z.enum([
      'completed',
      'cancelled',
      'timeout',
      'instance_conflict',
      'launch_failed',
      'cleanup_unverified',
    ]),
    cleanupVerified: z.boolean(),
  })
  .strict();

type OwnedSessionOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
  interrupted: boolean;
};
type OwnedSessionRunner = (sessionId: string, signal?: AbortSignal) => Promise<OwnedSessionOutput>;

/** Internal App-only boundary. No project, debugger or AUT resource may be created
 * by this runner. A later full capture transport needs proofs for all those resources.
 * The runner resolves only after the helper exits and must propagate the lifetime pipe.
 */
export async function runOwnedMemorySession(
  input: { helpersRoot: string; target: MemorySessionTarget; signal?: AbortSignal },
  run: OwnedSessionRunner,
) {
  if (input.signal?.aborted)
    return { reason: 'cancelled', cleanupVerified: true, leaseRetained: false };
  // Validate before reservation so malformed targets cannot leave unnecessary locks.
  new MemorySessionProtocol('00000000-0000-4000-8000-000000000000', input.target, 'owned_app_only');
  const lease = reserveXcodeMemoryLease(input.helpersRoot);
  const protocol = new MemorySessionProtocol(lease.sessionId, input.target, 'owned_app_only');
  let sequence = 0;
  let runnerStarted = false;
  let proven = false;
  let reason = 'cleanup_unverified';
  const event = (state: 'preparing' | 'closing' | 'closed', cleanupVerified?: boolean) =>
    protocol.accept(
      JSON.stringify({
        protocolVersion: 2,
        sessionId: lease.sessionId,
        sequence: ++sequence,
        state,
        ...(cleanupVerified === undefined ? {} : { cleanupVerified }),
      }),
    );
  try {
    if (input.signal?.aborted) {
      reason = 'cancelled';
      proven = true;
    } else {
      event('preparing');
      runnerStarted = true;
      const output = await run(lease.sessionId, input.signal);
      if (Buffer.byteLength(output.stdout, 'utf8') > 2048)
        throw new Error('session.result_invalid');
      const result = closedSchema.parse(JSON.parse(output.stdout));
      if (result.sessionId !== lease.sessionId || output.exitCode !== 0 || output.stderr !== '')
        throw new Error('session.result_invalid');
      // A forced/missing exit can never be repaired by a previously written result.
      proven = result.cleanupVerified && result.reason !== 'cleanup_unverified';
      reason = proven
        ? input.signal?.aborted || output.interrupted
          ? 'cancelled'
          : result.reason
        : 'cleanup_unverified';
    }
  } catch {
    proven = !runnerStarted;
    reason = 'cleanup_unverified';
  }
  if (input.signal?.aborted) protocol.cancel();
  event('closing');
  event('closed', proven);
  if (proven) {
    try {
      lease.release(protocol);
      return { reason, cleanupVerified: true, leaseRetained: false };
    } catch {
      return { reason: 'lease_changed', cleanupVerified: true, leaseRetained: true };
    }
  }
  return { reason, cleanupVerified: false, leaseRetained: true };
}
