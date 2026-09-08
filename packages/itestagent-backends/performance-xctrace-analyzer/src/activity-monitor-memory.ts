import { analyzeMemoryGrowth } from './memory-growth.js';
import { extractAttribute, findOpeningTags } from './xctrace-xml.js';

/** A deliberately narrow reader for the public Activity Monitor export schema. */
export function parseActivityMonitorMemory(
  xml: string,
  target: string,
):
  | { peakMiB: number; sampleCount: number; growth?: ReturnType<typeof analyzeMemoryGrowth> }
  | undefined {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !xml.includes('</trace-query-result>')) return;
  const schema = /<schema\b([^>]*)>([\s\S]*?)<\/schema>/.exec(xml);
  if (!schema || extractAttribute(schema[1] ?? '', 'name') !== 'activity-monitor-process-live')
    return;
  const columns = [...(schema[2] ?? '').matchAll(/<col>([\s\S]*?)<\/col>/g)].map((m) => ({
    name: /<mnemonic>([^<]+)<\/mnemonic>/.exec(m[1] ?? '')?.[1],
    type: /<engineering-type>([^<]+)<\/engineering-type>/.exec(m[1] ?? '')?.[1],
  }));
  const memory = columns.findIndex((c) => c.name === 'memory-physical-footprint');
  const pid = columns.findIndex((c) => c.name === 'pid');
  const process = columns.findIndex((c) => c.name === 'process');
  const time = columns.findIndex((c) => c.name === 'start' && c.type === 'start-time');
  if (
    memory < 0 ||
    pid < 0 ||
    process < 0 ||
    columns[memory]?.type !== 'size-in-bytes' ||
    columns[pid]?.type !== 'pid' ||
    columns[process]?.type !== 'process'
  )
    return;
  const values = new Map<string, { tag: string; value: number }>();
  for (const m of xml.matchAll(/<(pid|size-in-bytes|start-time)\b([^>]*)>([^<]*)<\/\1>/g)) {
    const id = extractAttribute(m[2] ?? '', 'id');
    const text = (m[3] ?? '').trim();
    if (!id || !/^\d+$/.test(text)) continue;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || values.has(id)) return;
    values.set(id, { tag: m[1] as string, value });
  }
  const processes = new Map<string, string>();
  for (const tag of findOpeningTags(xml, 'process')) {
    const id = extractAttribute(tag, 'id');
    const fmt = extractAttribute(tag, 'fmt');
    if (id && fmt) {
      if (processes.has(id)) return;
      processes.set(id, fmt);
    }
  }
  const number = (cell: string, tag: string): number | undefined => {
    if (!cell.startsWith(`<${tag} `) && !cell.startsWith(`<${tag}>`)) return;
    const ref = extractAttribute(cell, 'ref');
    if (ref) {
      const value = values.get(ref);
      return value?.tag === tag ? value.value : undefined;
    }
    const text = />\s*(\d+)\s*</.exec(cell)?.[1];
    if (text === undefined) return;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : undefined;
  };
  let peak = 0;
  let count = 0;
  let matchedPid: number | undefined;
  const samples: { timestampMs: number; footprintMiB: number }[] = [];
  let validTime = time >= 0;
  for (const row of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const content = row[1] ?? '';
    const cells = [...content.matchAll(/<([\w-]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g)].map(
      (m) => m[0],
    );
    if (
      cells.length !== columns.length ||
      cells.join('').replace(/\s/g, '') !== content.replace(/\s/g, '')
    )
      return;
    const processId = number(cells[pid] ?? '', 'pid');
    const processCell = cells[process] ?? '';
    if (!processCell.startsWith('<process ') && !processCell.startsWith('<process>')) return;
    const ref = extractAttribute(processCell, 'ref');
    const fmt = ref ? processes.get(ref) : extractAttribute(processCell, 'fmt');
    if (processId === undefined || !fmt) return;
    // Match the exact attached name/PID, never aggregate other processes or reused names.
    if (String(processId) !== target && fmt !== `${target} (${processId})`) continue;
    if (matchedPid !== undefined && matchedPid !== processId) return;
    matchedPid = processId;
    const bytes = number(cells[memory] ?? '', 'size-in-bytes');
    if (bytes === undefined) return;
    peak = Math.max(peak, bytes);
    count++;
    const ns = time >= 0 ? number(cells[time] ?? '', 'start-time') : undefined;
    if (ns === undefined) validTime = false;
    else if (samples.length < 10001)
      samples.push({ timestampMs: ns / 1_000_000, footprintMiB: bytes / (1024 * 1024) });
  }
  const growth = validTime ? analyzeMemoryGrowth(samples) : undefined;
  return count > 0
    ? { peakMiB: peak / (1024 * 1024), sampleCount: count, ...(growth ? { growth } : {}) }
    : undefined;
}
