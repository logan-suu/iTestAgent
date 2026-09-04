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
