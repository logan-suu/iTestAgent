/**
 * Renderer 抽象接口。
 *
 * 技术选型文档 §5：TuiShell ViewModel/Event/reducer 应 framework-independent，
 * OpenTUI 和 Ink 都只是 renderer。
 *
 * 每个 renderer 实现此接口，TuiShell 核心不感知具体渲染技术。
 */

import type { TuiShellEvent, TuiShellState } from './tui-shell.js';

/** TuiShell 渲染器接口。每个渲染实现（Ink/OpenTUI）需实现此接口。 */
export interface TuiRenderer {
  /**
   * 启动渲染循环。
   * 返回 Promise，resolve 时表示用户退出（quit 事件后）。
   */
  start(state: TuiShellState, dispatch: (event: TuiShellEvent) => void): Promise<void>;
}
