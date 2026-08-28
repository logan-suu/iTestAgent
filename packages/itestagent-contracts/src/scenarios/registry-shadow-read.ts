/** B37: registry shadow-read (§9 Stage 2A). */
export interface ShadowReadResult {
  equal: boolean;
  diagnostics: string[];
}

export function shadowReadCompare(a: unknown, b: unknown): ShadowReadResult {
  const canonicalA = JSON.stringify(a);
  const canonicalB = JSON.stringify(b);
  if (canonicalA === canonicalB) return { equal: true, diagnostics: [] };
  return { equal: false, diagnostics: ['shadow-read mismatch: canonicalized outputs differ'] };
}
