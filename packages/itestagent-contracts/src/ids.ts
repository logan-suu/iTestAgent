/**
 * Generate a globally unique, time-sortable ID with a semantic prefix.
 * Uses Bun.randomUUIDv7() when available (Bun runtime), falls back to crypto.randomUUID().
 *
 * @param prefix - Semantic prefix for the ID (e.g. 'run', 'rec', 's', 'ses').
 * @returns A string in the format `{prefix}_{uuid}`.
 *
 * @example
 * createId('run') // 'run_01937e02-c168-7d6f-9c8f-8f4c2e1a3b4d'
 * createId('s')   // 's_01937e02-c168-7d6f-9c8f-8f4c2e1a3b4d'
 */
export function createId(prefix: string): string {
  const uuid =
    typeof Bun !== 'undefined' && typeof Bun.randomUUIDv7 === 'function'
      ? Bun.randomUUIDv7()
      : crypto.randomUUID();
  return `${prefix}_${uuid}`;
}
