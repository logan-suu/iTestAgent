/**
 * itestagent-tui 入口 — 启动 TUI Shell。
 *
 * 技术选型文档 §5：
 *   TuiShell ViewModel/Event/reducer 应 framework-independent，
 *   OpenTUI 和 Ink 都只是 renderer。
 *
 * US-4.1 AC1：itestagent 无参数时进入 TUI。
 */

import type { TuiRenderer } from './renderer.js';
import { createInkRenderer } from './renderers/ink-renderer.js';
import { type TuiShellEvent, createInitialState } from './tui-shell.js';

/**
 * 启动 TUI。
 *
 * 默认使用 Ink renderer（已验证 fallback）。
 * 后续可切换为 OpenTUI renderer，只需替换 renderer 实现。
 *
 * @param workspace 可选工作目录。默认 `process.cwd()`。
 */
export async function startTui(workspace?: string): Promise<void> {
  // Ink 要求交互式终端（stdin + stdout 都是 TTY）；非 TTY 环境输出提示
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('iTestAgent TUI requires a terminal.');
    console.log("Run 'itestagent --help' for available commands.");
    return;
  }

  const renderer: TuiRenderer = createInkRenderer();

  const state = createInitialState(workspace);

  // 收集事件，用于外部断言/测试
  const events: TuiShellEvent[] = [];

  const dispatch = (event: TuiShellEvent): void => {
    events.push(event);
  };

  await renderer.start(state, dispatch);

  // TUI 退出后，不再需要额外清理
}

// 重新导出类型，便于外部使用
export type { TuiRenderer } from './renderer.js';
export {
  createInitialState,
  tuiShellReducer,
  type TuiShellState,
  type TuiShellEvent,
  type Message,
  type DeviceStatus,
} from './tui-shell.js';
