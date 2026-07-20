/**
 * itestagent-tui pure exports — framework-independent functions.
 *
 * Use this barrel in tests and packages that only need plan review,
 * candidate review, or shell types without pulling in JSX/renderer deps.
 */
export {
  createInitialState,
  tuiShellReducer,
  type TuiShellState,
  type TuiShellEvent,
  type TuiShellMode,
  type Message,
  type DeviceStatus,
} from './tui-shell.js';

export {
  getConfidenceTier,
  getConfidenceLabel,
  formatConfidenceBar,
  toggleCandidate,
  toggleCandidateAtIndex,
  editCandidateName,
  editCandidateNameAtIndex,
  reorderCandidates,
  getConfirmedCandidates,
  sortByConfidence,
  sortByDisplayOrder,
  type ConfidenceTier,
} from './candidate-review.js';

export {
  formatPlanSections,
  formatEstimatedDuration,
  formatExecutionPath,
  navigatePlanSection,
  type PlanSection,
  type PlanSectionId,
  type PlanField,
  type PlanReviewAction,
  PLAN_SECTIONS,
} from './plan-review.js';
