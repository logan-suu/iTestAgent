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

export {
  formatCredentialPromptHeader,
  formatCredentialStatus,
  maskValue,
  validateCredentialInput,
} from './credential-prompt.js';

export {
  BOLD,
  CHAT_PROMPT,
  CSI,
  CYAN,
  DEFAULT_COLUMNS,
  DIM,
  GREEN,
  MAX_SEPARATOR_WIDTH,
  RED,
  RESET,
  SEPARATOR_CHAR,
  YELLOW,
  effectiveColumns,
  separatorLine,
  separatorWidth,
} from './ansi-layout.js';

export {
  type AnsiInputHandler,
  type AnsiInputHooks,
  createAnsiInputHandler,
} from './ansi-input.js';

export {
  clearScreen,
  moveCursorToPromptColumn,
  moveTo,
  renderFrame,
  renderScreen,
  type FrameWriteTarget,
} from './renderers/ansi-renderer-frame.js';

export {
  CANDIDATE_REVIEW_KEYMAP,
  EDIT_CANCEL_KEY,
  EDIT_COMMIT_KEY,
  PLAN_REVIEW_KEYMAP,
  lookupKeyAction,
} from './keymap-registry.js';

export {
  type KeyDispatchContext,
  type KeyDispatchResult,
  dispatchCandidateKey,
  dispatchPlanKey,
} from './renderers/opentui-key-dispatch.js';

export {
  CANDIDATE_EDITING_HINT,
  CANDIDATE_REVIEW_FOOTER_HINTS,
  FOOTER_CMD_LABEL,
  PLAN_MODIFYING_HINT,
  PLAN_REVIEW_FOOTER_HINTS,
  candidateFooterStatus,
  planFooterStatus,
} from './renderers/opentui-footer.js';

export {
  type OpenTuiLifecycle,
  type OpenTuiStateRef,
  type ResizeSource,
  attachLiveResize,
  createOpenTuiLifecycle,
  createOpenTuiStateRef,
  draftForEvent,
} from './renderers/opentui-renderer-lifecycle.js';

export {
  type RendererKind,
  type RendererPreferences,
  type TerminalCapabilities,
  detectCapabilities,
  detectProcessCapabilities,
  selectRenderer,
} from './renderer-selection.js';
