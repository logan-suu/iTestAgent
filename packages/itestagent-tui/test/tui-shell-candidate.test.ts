/**
 * TuiShell candidate review mode reducer tests.
 *
 * US-3.3 AC2-AC4: candidate toggle, navigate, reorder, edit, confirm.
 * R4: candidate events never auto-finalize — confirmed flag is user-driven.
 */
import { describe, expect, it } from 'bun:test';
import type { CandidateLink } from 'itestagent-project-analyzer';
import {
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
  tuiShellReducer,
} from '../src/tui-shell.js';

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

function makeCandidates(count: number): CandidateLink[] {
  return Array.from({ length: count }, (_, i) =>
    makeCandidate({ name: `Feature${i + 1}`, displayOrder: i }),
  );
}

function enterCandidateReview(state: TuiShellState, candidates: CandidateLink[]): TuiShellState {
  return tuiShellReducer(state, {
    type: 'enter_candidate_review',
    candidates,
  });
}

describe('enter_candidate_review event', () => {
  it('switches mode to candidate_review', () => {
    const state = createInitialState('/test');
    const next = tuiShellReducer(state, {
      type: 'enter_candidate_review',
      candidates: makeCandidates(3),
    });
    expect(next.mode).toBe('candidate_review');
  });

  it('populates candidates and resets index to 0', () => {
    const state = createInitialState('/test');
    const candidates = makeCandidates(3);
    const next = tuiShellReducer(state, {
      type: 'enter_candidate_review',
      candidates,
    });
    expect(next.candidates).toHaveLength(3);
    expect(next.candidateIndex).toBe(0);
    expect(next.candidateEditMode).toBe(false);
  });
});

describe('exit_candidate_review event', () => {
  it('switches mode back to chat', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const next = tuiShellReducer(review, { type: 'exit_candidate_review' });
    expect(next.mode).toBe('chat');
  });

  it('resets candidate index to 0', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const navigated = tuiShellReducer(review, {
      type: 'candidate_navigate',
      direction: 'down',
    });
    const next = tuiShellReducer(navigated, { type: 'exit_candidate_review' });
    expect(next.candidateIndex).toBe(0);
  });
});

describe('candidate_toggle event', () => {
  it('toggles the selected candidate confirmed flag', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const next = tuiShellReducer(review, { type: 'candidate_toggle' });
    expect(next.candidates[0]?.confirmed).toBe(true);
  });

  it('toggles back on second call', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const toggled = tuiShellReducer(review, { type: 'candidate_toggle' });
    const toggledAgain = tuiShellReducer(toggled, { type: 'candidate_toggle' });
    expect(toggledAgain.candidates[0]?.confirmed).toBe(false);
  });

  it('does nothing when candidate list is empty', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, []);
    const next = tuiShellReducer(review, { type: 'candidate_toggle' });
    expect(next.candidates).toHaveLength(0);
  });
});

describe('candidate_navigate event', () => {
  it('moves index down', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    const next = tuiShellReducer(review, {
      type: 'candidate_navigate',
      direction: 'down',
    });
    expect(next.candidateIndex).toBe(1);
  });

  it('moves index up', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    const atBottom = tuiShellReducer(review, {
      type: 'candidate_navigate',
      direction: 'down',
    });
    const backUp = tuiShellReducer(atBottom, {
      type: 'candidate_navigate',
      direction: 'up',
    });
    expect(backUp.candidateIndex).toBe(0);
  });

  it('wraps around from last to first', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    let current = review;
    for (let i = 0; i < 3; i++) {
      current = tuiShellReducer(current, {
        type: 'candidate_navigate',
        direction: 'down',
      });
    }
    expect(current.candidateIndex).toBe(0);
  });

  it('wraps around from first to last', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    const next = tuiShellReducer(review, {
      type: 'candidate_navigate',
      direction: 'up',
    });
    expect(next.candidateIndex).toBe(2);
  });
});

describe('candidate_reorder event', () => {
  it('moves candidate up (reorder direction up)', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    const atIndex1 = tuiShellReducer(review, {
      type: 'candidate_navigate',
      direction: 'down',
    });
    const reordered = tuiShellReducer(atIndex1, {
      type: 'candidate_reorder',
      direction: 'up',
    });
    expect(reordered.candidates[0]?.name).toBe('Feature2');
    expect(reordered.candidates[1]?.name).toBe('Feature1');
  });

  it('updates candidateIndex after reorder', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    const atIndex2 = tuiShellReducer(
      tuiShellReducer(review, {
        type: 'candidate_navigate',
        direction: 'down',
      }),
      { type: 'candidate_navigate', direction: 'down' },
    );
    const reordered = tuiShellReducer(atIndex2, {
      type: 'candidate_reorder',
      direction: 'up',
    });
    expect(reordered.candidateIndex).toBe(1);
  });
});

describe('candidate_edit events', () => {
  it('starts edit mode with current candidate name', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const next = tuiShellReducer(review, { type: 'candidate_edit_start' });
    expect(next.candidateEditMode).toBe(true);
    expect(next.candidateEditDraft).toBe('Feature1');
  });

  it('does nothing on empty list', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, []);
    const next = tuiShellReducer(review, { type: 'candidate_edit_start' });
    expect(next.candidateEditMode).toBe(false);
  });

  it('updates edit draft on candidate_edit_input', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const editing = tuiShellReducer(review, { type: 'candidate_edit_start' });
    const next = tuiShellReducer(editing, {
      type: 'candidate_edit_input',
      text: 'NewFeature',
    });
    expect(next.candidateEditDraft).toBe('NewFeature');
  });

  it('commits edit and resets edit mode', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const editing = tuiShellReducer(review, { type: 'candidate_edit_start' });
    const typed = tuiShellReducer(editing, {
      type: 'candidate_edit_input',
      text: 'NewFeature',
    });
    const committed = tuiShellReducer(typed, {
      type: 'candidate_edit_commit',
    });
    expect(committed.candidateEditMode).toBe(false);
    expect(committed.candidates[0]?.name).toBe('NewFeature');
  });

  it('cancels edit and resets draft', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(2));
    const editing = tuiShellReducer(review, { type: 'candidate_edit_start' });
    const typed = tuiShellReducer(editing, {
      type: 'candidate_edit_input',
      text: 'Changed',
    });
    const cancelled = tuiShellReducer(typed, {
      type: 'candidate_edit_cancel',
    });
    expect(cancelled.candidateEditMode).toBe(false);
    expect(cancelled.candidates[0]?.name).toBe('Feature1');
    expect(cancelled.candidateEditDraft).toBe('');
  });
});

describe('candidate_confirm_all / candidate_unconfirm_all', () => {
  it('confirms all candidates', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    const confirmed = tuiShellReducer(review, {
      type: 'candidate_confirm_all',
    });
    for (const c of confirmed.candidates) {
      expect(c.confirmed).toBe(true);
    }
  });

  it('unconfirms all candidates', () => {
    const state = createInitialState('/test');
    const review = enterCandidateReview(state, makeCandidates(3));
    const confirmed = tuiShellReducer(review, {
      type: 'candidate_confirm_all',
    });
    const unconfirmed = tuiShellReducer(confirmed, {
      type: 'candidate_unconfirm_all',
    });
    for (const c of unconfirmed.candidates) {
      expect(c.confirmed).toBe(false);
    }
  });
});

describe('default state fields for candidate review', () => {
  it('createInitialState has empty candidates and chat mode', () => {
    const state = createInitialState('/test');
    expect(state.mode).toBe('chat');
    expect(state.candidates).toHaveLength(0);
    expect(state.candidateIndex).toBe(0);
    expect(state.candidateEditMode).toBe(false);
    expect(state.candidateEditDraft).toBe('');
  });
});
