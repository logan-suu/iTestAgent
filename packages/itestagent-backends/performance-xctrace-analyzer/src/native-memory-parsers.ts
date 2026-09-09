import { type MemoryLeaks, MemoryLeaksSchema } from 'itestagent-contracts';

/** Read only the verified single-process byte field; auxiliary peaks have another time scope. */
export function parseNativeFootprint(raw: string, pid: number): number {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('native_memory.invalid_json');
  }
  if (!value || typeof value !== 'object') throw new Error('native_memory.invalid_json');
  const v = value as Record<string, unknown>;
  if (
    v.unit !== 'byte' ||
    v['bytes per unit'] !== 1 ||
    !Array.isArray(v.processes) ||
    v.processes.length !== 1 ||
    !Array.isArray(v.errors) ||
    v.errors.length ||
    !Array.isArray(v.warnings) ||
    v.warnings.length
  )
    throw new Error('native_memory.unsupported_format');
  const process = v.processes[0] as Record<string, unknown> | null;
  const bytes = process?.footprint;
  if (
    process?.pid !== pid ||
    typeof bytes !== 'number' ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    v['total footprint'] !== bytes
  )
    throw new Error('native_memory.target_or_value_invalid');
  return bytes;
}

/** Exit 1 is a successful positive diagnosis, not a transport failure. */
export function parseNativeLeaks(input: {
  stdout: string;
  exitCode: number;
  failure?: string;
  pid: number;
  startedAt: string;
  finishedAt: string;
  artifactId: string;
}): MemoryLeaks {
  if (input.failure) throw new Error('native_memory.scan_failed');
  // Reject ambiguous summaries, including summaries belonging to another target.
  const summaries = [
    ...input.stdout.matchAll(
      /Process\s+(\d+):\s+(\d+)\s+leaks?\s+for\s+(\d+)\s+total leaked bytes/g,
    ),
  ];
  if (summaries.length !== 1 || Number(summaries[0]?.[1]) !== input.pid)
    throw new Error('native_memory.scan_completion_unproven');
  const result = MemoryLeaksSchema.safeParse({
    source: 'native-leaks',
    scope: 'scan_snapshot',
    status: input.exitCode === 0 ? 'not_detected' : 'detected',
    allocationCount: Number(summaries[0]?.[2]),
    totalBytes: Number(summaries[0]?.[3]),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    exitCode: input.exitCode,
    completionVerified: true,
    targetBound: true,
    artifactId: input.artifactId,
  });
  if (!result.success) throw new Error('native_memory.scan_completion_unproven');
  return result.data;
}
