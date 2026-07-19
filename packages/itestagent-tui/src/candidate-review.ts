/**
 * Candidate review mode — pure functions for TUI candidate link interaction.
 *
 * R4-compliant: candidates carry evidence + confidence; only user-confirmed
 * links proceed to TestPlan / Flow (AC3).
 *
 * This module is framework-independent and testable without a renderer.
 */
import type { CandidateLink } from 'itestagent-project-analyzer';

// ─── Confidence helpers ────────────────────────────────────────

const CONFIDENCE_HIGH = 0.7;
const CONFIDENCE_MEDIUM = 0.4;

export type ConfidenceTier = 'high' | 'medium' | 'low';

export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= CONFIDENCE_HIGH) return 'high';
  if (confidence >= CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

export function getConfidenceLabel(confidence: number): string {
  if (confidence >= CONFIDENCE_HIGH) return 'High';
  if (confidence >= CONFIDENCE_MEDIUM) return 'Medium';
  return 'Low';
}

/**
 * Render a confidence bar as a text string for TUI display.
 * Example: "▰▰▰▰▰▰▱▱▱▱  0.75 High"
 */
export function formatConfidenceBar(confidence: number, width = 10): string {
  const filled = Math.round(confidence * width);
  const empty = width - filled;

  const bar = '▰'.repeat(filled) + '▱'.repeat(Math.max(0, empty));
  return `${bar}  ${confidence.toFixed(2)} ${getConfidenceLabel(confidence)}`;
}

// ─── Candidate operations (AC2: toggle, reorder, edit) ──────────

export function toggleCandidate(candidate: CandidateLink): CandidateLink {
  return { ...candidate, confirmed: !candidate.confirmed };
}

export function setCandidateConfirmed(
  candidates: CandidateLink[],
  index: number,
  confirmed: boolean,
): CandidateLink[] {
  return candidates.map((c, i) => (i === index ? { ...c, confirmed } : c));
}

export function toggleCandidateAtIndex(
  candidates: CandidateLink[],
  index: number,
): CandidateLink[] {
  if (index < 0 || index >= candidates.length) return candidates;
  return candidates.map((c, i) => (i === index ? toggleCandidate(c) : c));
}

export function editCandidateName(candidate: CandidateLink, newName: string): CandidateLink {
  return { ...candidate, name: newName };
}

export function editCandidateNameAtIndex(
  candidates: CandidateLink[],
  index: number,
  newName: string,
): CandidateLink[] {
  if (index < 0 || index >= candidates.length) return candidates;
  return candidates.map((c, i) => (i === index ? editCandidateName(c, newName) : c));
}

export function reorderCandidates(
  candidates: CandidateLink[],
  fromIndex: number,
  toIndex: number,
): CandidateLink[] {
  const len = candidates.length;
  if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len) {
    return candidates;
  }
  if (fromIndex === toIndex) return candidates;

  const result = [...candidates];
  const [moved] = result.splice(fromIndex, 1);
  if (moved) {
    result.splice(toIndex, 0, moved);
  }

  return result.map((c, i) => ({ ...c, displayOrder: i }));
}

// ─── Query helpers ──────────────────────────────────────────────

export function getConfirmedCandidates(candidates: CandidateLink[]): CandidateLink[] {
  return candidates.filter((c) => c.confirmed);
}

export function getUnconfirmedCandidates(candidates: CandidateLink[]): CandidateLink[] {
  return candidates.filter((c) => !c.confirmed);
}

export function confirmAllCandidates(candidates: CandidateLink[]): CandidateLink[] {
  return candidates.map((c) => ({ ...c, confirmed: true }));
}

export function unconfirmAllCandidates(candidates: CandidateLink[]): CandidateLink[] {
  return candidates.map((c) => ({ ...c, confirmed: false }));
}

export function sortByConfidence(candidates: CandidateLink[], descending = true): CandidateLink[] {
  const sorted = [...candidates].sort((a, b) =>
    descending ? b.confidence - a.confidence : a.confidence - b.confidence,
  );
  return sorted.map((c, i) => ({ ...c, displayOrder: i }));
}

export function sortByDisplayOrder(candidates: CandidateLink[]): CandidateLink[] {
  return [...candidates].sort((a, b) => a.displayOrder - b.displayOrder);
}
