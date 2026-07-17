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

## Troubleshooting

**`Cannot find module 'react/jsx-dev-runtime'`**

Bun uses `tsconfig.base.json`'s `jsxImportSource` setting (`@opentui/solid`) for JSX transforms. If this error appears:

1. Ensure `@opentui/solid` is installed: `cd packages/itestagent-tui && bun install`
2. Verify `@opentui/solid` provides `jsx-runtime` and `jsx-dev-runtime` exports in `node_modules/@opentui/solid/`
3. Run `bun test` to confirm the TUI tests pass

This error typically occurs when `node_modules` is incomplete or a Bun version mismatch causes the JSX import source to fall back to `react`.
