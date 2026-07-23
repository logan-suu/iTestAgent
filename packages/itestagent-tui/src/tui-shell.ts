import type {
  CredentialRequest,
  CredentialResponse,
  IntentParseResult,
  TestPlan,
} from 'itestagent-contracts';
/**
 * TuiShell — framework-independent ViewModel, State, Event, and reducer.
 *
 * Architecture:
 *   AGENTS.md §4 / 架构设计文档 §3：TUI 不直接调用底层工具。
 *   技术选型文档 §5：TuiShell ViewModel/Event/reducer 应 framework-independent，
 *   OpenTUI 和 Ink 都只是 renderer。
 *
 * US-4.1 AC1-AC3：itestagent 无参数进入 TUI，显示 workspace/设备状态/可输入自然语言。
 * US-3.3 AC2-AC4：candidate_review mode for user confirmation of core paths.
 * US-4.2 AC1：multi-turn dialog with intent clarification.
 */
import type { CandidateLink } from 'itestagent-project-analyzer';
import {
  confirmAllCandidates,
  editCandidateNameAtIndex,
  reorderCandidates,
  toggleCandidateAtIndex,
  unconfirmAllCandidates,
} from './candidate-review.js';
import { PLAN_SECTIONS, navigatePlanSection } from './plan-review.js';

// ─── State ─────────────────────────────────────────────────────────────

export type TuiShellMode =
  | 'chat'
  | 'candidate_review'
  | 'plan_review'
  | 'recording_review'
  | 'credential_prompt';

/** 设备连接状态。当前为占位值，后续由 engine/server 驱动。 */
export type DeviceStatus = 'no_device' | 'checking' | 'healthy' | 'untrusted' | 'busy';

/** 一条消息。 */
export interface Message {
  readonly id: string;
  readonly type: 'user' | 'system' | 'error';
  readonly text: string;
  readonly timestamp: number;
}

/** TuiShell 完整状态。 */
export interface TuiShellState {
  readonly workspace: string;
  readonly deviceStatus: DeviceStatus;
  readonly mode: TuiShellMode;
  readonly messages: readonly Message[];
  readonly inputDraft: string;
  readonly running: boolean;
  /** Candidate review state (only meaningful when mode === 'candidate_review'). */
  readonly candidates: readonly CandidateLink[];
  readonly candidateIndex: number;
  readonly candidateEditMode: boolean;
  readonly candidateEditDraft: string;
  /** Current intent parse result (US-4.2 AC1: multi-turn clarification). */
  readonly currentIntent: IntentParseResult | null;
  /** Plan review state (US-5.2: plan_review mode). */
  readonly plan: TestPlan | null;
  readonly planSectionIndex: number;
  readonly planModifyMode: boolean;
  readonly planModifyDraft: string;
  readonly planConfirmed: boolean;
  /** Recording review state (US-8.2: recording_review mode). */
  readonly recordingState: string; // idle | suggesting | awaiting_confirmation | executing | paused | completed | cancelled
  readonly recordingFeatureName: string;
  readonly recordingStepIndex: number;
  readonly recordingTotalSteps: number; // confirmed + skipped count
  readonly recordingConfirmedSteps: unknown[]; // RecordingStep[]
  readonly recordingSuggestedAction: unknown | null; // SuggestedAction | null
  readonly recordingSuggestionReasoning: string; // Agent's reasoning text
  readonly recordingModifyMode: boolean;
  readonly recordingModifyDraft: string;
  readonly recordingPaused: boolean;
  readonly recordingCompleted: boolean;
  /** Credential prompt state (US-10.2: credential_prompt mode). */
  readonly credentialRequests: readonly CredentialRequest[];
  readonly credentialIndex: number;
  readonly credentialInputDraft: string;
  readonly credentialResponses: ReadonlyMap<string, CredentialResponse>;
  readonly credentialCompleted: boolean;
  readonly credentialRememberToggled: boolean;
}

// ─── Events ────────────────────────────────────────────────────────────

export type TuiShellEvent =
  | { readonly type: 'input'; readonly text: string }
  | { readonly type: 'submit' }
  | { readonly type: 'quit' }
  | { readonly type: 'system_message'; readonly text: string }
  | { readonly type: 'device_status_updated'; readonly status: DeviceStatus }
  // Candidate review events (US-3.3 AC2)
  | { readonly type: 'enter_candidate_review'; readonly candidates: readonly CandidateLink[] }
  | { readonly type: 'exit_candidate_review' }
  | { readonly type: 'candidate_toggle' }
  | { readonly type: 'candidate_navigate'; readonly direction: 'up' | 'down' }
  | { readonly type: 'candidate_reorder'; readonly direction: 'up' | 'down' }
  | { readonly type: 'candidate_edit_start' }
  | { readonly type: 'candidate_edit_input'; readonly text: string }
  | { readonly type: 'candidate_edit_commit' }
  | { readonly type: 'candidate_edit_cancel' }
  | { readonly type: 'candidate_confirm_all' }
  | { readonly type: 'candidate_unconfirm_all' }
  // Intent events (US-4.2 AC1)
  | { readonly type: 'intent_parsed'; readonly result: IntentParseResult }
  | { readonly type: 'intent_clarify_response'; readonly text: string }
  | { readonly type: 'intent_cancel' }
  // Plan review events (US-5.2 AC1-AC3)
  | { readonly type: 'enter_plan_review'; readonly plan: TestPlan }
  | { readonly type: 'exit_plan_review' }
  | { readonly type: 'plan_confirm' }
  | { readonly type: 'plan_cancel' }
  | { readonly type: 'plan_navigate_section'; readonly direction: 'up' | 'down' }
  | { readonly type: 'plan_start_modify' }
  | { readonly type: 'plan_modify_input'; readonly text: string }
  | { readonly type: 'plan_modify_submit' }
  | { readonly type: 'plan_modify_cancel' }
  // Recording review events (US-8.2 AC1-AC3)
  | { readonly type: 'enter_recording'; readonly featureName: string }
  | { readonly type: 'exit_recording' }
  | { readonly type: 'recording_suggestion'; readonly action: unknown; readonly reasoning: string }
  | { readonly type: 'recording_confirm' }
  | { readonly type: 'recording_modify_start' }
  | { readonly type: 'recording_modify_input'; readonly text: string }
  | { readonly type: 'recording_modify_submit' }
  | { readonly type: 'recording_modify_cancel' }
  | { readonly type: 'recording_skip' }
  | { readonly type: 'recording_pause' }
  | { readonly type: 'recording_resume' }
  | { readonly type: 'recording_cancel' }
  | { readonly type: 'recording_state_changed'; readonly state: string }
  | { readonly type: 'recording_step_recorded' }
  // Credential prompt events (US-10.2 AC1-AC5)
  | { readonly type: 'enter_credential_prompt'; readonly requests: readonly CredentialRequest[] }
  | { readonly type: 'exit_credential_prompt' }
  | { readonly type: 'credential_input'; readonly text: string }
  | { readonly type: 'credential_submit' }
  | { readonly type: 'credential_skip' }
  | { readonly type: 'credential_toggle_remember' }
  | { readonly type: 'credential_confirm_all' };

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * 创建 TuiShell 初始状态。
 * @param workspace 当前工作目录。默认 `process.cwd()`。
 */
export function createInitialState(workspace?: string): TuiShellState {
  return {
    workspace: workspace ?? process.cwd(),
    deviceStatus: 'no_device',
    mode: 'chat',
    messages: [],
    inputDraft: '',
    running: true,
    candidates: [],
    candidateIndex: 0,
    candidateEditMode: false,
    candidateEditDraft: '',
    currentIntent: null,
    plan: null,
    planSectionIndex: 0,
    planModifyMode: false,
    planModifyDraft: '',
    planConfirmed: false,
    recordingState: 'idle',
    recordingFeatureName: '',
    recordingStepIndex: 0,
    recordingTotalSteps: 0,
    recordingConfirmedSteps: [],
    recordingSuggestedAction: null,
    recordingSuggestionReasoning: '',
    recordingModifyMode: false,
    recordingModifyDraft: '',
    recordingPaused: false,
    recordingCompleted: false,
    credentialRequests: [],
    credentialIndex: 0,
    credentialInputDraft: '',
    credentialResponses: new Map(),
    credentialCompleted: false,
    credentialRememberToggled: false,
  };
}

/** 生成 v4-like 消息 ID（无 crypto 依赖，适用于 Bun/Node 测试环境）。 */
function makeId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback for ancient runtimes — not expected in Bun/Node 16+
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Reducer ───────────────────────────────────────────────────────────

/**
 * TuiShell reducer — 纯函数，无副作用。
 *
 * 处理事件并返回新状态。不修改原状态。
 */
export function tuiShellReducer(state: TuiShellState, event: TuiShellEvent): TuiShellState {
  switch (event.type) {
    case 'input':
      return { ...state, inputDraft: event.text };

    case 'submit': {
      const trimmed = state.inputDraft.trim();
      if (!trimmed) return state;
      const msg: Message = {
        id: makeId(),
        type: 'user',
        text: trimmed,
        timestamp: Date.now(),
      };
      // If submitting during active clarification (US-4.2 AC1: multi-turn),
      // treat as clarification response and clear the pending intent.
      const isClarificationResponse = state.currentIntent?.status === 'incomplete';
      return {
        ...state,
        messages: [...state.messages, msg],
        inputDraft: '',
        currentIntent: isClarificationResponse ? null : state.currentIntent,
      };
    }

    case 'system_message': {
      const msg: Message = {
        id: makeId(),
        type: 'system',
        text: event.text,
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, msg],
      };
    }

    case 'device_status_updated':
      return { ...state, deviceStatus: event.status };

    case 'quit':
      return { ...state, running: false };

    // ── Candidate review events (US-3.3 AC2) ───────────────────────

    case 'enter_candidate_review':
      return {
        ...state,
        mode: 'candidate_review',
        candidates: event.candidates,
        candidateIndex: 0,
        candidateEditMode: false,
        candidateEditDraft: '',
      };

    case 'exit_candidate_review':
      return {
        ...state,
        mode: 'chat',
        candidateIndex: 0,
        candidateEditMode: false,
        candidateEditDraft: '',
      };

    case 'candidate_toggle': {
      const updated = toggleCandidateAtIndex(
        state.candidates as CandidateLink[],
        state.candidateIndex,
      );
      return { ...state, candidates: updated };
    }

    case 'candidate_navigate': {
      const len = state.candidates.length;
      if (len === 0) return state;
      const delta = event.direction === 'up' ? -1 : 1;
      const next = (state.candidateIndex + delta + len) % len;
      return { ...state, candidateIndex: next };
    }

    case 'candidate_reorder': {
      const idx = state.candidateIndex;
      const targetIdx = event.direction === 'up' ? idx - 1 : idx + 1;
      const updated = reorderCandidates(state.candidates as CandidateLink[], idx, targetIdx);
      const newIdx =
        event.direction === 'up' ? Math.max(0, idx - 1) : Math.min(updated.length - 1, idx + 1);
      return { ...state, candidates: updated, candidateIndex: newIdx };
    }

    case 'candidate_edit_start': {
      const current = state.candidates[state.candidateIndex];
      if (!current) return state;
      return {
        ...state,
        candidateEditMode: true,
        candidateEditDraft: current.name,
      };
    }

    case 'candidate_edit_input':
      return { ...state, candidateEditDraft: event.text };

    case 'candidate_edit_commit': {
      const updated = editCandidateNameAtIndex(
        state.candidates as CandidateLink[],
        state.candidateIndex,
        state.candidateEditDraft,
      );
      return {
        ...state,
        candidates: updated,
        candidateEditMode: false,
        candidateEditDraft: '',
      };
    }

    case 'candidate_edit_cancel':
      return {
        ...state,
        candidateEditMode: false,
        candidateEditDraft: '',
      };

    case 'candidate_confirm_all': {
      const updated = confirmAllCandidates(state.candidates as CandidateLink[]);
      return { ...state, candidates: updated };
    }

    case 'candidate_unconfirm_all': {
      const updated = unconfirmAllCandidates(state.candidates as CandidateLink[]);
      return { ...state, candidates: updated };
    }

    // ── Intent events (US-4.2 AC1) ───────────────────────────

    case 'intent_parsed': {
      const next: TuiShellState = { ...state, currentIntent: event.result };
      // For incomplete intents, append clarification questions as system messages
      if (event.result.status === 'incomplete') {
        const clarifications = event.result.clarificationsNeeded;
        const msgs = clarifications.map((c) => ({
          id: makeId(),
          type: 'system' as const,
          text: c.options ? `${c.question} [${c.options.join(' / ')}]` : c.question,
          timestamp: Date.now(),
        }));
        return { ...next, messages: [...state.messages, ...msgs] };
      }
      return next;
    }

    case 'intent_clarify_response': {
      // User explicitly responds to a clarification with a preset answer
      const msg: Message = {
        id: makeId(),
        type: 'user',
        text: event.text,
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, msg],
        currentIntent: null,
      };
    }

    case 'intent_cancel':
      return { ...state, currentIntent: null };

    // ── Plan review events (US-5.2 AC1-AC3) ─────────────────

    case 'enter_plan_review':
      return {
        ...state,
        mode: 'plan_review',
        plan: event.plan,
        planSectionIndex: 0,
        planModifyMode: false,
        planModifyDraft: '',
        planConfirmed: false,
      };

    case 'exit_plan_review':
      return {
        ...state,
        mode: 'chat',
        planSectionIndex: 0,
        planModifyMode: false,
        planModifyDraft: '',
      };

    case 'plan_confirm':
      return {
        ...state,
        mode: 'chat',
        planConfirmed: true,
        planModifyMode: false,
        planModifyDraft: '',
      };

    case 'plan_cancel':
      return {
        ...state,
        mode: 'chat',
        plan: null,
        planConfirmed: false,
        planModifyMode: false,
        planModifyDraft: '',
      };

    case 'plan_navigate_section': {
      return {
        ...state,
        planSectionIndex: navigatePlanSection(
          state.planSectionIndex,
          event.direction,
          PLAN_SECTIONS.length,
        ),
      };
    }

    case 'plan_start_modify':
      return {
        ...state,
        planModifyMode: true,
        planModifyDraft: '',
      };

    case 'plan_modify_input':
      return { ...state, planModifyDraft: event.text };

    case 'plan_modify_submit':
      return {
        ...state,
        planModifyMode: false,
        mode: 'chat',
        // planModifyDraft retains the modification text for engine consumption
      };

    case 'plan_modify_cancel':
      return {
        ...state,
        planModifyMode: false,
        planModifyDraft: '',
      };

    // ── Recording review events (US-8.2 AC1-AC3) ────────────

    case 'enter_recording':
      return {
        ...state,
        mode: 'recording_review',
        recordingState: 'idle',
        recordingFeatureName: event.featureName,
        recordingStepIndex: 0,
        recordingTotalSteps: 0,
        recordingConfirmedSteps: [],
        recordingSuggestedAction: null,
        recordingSuggestionReasoning: '',
        recordingModifyMode: false,
        recordingModifyDraft: '',
        recordingPaused: false,
        recordingCompleted: false,
      };

    case 'exit_recording':
      return {
        ...state,
        mode: 'chat',
        recordingState: 'idle',
        recordingFeatureName: '',
        recordingSuggestedAction: null,
        recordingSuggestionReasoning: '',
        recordingModifyMode: false,
        recordingModifyDraft: '',
      };

    case 'recording_suggestion':
      return {
        ...state,
        recordingState: 'awaiting_confirmation',
        recordingSuggestedAction: event.action,
        recordingSuggestionReasoning: event.reasoning,
      };

    case 'recording_confirm':
      return {
        ...state,
        recordingState: 'executing',
        recordingSuggestedAction: null,
        recordingSuggestionReasoning: '',
      };

    case 'recording_modify_start':
      return {
        ...state,
        recordingModifyMode: true,
        recordingModifyDraft: '',
      };

    case 'recording_modify_input':
      return { ...state, recordingModifyDraft: event.text };

    case 'recording_modify_submit':
      return {
        ...state,
        recordingState: 'executing',
        recordingSuggestedAction: null,
        recordingSuggestionReasoning: '',
        recordingModifyMode: false,
        recordingModifyDraft: '',
      };

    case 'recording_modify_cancel':
      return {
        ...state,
        recordingModifyMode: false,
        recordingModifyDraft: '',
      };

    case 'recording_skip':
      return {
        ...state,
        recordingState: 'suggesting',
        recordingSuggestedAction: null,
        recordingSuggestionReasoning: '',
        recordingTotalSteps: state.recordingTotalSteps + 1,
      };

    case 'recording_pause':
      return {
        ...state,
        recordingState: 'paused',
        recordingPaused: true,
      };

    case 'recording_resume':
      return {
        ...state,
        recordingState: 'awaiting_confirmation',
        recordingPaused: false,
      };

    case 'recording_cancel':
      return {
        ...state,
        mode: 'chat',
        recordingState: 'cancelled',
        recordingPaused: false,
        recordingSuggestedAction: null,
        recordingSuggestionReasoning: '',
      };

    case 'recording_state_changed':
      return {
        ...state,
        recordingState: event.state,
        recordingPaused: event.state === 'paused',
        recordingCompleted: event.state === 'completed' || event.state === 'cancelled',
      };

    case 'recording_step_recorded':
      return {
        ...state,
        recordingState: 'suggesting',
        recordingStepIndex: state.recordingStepIndex + 1,
        recordingTotalSteps: state.recordingTotalSteps + 1,
      };

    // ── Credential prompt events (US-10.2 AC1-AC5) ────────

    case 'enter_credential_prompt':
      return {
        ...state,
        mode: 'credential_prompt',
        credentialRequests: event.requests,
        credentialIndex: 0,
        credentialInputDraft: '',
        credentialResponses: new Map(),
        credentialCompleted: false,
        credentialRememberToggled: false,
      };

    case 'exit_credential_prompt':
      return {
        ...state,
        mode: 'chat',
      };

    case 'credential_input':
      return { ...state, credentialInputDraft: event.text };

    case 'credential_submit': {
      const currentReq = state.credentialRequests[state.credentialIndex];
      if (!currentReq) return state;

      const trimmed = state.credentialInputDraft.trim();
      const response: CredentialResponse = {
        key: currentReq.key,
        status: trimmed.length > 0 ? 'provided' : 'skipped',
        value: trimmed.length > 0 ? trimmed : undefined,
        remembered: state.credentialRememberToggled,
      };

      const nextResponses = new Map(state.credentialResponses);
      nextResponses.set(currentReq.key, response);

      const nextIndex = state.credentialIndex + 1;
      const completed = nextIndex >= state.credentialRequests.length;

      return {
        ...state,
        credentialResponses: nextResponses,
        credentialInputDraft: '',
        credentialIndex: nextIndex,
        credentialCompleted: completed,
        credentialRememberToggled: false,
      };
    }

    case 'credential_skip': {
      const currentReq = state.credentialRequests[state.credentialIndex];
      if (!currentReq) return state;

      const response: CredentialResponse = {
        key: currentReq.key,
        status: 'skipped',
        remembered: false,
      };

      const nextResponses = new Map(state.credentialResponses);
      nextResponses.set(currentReq.key, response);

      const nextIndex = state.credentialIndex + 1;
      const completed = nextIndex >= state.credentialRequests.length;

      return {
        ...state,
        credentialResponses: nextResponses,
        credentialInputDraft: '',
        credentialIndex: nextIndex,
        credentialCompleted: completed,
        credentialRememberToggled: false,
      };
    }

    case 'credential_toggle_remember':
      return {
        ...state,
        credentialRememberToggled: !state.credentialRememberToggled,
      };

    case 'credential_confirm_all':
      return {
        ...state,
        mode: 'chat',
        credentialCompleted: true,
      };
  }
}
