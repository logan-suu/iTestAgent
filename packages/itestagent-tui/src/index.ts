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
  type Message,
  type DeviceStatus,
} from './tui-shell.js';
