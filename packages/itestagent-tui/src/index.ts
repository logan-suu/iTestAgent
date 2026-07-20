/**
 * itestagent-tui — TUI Shell public API.
 *
 * US-4.1 AC1：itestagent 无参数时进入 TUI。
 */
export { startTui } from './entry.js';
export type { TuiRenderer } from './renderer.js';
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
