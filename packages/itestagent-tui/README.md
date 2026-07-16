# itestagent-tui

> TUI Shell — interactive agent interface (OpenTUI+SolidJS default, ADR-008)

Part of iTestAgent monorepo. See [../../README.md](../../README.md) for project overview and [../../AGENTS.md](../../AGENTS.md) for conventions.

## Architecture

```
tui-shell.ts          ← framework-independent State/Event/reducer (pure TS)
renderer.ts           ← TuiRenderer interface
renderers/
  opentui-renderer.tsx ← OpenTUI+SolidJS renderer (default, Phase 1 T1.2)
  (ink-renderer)      ← Ink fallback (T0.4 validated 16/16, not yet implemented)
entry.ts              ← startTui() entry point
```

## Status

Phase 1 implemented — OpenTUI 0.4.3 + SolidJS 1.9 TUI shell skeleton. PR #2 pending merge.

## Usage

```typescript
import { startTui, tuiShellReducer, createInitialState } from 'itestagent-tui';

// CLI integration (packages/itestagent-cli/src/cli.ts)
await startTui();

// Framework-independent reducer (pure function, no renderer dependency)
const state = createInitialState('/path/to/workspace');
const next = tuiShellReducer(state, { type: 'submit' });
```
