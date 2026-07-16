/**
 * itestagent-tui 入口 — 启动 TUI Shell。
 *
 * ADR-008：OpenTUI+SolidJS 目标主线，Ink 已验证 fallback。
 *   技术选型文档 §5：TuiShell ViewModel/Event/reducer 应 framework-independent。
 *
 * US-4.1 AC1：itestagent 无参数时进入 OpenTUI 交互式界面。
 */

import type { TuiRenderer } from './renderer.js';
import { createOpenTuiRenderer } from './renderers/opentui-renderer.js';
import { createInitialState } from './tui-shell.js';

/**
 * 启动 TUI。
 *
 * 默认使用 OpenTUI+SolidJS renderer（目标主线，ADR-008）。
 * 非 TTY 环境输出提示并退出。
 *
 * @param workspace 可选工作目录。默认 `process.cwd()`。
 */
export async function startTui(workspace?: string): Promise<void> {
  // OpenTUI 要求交互式终端
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('iTestAgent TUI requires a terminal.');
    console.log("Run 'itestagent --help' for available commands.");
    return;
  }

  const renderer: TuiRenderer = createOpenTuiRenderer();
  const state = createInitialState(workspace);

  await renderer.start(state, () => {
    // events dispatched from renderer; no-op for skeleton phase
  });
}

// 重新导出类型
export type { TuiRenderer } from './renderer.js';
export {
  createInitialState,
  tuiShellReducer,
  type TuiShellState,
  type TuiShellEvent,
  type Message,
  type DeviceStatus,
} from './tui-shell.js';
