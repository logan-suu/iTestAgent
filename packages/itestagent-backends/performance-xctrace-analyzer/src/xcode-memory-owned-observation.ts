import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseMemoryDebuggerIdentity } from './xcode-memory-debugger-identity.js';

const response = z
  .object({
    protocolVersion: z.literal(1),
    sessionId: z.string().uuid(),
    requestId: z.string().uuid(),
    registrationId: z.string().uuid(),
    source: z.literal('retained_lldb_process'),
    debuggerId: z.number().int().nonnegative().safe(),
    processInstance: z.number().int().positive().safe(),
    pid: z.number().int().positive().safe(),
    status: z.enum(['registered', 'live', 'exited', 'released']),
  })
  .strict();

/** Internal correlation only. No method can mint physical identity or lease proof.
 * Each expected request is generated locally and consumed once, including on failure.
 */
export function createOwnedMemoryObservation(
  sessionId: string,
  candidateLine: string,
  candidateRequest: string,
  timeoutMs: number,
  now = () => performance.now(),
) {
  z.string().uuid().parse(sessionId);
  const candidate = parseMemoryDebuggerIdentity(candidateLine, candidateRequest);
  if (!candidate || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000)
    throw new Error('observation.configuration_invalid');
  const deadline = now() + timeoutMs;
  let state: 'new' | 'registered' | 'exited' | 'closed' | 'failed' = 'new';
  let registrationId: string | undefined;
  let pending: { requestId: string; operation: 'register' | 'observe' | 'release' } | undefined;
  return {
    request(operation: 'register' | 'observe' | 'release') {
      if (
        now() >= deadline ||
        pending ||
        !(
          (operation === 'register' && state === 'new') ||
          (['observe', 'release'].includes(operation) && ['registered', 'exited'].includes(state))
        )
      ) {
        state = 'failed';
        pending = undefined;
        throw new Error('observation.order_invalid');
      }
      pending = {
        requestId: operation === 'register' ? candidateRequest : randomUUID(),
        operation,
      };
      return Object.freeze({ ...pending, sessionId, registrationId });
    },
    accept(raw: string) {
      const expected = pending;
      pending = undefined;
      try {
        if (!expected || now() >= deadline || Buffer.byteLength(raw) > 2048) throw new Error();
        const value = response.parse(JSON.parse(raw));
        const statuses =
          expected.operation === 'register'
            ? ['registered']
            : expected.operation === 'release'
              ? ['released']
              : ['live', 'exited'];
        if (
          value.sessionId !== sessionId ||
          value.requestId !== expected.requestId ||
          (registrationId !== undefined && value.registrationId !== registrationId) ||
          value.debuggerId !== candidate.debuggerId ||
          value.processInstance !== candidate.processInstance ||
          value.pid !== candidate.pid ||
          !statuses.includes(value.status) ||
          (state === 'exited' && value.status === 'live')
        )
          throw new Error();
        registrationId = value.registrationId;
        state =
          value.status === 'released'
            ? 'closed'
            : value.status === 'exited'
              ? 'exited'
              : 'registered';
        return Object.freeze({
          status: value.status,
          targetVerified: false as const,
          leaseRetained: true as const,
        });
      } catch {
        state = 'failed';
        throw new Error('observation.unverifiable');
      }
    },
  };
}
