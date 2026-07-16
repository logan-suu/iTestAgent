/**
 * InkRenderer — Ink（React TUI）渲染器实现。
 *
 * 技术选型文档 §5：Ink 为已验证 fallback（T0.4 横评 16/16 通过）。
 *
 * US-4.1 AC2：TUI 显示当前 workspace、设备状态、可输入自然语言。
 */

import { Box, Text, render, useInput } from 'ink';
import React from 'react';
import type { TuiRenderer } from '../renderer.js';
import {
  type DeviceStatus,
  type Message,
  type TuiShellEvent,
  type TuiShellState,
  tuiShellReducer,
} from '../tui-shell.js';

// ─── Ink 组件 ─────────────────────────────────────────────────────────

/** 设备状态 → 显示文本映射。 */
const DEVICE_LABELS: Record<DeviceStatus, string> = {
  no_device: '[no device]',
  checking: '[checking…]',
  healthy: '[✓ connected]',
  untrusted: '[✗ untrusted]',
  busy: '[… busy]',
};

/** 设备状态 → 颜色（Ink Text color prop）。 */
const DEVICE_COLORS: Record<DeviceStatus, string> = {
  no_device: 'gray',
  checking: 'yellow',
  healthy: 'green',
  untrusted: 'red',
  busy: 'yellow',
};

/** 顶部状态栏。 */
function Header(props: { workspace: string; deviceStatus: DeviceStatus }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1}>
      <Box>
        <Text dimColor>Workspace: </Text>
        <Text>{props.workspace}</Text>
      </Box>
      <Box>
        <Text dimColor>Device: </Text>
        <Text color={DEVICE_COLORS[props.deviceStatus]}>{DEVICE_LABELS[props.deviceStatus]}</Text>
      </Box>
    </Box>
  );
}

/** 底部输入栏。 */
function InputBar(props: {
  draft: string;
  onSubmit: () => void;
  onInput: (text: string) => void;
}): React.ReactElement {
  useInput((input, key) => {
    if (key.return) {
      props.onSubmit();
      return;
    }
    if (key.delete || key.backspace) {
      props.onInput(props.draft.slice(0, -1));
      return;
    }
    if (input.length === 1 && input.charCodeAt(0) >= 32) {
      props.onInput(props.draft + input);
    }
  });

  return (
    <Box borderStyle="round" paddingX={1}>
      <Text dimColor>{'> '}</Text>
      <Text>{props.draft}</Text>
    </Box>
  );
}

/** 消息列表。 */
function MessageList(props: { messages: readonly Message[] }): React.ReactElement {
  if (props.messages.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>Type a message and press Enter to send. Ctrl+C or :q to quit.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {props.messages.map((msg) => {
        const prefix = msg.type === 'user' ? 'You' : msg.type === 'error' ? 'ERR' : 'Sys';
        const color = msg.type === 'user' ? 'cyan' : msg.type === 'error' ? 'red' : 'gray';
        return (
          <Box key={msg.id}>
            <Text color={color}>{`[${prefix}] `}</Text>
            <Text>{msg.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── StatefulApp（状态管理在 React 内部） ──────────────────────────────

/**
 * 带内部状态管理的 App 根组件。
 *
 * 通过 React useState 持有 TuiShellState，
 * dispatch 时调用 tuiShellReducer 计算下一个状态并触发 React 重渲染。
 *
 * quit 事件处理：
 *  - React setState 更新 running: false
 *  - 通知外部 dispatch（用于外部断言/日志）
 *  - 调用 Ink app.exit() 退出渲染循环
 */
function StatefulApp(props: {
  initialState: TuiShellState;
  dispatch: (event: TuiShellEvent) => void;
}): React.ReactElement {
  const [state, setState] = React.useState<TuiShellState>(props.initialState);

  const wrappedDispatch = React.useCallback(
    (event: TuiShellEvent) => {
      setState((prev) => {
        const next = tuiShellReducer(prev, event);
        return next;
      });
      // 通知外部（用于最终状态收集/测试）
      props.dispatch(event);
    },
    [props.dispatch],
  );

  // 全局快捷键
  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || input === ':q') {
      wrappedDispatch({ type: 'quit' });
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header workspace={state.workspace} deviceStatus={state.deviceStatus} />
      <MessageList messages={state.messages} />
      <InputBar
        draft={state.inputDraft}
        onSubmit={() => wrappedDispatch({ type: 'submit' })}
        onInput={(text) => wrappedDispatch({ type: 'input', text })}
      />
    </Box>
  );
}

// ─── InkRenderer ───────────────────────────────────────────────────────

/**
 * 创建 Ink 渲染器的工厂函数。
 *
 * 第一版只实现 InkRenderer（已验证 fallback）。
 * 后续 OpenTUI renderer 实现同一 TuiRenderer 接口即可。
 */
export function createInkRenderer(): TuiRenderer {
  const renderer: TuiRenderer = {
    async start(initialState, dispatch) {
      const { waitUntilExit } = render(
        <StatefulApp initialState={initialState} dispatch={dispatch} />,
        {
          exitOnCtrlC: false,
          patchConsole: false,
        },
      );

      await waitUntilExit();
    },
  };

  return renderer;
}
