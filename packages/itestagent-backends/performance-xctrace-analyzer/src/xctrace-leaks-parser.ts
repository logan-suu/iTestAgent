/**
 * Leaks-report parsing — B21 module split (promotion guide §11.3 "generic
 * xctrace mechanics").
 *
 * The standard `leaks` summary line ("N leaks totaling M bytes") is the only
 * recognized shape; anything else fails closed rather than fabricating a
 * count (R5).
 */

export interface LeaksSummary {
  leakCount: number;
  totalLeakedBytes: number;
}

/**
 * Parses the leaks summary line from tool text output.
 * Throws when the expected summary line is absent — a non-standard dump must
 * never become a fabricated zero-leak verdict.
 */
export function parseLeaksReport(text: string): LeaksSummary {
  const match = /(\d+) leaks? totaling (\d+) bytes/.exec(text);
  if (!match?.[1] || !match?.[2]) {
    throw new Error('leaks report: unrecognized output format');
  }
  return {
    leakCount: Number.parseInt(match[1], 10),
    totalLeakedBytes: Number.parseInt(match[2], 10),
  };
}
