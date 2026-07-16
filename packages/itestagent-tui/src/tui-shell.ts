/**
 * TuiShell — framework-independent ViewModel, State, Event, and reducer.
 *
 * Architecture:
 *   AGENTS.md §4 / 架构设计文档 §3：TUI 不直接调用底层工具。
 *   技术选型文档 §5：TuiShell ViewModel/Event/reducer 应 framework-independent，
 *   OpenTUI 和 Ink 都只是 renderer。
 *
 * US-4.1 AC1-AC3：itestagent 无参数进入 TUI，显示 workspace/设备状态/可输入自然语言。
 */

// ─── State ─────────────────────────────────────────────────────────────

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
  readonly messages: readonly Message[];
  readonly inputDraft: string;
  readonly running: boolean;
}

// ─── Events ────────────────────────────────────────────────────────────

export type TuiShellEvent =
  | { readonly type: 'input'; readonly text: string }
  | { readonly type: 'submit' }
  | { readonly type: 'quit' }
  | { readonly type: 'system_message'; readonly text: string }
  | { readonly type: 'device_status_updated'; readonly status: DeviceStatus };

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * 创建 TuiShell 初始状态。
 * @param workspace 当前工作目录。默认 `process.cwd()`。
 */
export function createInitialState(workspace?: string): TuiShellState {
  return {
    workspace: workspace ?? process.cwd(),
    deviceStatus: 'no_device',
    messages: [],
    inputDraft: '',
    running: true,
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
      if (!trimmed) return state; // 空提交不产生消息
      const msg: Message = {
        id: makeId(),
        type: 'user',
        text: trimmed,
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, msg],
        inputDraft: '',
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
  }
}
