import type { MemoryLeaks } from 'itestagent-contracts';

/** Public Xcode Leaks detail export; accepts only the per-allocation shape verified on device. */
export function parseLeaksDetail(xml: string): MemoryLeaks | undefined {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return;
  const body =
    /^\s*(?:<\?xml[^?]*\?>\s*)?<trace-query-result>\s*<node(?: xpath=(?:"[^"<>]*"|'[^'<>]*'))?>\s*([\s\S]*?)\s*<\/node>\s*<\/trace-query-result>\s*$/.exec(
      xml,
    )?.[1];
  if (!body) return;
  const rows = [...body.matchAll(/<row\s+([^<>]*?)\s*\/>/g)];
  if (!rows.length || rows.length > 10000 || body.replace(/<row\s+[^<>]*?\s*\/>/g, '').trim())
    return;
  const addresses = new Set<string>();
  let totalBytes = 0;
  for (const row of rows) {
    const attrs = new Map<string, string>();
    const text = row[1] ?? '';
    const pattern = /([a-z][a-z-]*)="([^"<>]*)"/g;
    for (const match of text.matchAll(pattern)) {
      if (attrs.has(match[1] as string)) return;
      attrs.set(match[1] as string, match[2] as string);
    }
    if (text.replace(pattern, '').trim()) return;
    const address = attrs.get('address');
    const size = attrs.get('size');
    // Grouped rows have not been verified; do not guess whether size is per item or total.
    if (
      !address ||
      !/^0x[\da-f]+$/i.test(address) ||
      !size ||
      !/^\d+$/.test(size) ||
      attrs.get('count') !== '1' ||
      !attrs.get('leaked-object')
    )
      return;
    const key = address.toLowerCase();
    if (addresses.has(key)) return;
    addresses.add(key);
    const bytes = Number(size);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return;
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes)) return;
  }
  return {
    source: 'xctrace-leaks-detail',
    status: 'detected',
    scope: 'observed_allocations',
    allocationCount: rows.length,
    totalBytes,
  };
}
