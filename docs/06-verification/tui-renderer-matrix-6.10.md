# T6.10 TUI renderer real-PTY matrix

## Environment

- Date: 2026-09-04
- Host: macOS 26.5 (25F71), arm64
- Bun: 1.3.14
- Python PTY harness: 3.9.6
- `@opentui/core`: 0.5.10
- `@opentui/solid`: 0.5.10
- `ink`: 7.1.1
- `react`: 19.2.8

## Gate

The matrix launches each production renderer in a native pseudo-terminal without renderer mocks. It requires all of the following observable behaviors:

1. the configured renderer is the renderer that starts;
2. a first frame is emitted;
3. characters delivered separately are assembled into one `input` event followed by `submit`;
4. changing the PTY from 80 columns to 30 columns produces a fresh frame;
5. Ctrl+C ends the renderer with exit code 0.

Command:

```bash
bun test tests/integration/phase6/phase6-physical-reliability-security.test.ts
```

## Result

| Renderer | Selected | First frame | Per-character input | Resize | Clean exit | Verdict |
|---|---:|---:|---:|---:|---:|---|
| OpenTUI | pass | pass | pass | pass | pass | pass |
| Ink | pass | pass | pass | pass | pass | pass |
| ANSI | pass | pass | pass | pass | pass | pass |

Observed bytes from the direct matrix run:

| Renderer | Initial | Input | Resize | Exit |
|---|---:|---:|---:|---:|
| OpenTUI | 6804 | 467 | 2376 | 120 |
| Ink | 171 | 1245 | 187 | 12 |
| ANSI | 625 | 611 | 306 | 7 |

OpenTUI 0.5.10 no longer reproduces the 0.4.3 event-loop starvation recorded in DEF-025. It therefore remains the verified interactive `auto` renderer. Ink remains an explicit and CI-compatible renderer. ANSI remains available for explicit selection, dumb/non-TTY capability handling, and the masked first-run credential flow.

The byte counts are diagnostic observations rather than golden snapshots. The automated verdict checks behavior so terminal protocol encoding changes do not create false failures.

## 2026-09-06 runtime-resolution correction and rerun

T6.12 的人工验收发现，工作区锁文件与 `packages/itestagent-tui/package.json` 已声明 OpenTUI 0.5.10，但包目录中残留的未跟踪 `node_modules` 副本仍为 0.4.5，并在从源码启动时优先于根目录 0.5.10 被解析。因此上面的 2026-09-04 版本号只证明了声明版本，不能证明 PTY 进程实际加载了 0.5.10；原结论的版本归属在本次复验前不成立。

修正内容：

- 清理本机包目录中的旧生成依赖后，确认 TUI 包实际解析 0.5.10；
- 按 OpenTUI 0.5.x 的运行要求在 Bun 生产入口预加载 Solid transform；
- Ink renderer 改用显式 `React.createElement`，避免 Solid transform 处理 React JSX；
- 新增从 `packages/itestagent-tui` 工作目录读取实际 runtime 版本的自动断言；
- 对固定 header/footer 设置不可压缩布局，并使用 OpenTUI character-frame 捕获断言 Workspace、Device、审阅标题、提示、状态与命令位于独立行。

复验命令：

```bash
bun test tests/integration/phase6/phase6-physical-reliability-security.test.ts tests/integration/phase6/opentui-review-layout-frame.test.ts tests/integration/phase6/opentui-review-confirmation-pty.test.ts tests/integration/phase6/opentui-first-run-setup-pty.test.ts
```

复验结果：OpenTUI、Ink、ANSI 的 PTY matrix 全部通过；OpenTUI 候选/TestPlan 的 Enter 事件、首次配置 UTF-8/掩码路径以及两种审阅页的字符帧行分离全部通过。修正后的直接 matrix 字节观察值为 OpenTUI `6837/455/2313/152`、Ink `171/1273/240/12`、ANSI `625/311/313/7`（initial/input/resize/exit）。由此恢复“OpenTUI 0.5.10 通过当前生产行为门禁”的结论。
