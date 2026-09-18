import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { z } from 'zod';

const prefix = 'ITESTAGENT_MEMORY_IDENTITY ';
const requestSchema = z.string().uuid();
const ackPrefix = 'ITESTAGENT_MEMORY_ACK ';
const ackSchema = z
  .object({
    protocolVersion: z.literal(1),
    requestId: requestSchema,
    status: z.literal('acknowledged'),
  })
  .strict();

/** Transport probe only: does not access a target or prove identity/readiness. */
export function memoryConsoleAckCommand(requestId: string): string {
  requestSchema.parse(requestId);
  const line =
    ackPrefix + JSON.stringify({ protocolVersion: 1, requestId, status: 'acknowledged' });
  return `script print(${JSON.stringify(line)})`;
}

export function parseMemoryConsoleAck(raw: string, requestId: string) {
  if (
    !requestSchema.safeParse(requestId).success ||
    Buffer.byteLength(raw) > 256 ||
    !raw.startsWith(ackPrefix)
  )
    return undefined;
  try {
    const result = ackSchema.safeParse(JSON.parse(raw.slice(ackPrefix.length)));
    return result.success && result.data.requestId === requestId ? result.data : undefined;
  } catch {
    return undefined;
  }
}

const observationSchema = z
  .object({
    protocolVersion: z.literal(1),
    requestId: requestSchema,
    status: z.literal('observed'),
    debuggerId: z.number().int().nonnegative().safe(),
    processInstance: z.number().int().positive().safe(),
    pid: z.number().int().positive().safe(),
    moduleUUID: z.string().regex(/^[a-f0-9-]{32,40}$/),
    triple: z.string().min(1).max(256),
    platform: z.string().min(1).max(256),
    executable: z
      .string()
      .min(2)
      .max(4096)
      .startsWith('/')
      .refine((s) => [...s].every((character) => character.charCodeAt(0) >= 32)),
  })
  .strict();
export type DebuggerMemoryObservation = z.infer<typeof observationSchema>;
const exitSchema = observationSchema
  .pick({
    protocolVersion: true,
    requestId: true,
    debuggerId: true,
    processInstance: true,
    pid: true,
  })
  .extend({
    status: z.literal('observed_exited'),
    source: z.literal('lldb_selected_process_exited'),
  })
  .strict();

/** Observation only: neither terminates a target nor establishes physical-device binding. */
export function memoryExitConsoleCommand(
  requestId: string,
  expected: DebuggerMemoryObservation,
): string {
  requestSchema.parse(requestId);
  const identity = observationSchema.parse(expected);
  const source = readFileSync(
    new URL('../native/itestagent_memory_identity.py', import.meta.url),
    'utf8',
  );
  return `script exec(${JSON.stringify(source)}); emit_exit(lldb.debugger, ${JSON.stringify(requestId)}, ${identity.debuggerId}, ${identity.processInstance}, ${identity.pid})`;
}

export function parseMemoryDebuggerExit(
  raw: string,
  requestId: string,
  expected: DebuggerMemoryObservation,
) {
  const prefix = 'ITESTAGENT_MEMORY_EXIT ';
  if (
    !requestSchema.safeParse(requestId).success ||
    !observationSchema.safeParse(expected).success ||
    Buffer.byteLength(raw) > 2048 ||
    !raw.startsWith(prefix)
  )
    return undefined;
  try {
    const result = exitSchema.safeParse(JSON.parse(raw.slice(prefix.length)));
    if (
      !result.success ||
      result.data.requestId !== requestId ||
      result.data.debuggerId !== expected.debuggerId ||
      result.data.processInstance !== expected.processInstance ||
      result.data.pid !== expected.pid
    )
      return undefined;
    return result.data;
  } catch {
    return undefined;
  }
}

/** The source is shipped with the backend. Callers can supply only a request UUID. */
export function memoryIdentityConsoleCommand(requestId: string): string {
  requestSchema.parse(requestId);
  const source = readFileSync(
    new URL('../native/itestagent_memory_identity.py', import.meta.url),
    'utf8',
  );
  // JSON string escaping is valid for these Python string literals, not shell escaping.
  return `script exec(${JSON.stringify(source)}); emit(lldb.debugger, ${JSON.stringify(requestId)})`;
}

/** Experimental transport encoding of the exact same shipped source. Not UI readiness. */
export function memoryCompactIdentityConsoleCommand(requestId: string): string {
  requestSchema.parse(requestId);
  const source = readFileSync(new URL('../native/itestagent_memory_identity.py', import.meta.url));
  const payload = deflateSync(source, { level: 9 }).toString('base64');
  return `script exec(__import__('zlib').decompress(__import__('base64').b64decode('${payload}'))); emit(lldb.debugger, ${JSON.stringify(requestId)})`;
}

/** The caller supplies the isolated response line, never a complete debug console. */
export function parseMemoryDebuggerIdentity(
  raw: string,
  requestId: string,
): DebuggerMemoryObservation | undefined {
  if (
    !requestSchema.safeParse(requestId).success ||
    Buffer.byteLength(raw) > 8192 ||
    !raw.startsWith(prefix)
  )
    return undefined;
  try {
    const result = observationSchema.safeParse(JSON.parse(raw.slice(prefix.length)));
    if (!result.success || result.data.requestId !== requestId) return undefined;
    return result.data;
  } catch {
    return undefined;
  }
}

/** Metadata is a candidate, not device binding. A live owned Xcode adapter must corroborate it. */
export function sameMemoryDebuggerProcess(
  previous: DebuggerMemoryObservation,
  current: DebuggerMemoryObservation,
): boolean {
  const fields = [
    'debuggerId',
    'processInstance',
    'pid',
    'moduleUUID',
    'triple',
    'platform',
    'executable',
  ] as const;
  return fields.every((key) => previous[key] === current[key]);
}
