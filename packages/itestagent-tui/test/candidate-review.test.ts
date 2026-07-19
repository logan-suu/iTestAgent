/**
 * Candidate review pure function tests.
 *
 * US-3.3 AC2: toggle, reorder, edit candidate links.
 * R4: these are candidate operations — confirmed flag is user-driven, not inferred.
 */
import { describe, expect, it } from 'bun:test';
import type { CandidateLink } from 'itestagent-project-analyzer';
import {
  confirmAllCandidates,
  editCandidateNameAtIndex,
  formatConfidenceBar,
  getConfidenceLabel,
  getConfidenceTier,
  getConfirmedCandidates,
  getUnconfirmedCandidates,
  reorderCandidates,
  setCandidateConfirmed,
  sortByConfidence,
  sortByDisplayOrder,
  toggleCandidate,
  toggleCandidateAtIndex,
  unconfirmAllCandidates,
} from '../src/candidate-review.js';

function makeCandidate(overrides: Partial<CandidateLink> = {}): CandidateLink {
  return {
    name: 'Login',
    evidence: ['Source: LoginViewController.swift'],
    confidence: 0.75,
    confirmed: false,
    displayOrder: 0,
    ...overrides,
  };
}

describe('getConfidenceTier', () => {
  it('returns high for confidence >= 0.7', () => {
    expect(getConfidenceTier(0.7)).toBe('high');
    expect(getConfidenceTier(0.9)).toBe('high');
    expect(getConfidenceTier(1.0)).toBe('high');
  });

  it('returns medium for confidence 0.4–0.69', () => {
    expect(getConfidenceTier(0.4)).toBe('medium');
    expect(getConfidenceTier(0.55)).toBe('medium');
    expect(getConfidenceTier(0.69)).toBe('medium');
  });

  it('returns low for confidence < 0.4', () => {
    expect(getConfidenceTier(0)).toBe('low');
    expect(getConfidenceTier(0.3)).toBe('low');
    expect(getConfidenceTier(0.39)).toBe('low');
  });
});

describe('getConfidenceLabel', () => {
  it('returns High for high tier', () => {
    expect(getConfidenceLabel(0.8)).toBe('High');
  });

  it('returns Medium for medium tier', () => {
    expect(getConfidenceLabel(0.5)).toBe('Medium');
  });

  it('returns Low for low tier', () => {
    expect(getConfidenceLabel(0.2)).toBe('Low');
  });
});

describe('formatConfidenceBar', () => {
  it('formats a full bar for confidence 1.0', () => {
    const bar = formatConfidenceBar(1.0, 10);
    expect(bar).toContain('1.00');
    expect(bar).toContain('High');
  });

  it('formats a half bar correctly', () => {
    const bar = formatConfidenceBar(0.5, 10);
    expect(bar).toContain('0.50');
    expect(bar).toContain('Medium');
  });

  it('formats an empty-ish bar for confidence 0', () => {
    const bar = formatConfidenceBar(0, 10);
    expect(bar).toContain('0.00');
    expect(bar).toContain('Low');
  });

  it('respects custom width', () => {
    const bar20 = formatConfidenceBar(0.75, 20);
    const bar5 = formatConfidenceBar(0.75, 5);
    expect(bar20.length).toBeGreaterThan(bar5.length);
  });
});

describe('toggleCandidate', () => {
  it('toggles confirmed from false to true', () => {
    const c = makeCandidate({ confirmed: false });
    const toggled = toggleCandidate(c);
    expect(toggled.confirmed).toBe(true);
  });

  it('toggles confirmed from true to false', () => {
    const c = makeCandidate({ confirmed: true });
    const toggled = toggleCandidate(c);
    expect(toggled.confirmed).toBe(false);
  });

  it('does not mutate the original', () => {
    const c = makeCandidate({ confirmed: false });
    toggleCandidate(c);
    expect(c.confirmed).toBe(false);
  });
});

describe('toggleCandidateAtIndex', () => {
  it('toggles the candidate at the given index', () => {
    const candidates = [
      makeCandidate({ name: 'A', confirmed: false }),
      makeCandidate({ name: 'B', confirmed: false }),
    ];
    const updated = toggleCandidateAtIndex(candidates, 0);
    expect(updated[0]?.confirmed).toBe(true);
    expect(updated[1]?.confirmed).toBe(false);
  });

  it('returns unchanged array for out-of-bounds index', () => {
    const candidates = [makeCandidate({ name: 'A' })];
    const updated = toggleCandidateAtIndex(candidates, 1);
    expect(updated).toBe(candidates);
  });
});

describe('setCandidateConfirmed', () => {
  it('sets confirmed to true', () => {
    const candidates = [makeCandidate({ name: 'A' })];
    const updated = setCandidateConfirmed(candidates, 0, true);
    expect(updated[0]?.confirmed).toBe(true);
  });

  it('sets confirmed to false', () => {
    const candidates = [makeCandidate({ name: 'A', confirmed: true })];
    const updated = setCandidateConfirmed(candidates, 0, false);
    expect(updated[0]?.confirmed).toBe(false);
  });
});

describe('editCandidateNameAtIndex', () => {
  it('updates the name at the given index', () => {
    const candidates = [makeCandidate({ name: 'OldName' })];
    const updated = editCandidateNameAtIndex(candidates, 0, 'NewName');
    expect(updated[0]?.name).toBe('NewName');
  });

  it('returns unchanged array for out-of-bounds index', () => {
    const candidates = [makeCandidate({ name: 'A' })];
    const updated = editCandidateNameAtIndex(candidates, 1, 'X');
    expect(updated).toBe(candidates);
  });
});

describe('reorderCandidates', () => {
  it('moves candidate from index 1 to 0', () => {
    const candidates = [
      makeCandidate({ name: 'A', displayOrder: 0 }),
      makeCandidate({ name: 'B', displayOrder: 1 }),
      makeCandidate({ name: 'C', displayOrder: 2 }),
    ];
    const updated = reorderCandidates(candidates, 1, 0);
    expect(updated[0]?.name).toBe('B');
    expect(updated[1]?.name).toBe('A');
    expect(updated[2]?.name).toBe('C');
  });

  it('updates displayOrder after reorder', () => {
    const candidates = [
      makeCandidate({ name: 'A', displayOrder: 0 }),
      makeCandidate({ name: 'B', displayOrder: 1 }),
    ];
    const updated = reorderCandidates(candidates, 0, 1);
    expect(updated[0]?.displayOrder).toBe(0);
    expect(updated[1]?.displayOrder).toBe(1);
  });

  it('returns unchanged array for same from/to', () => {
    const candidates = [makeCandidate({ name: 'A' })];
    const updated = reorderCandidates(candidates, 0, 0);
    expect(updated).toBe(candidates);
  });

  it('returns unchanged array for out-of-bounds', () => {
    const candidates = [makeCandidate({ name: 'A' })];
    expect(reorderCandidates(candidates, -1, 0)).toBe(candidates);
    expect(reorderCandidates(candidates, 0, 5)).toBe(candidates);
  });
});

describe('getConfirmedCandidates', () => {
  it('returns only confirmed candidates', () => {
    const candidates = [
      makeCandidate({ name: 'A', confirmed: true }),
      makeCandidate({ name: 'B', confirmed: false }),
      makeCandidate({ name: 'C', confirmed: true }),
    ];
    const confirmed = getConfirmedCandidates(candidates);
    expect(confirmed).toHaveLength(2);
    expect(confirmed[0]?.name).toBe('A');
    expect(confirmed[1]?.name).toBe('C');
  });
});

describe('getUnconfirmedCandidates', () => {
  it('returns only unconfirmed candidates', () => {
    const candidates = [
      makeCandidate({ name: 'A', confirmed: true }),
      makeCandidate({ name: 'B', confirmed: false }),
    ];
    const unconfirmed = getUnconfirmedCandidates(candidates);
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]?.name).toBe('B');
  });
});

describe('confirmAllCandidates', () => {
  it('sets all candidates to confirmed', () => {
    const candidates = [
      makeCandidate({ name: 'A', confirmed: false }),
      makeCandidate({ name: 'B', confirmed: false }),
    ];
    const updated = confirmAllCandidates(candidates);
    expect(updated[0]?.confirmed).toBe(true);
    expect(updated[1]?.confirmed).toBe(true);
  });
});

describe('unconfirmAllCandidates', () => {
  it('sets all candidates to unconfirmed', () => {
    const candidates = [
      makeCandidate({ name: 'A', confirmed: true }),
      makeCandidate({ name: 'B', confirmed: true }),
    ];
    const updated = unconfirmAllCandidates(candidates);
    expect(updated[0]?.confirmed).toBe(false);
    expect(updated[1]?.confirmed).toBe(false);
  });
});

describe('sortByConfidence', () => {
  it('sorts in descending order by default', () => {
    const candidates = [
      makeCandidate({ name: 'A', confidence: 0.3 }),
      makeCandidate({ name: 'B', confidence: 0.9 }),
      makeCandidate({ name: 'C', confidence: 0.6 }),
    ];
    const sorted = sortByConfidence(candidates);
    expect(sorted[0]?.name).toBe('B');
    expect(sorted[1]?.name).toBe('C');
    expect(sorted[2]?.name).toBe('A');
  });

  it('updates displayOrder after sorting', () => {
    const candidates = [
      makeCandidate({ name: 'A', confidence: 0.3 }),
      makeCandidate({ name: 'B', confidence: 0.9 }),
    ];
    const sorted = sortByConfidence(candidates);
    expect(sorted[0]?.displayOrder).toBe(0);
    expect(sorted[1]?.displayOrder).toBe(1);
  });
});

describe('sortByDisplayOrder', () => {
  it('sorts by displayOrder ascending', () => {
    const candidates = [
      makeCandidate({ name: 'B', displayOrder: 1 }),
      makeCandidate({ name: 'A', displayOrder: 0 }),
    ];
    const sorted = sortByDisplayOrder(candidates);
    expect(sorted[0]?.name).toBe('A');
    expect(sorted[1]?.name).toBe('B');
  });
});
