/**
 * Instruction analyzer — B16 module split (promotion guide §11.3 "engine
 * analysis/intents").
 *
 * Classifies a free-text user instruction into a coarse intent so the
 * engine can route to the right execution lane.
 */

export type InstructionIntent = 'explore' | 'smoke' | 'perf' | 'custom';

export interface InstructionAnalysis {
  intent: InstructionIntent;
}

/** Classifies an instruction by keyword (explore/smoke/perf). */
export function analyzeInstruction(text: string): InstructionAnalysis {
  const lower = text.toLowerCase();
  if (lower.includes('explore')) return { intent: 'explore' };
  if (lower.includes('smoke')) return { intent: 'smoke' };
  if (lower.includes('perf') || lower.includes('memory') || lower.includes('profile')) {
    return { intent: 'perf' };
  }
  return { intent: 'custom' };
}
