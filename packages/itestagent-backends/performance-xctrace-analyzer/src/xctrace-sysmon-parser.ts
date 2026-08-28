/**
 * Nested sysmon frame parser — B21 module split (promotion guide §11.3
 * "generic xctrace mechanics").
 *
 * Extracts the recursive <frame> tree emitted by `xctrace export` for the
 * system-monitor template. Self-closing frames (<frame ... />) must not
 * become parents of their following siblings — the scanner only pushes
 * non-self-closing openings onto the nesting stack.
 */
import { extractAttribute } from './xctrace-xml.js';

export interface SysmonFrame {
  name: string;
  /** Symbol address when present in the export. */
  addr?: string;
  sampleCount: number;
  children: SysmonFrame[];
}

/**
 * Parses every top-level <frame> and its nested children, in document order.
 */
export function parseSysmonFrames(xml: string): SysmonFrame[] {
  const frames: SysmonFrame[] = [];
  const stack: SysmonFrame[] = [];
  const tokenRe = /<frame\b([^>]*)>|<\/frame>/g;
  let match = tokenRe.exec(xml);
  while (match !== null) {
    const [token, attrsRaw] = match;
    if (token === '</frame>') {
      stack.pop();
    } else {
      const attrs = attrsRaw ?? '';
      const name = extractAttribute(attrs, 'name') ?? '';
      const countRaw = extractAttribute(attrs, 'sampleCount');
      const parsed = countRaw ? Number.parseInt(countRaw, 10) : Number.NaN;
      const addr = extractAttribute(attrs, 'addr') ?? undefined;

      const frame: SysmonFrame = {
        name,
        sampleCount: Number.isFinite(parsed) ? parsed : 0,
        children: [],
      };
      if (addr !== undefined) frame.addr = addr;

      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(frame);
      else frames.push(frame);

      // Self-closing frames have no subtree — never push them onto the stack.
      if (!attrs.trimEnd().endsWith('/')) stack.push(frame);
    }
    match = tokenRe.exec(xml);
  }
  return frames;
}

/** Recursively sums sample counts across the whole frame tree. */
export function sumSampleCounts(frames: readonly SysmonFrame[]): number {
  return frames.reduce(
    (sum, frame) => sum + frame.sampleCount + sumSampleCounts(frame.children),
    0,
  );
}
