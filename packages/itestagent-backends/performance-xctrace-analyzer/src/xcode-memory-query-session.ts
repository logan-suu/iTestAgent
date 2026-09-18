import { z } from 'zod';
import { parseMemoryDebuggerIdentity } from './xcode-memory-debugger-identity.js';

const bindingSchema = z
  .object({
    sessionId: z.string().uuid(),
    requestId: z.string().uuid(),
    strategy: z.literal('pidReturn'),
    commandSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type QueryBinding = z.infer<typeof bindingSchema>;
const resultSchema = bindingSchema
  .extend({
    protocolVersion: z.literal(1),
    status: z.enum(['candidate', 'failed', 'cancelled']),
    insertionAttempted: z.boolean(),
    downAttempted: z.boolean(),
    upAttempted: z.boolean(),
    candidateLine: z.string().max(8192).optional(),
  })
  .strict();

type QueryDependencies = {
  /** Must be supplied by the acquired owner; not a caller-selected PID lookup. */
  ownerIsCurrent(): boolean;
  /** Production wiring must call PermissionEngine, not load a saved allow. */
  requestPermission(
    action: 'interact_sensitive_ui',
    resource: string,
    signal?: AbortSignal,
  ): Promise<{ effect: 'allow' | 'deny'; remembered: boolean }>;
  /** Internal transport resolves only after its query operation terminates. */
  run(binding: Readonly<QueryBinding>, signal?: AbortSignal): Promise<string>;
};

/** Internal preparation/one-shot authorization boundary. No public IPC grant or
 * capture readiness is created here. Full-resource cleanup remains the owner's job.
 */
export function prepareMemoryQuerySession(
  input: QueryBinding,
  dependencies: QueryDependencies,
  signal?: AbortSignal,
) {
  const binding = Object.freeze(bindingSchema.parse(input));
  let consumed = false;
  const failed = (reason: string): ReturnType<typeof parseMemoryQueryResult> => ({
    status: reason,
    targetVerified: false as const,
    leaseRetained: true as const,
  });
  return {
    async executeOnce() {
      if (consumed) return failed('already_consumed');
      consumed = true;
      try {
        if (signal?.aborted) return failed('cancelled');
        if (!dependencies.ownerIsCurrent()) return failed('owner_changed');
        const decision = await dependencies.requestPermission(
          'interact_sensitive_ui',
          JSON.stringify(binding),
          signal,
        );
        if (signal?.aborted) return failed('cancelled');
        if (decision.effect !== 'allow' || decision.remembered) return failed('not_authorized');
        if (!dependencies.ownerIsCurrent()) return failed('owner_changed');
        const raw = await dependencies.run(binding, signal);
        if (signal?.aborted) return failed('cancelled');
        if (!dependencies.ownerIsCurrent()) return failed('owner_changed');
        return parseMemoryQueryResult(raw, binding);
      } catch {
        return failed(signal?.aborted ? 'cancelled' : 'query_failed');
      }
    },
  };
}

const queryFailure = (reason: string) => ({
  status: reason,
  targetVerified: false as const,
  leaseRetained: true as const,
});

/** Shared strict parser; parsing never requests permission or proves cleanup. */
export function parseMemoryQueryResult(
  raw: string,
  input: QueryBinding,
): {
  status: string;
  targetVerified: false;
  leaseRetained: true;
  observation?: NonNullable<ReturnType<typeof parseMemoryDebuggerIdentity>>;
} {
  const failed = queryFailure;
  try {
    const binding = bindingSchema.parse(input);
    if (Buffer.byteLength(raw, 'utf8') > 12288) return failed('invalid_response');
    const result = resultSchema.parse(JSON.parse(raw));
    for (const key of Object.keys(binding) as (keyof QueryBinding)[]) {
      if (result[key] !== binding[key]) return failed('invalid_response');
    }
    if (
      (result.downAttempted && !result.insertionAttempted) ||
      (result.upAttempted && !result.downAttempted)
    )
      return failed('invalid_response');
    if (result.status !== 'candidate') {
      if (result.candidateLine !== undefined) return failed('invalid_response');
      return failed(result.status);
    }
    if (
      !result.insertionAttempted ||
      !result.downAttempted ||
      !result.upAttempted ||
      result.candidateLine === undefined
    )
      return failed('invalid_response');
    const observation = parseMemoryDebuggerIdentity(result.candidateLine, binding.requestId);
    if (!observation) return failed('invalid_response');
    return { ...failed('observed_candidate'), observation };
  } catch {
    return failed('invalid_response');
  }
}
