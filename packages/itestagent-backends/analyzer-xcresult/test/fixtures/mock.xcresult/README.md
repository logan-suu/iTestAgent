# mock.xcresult — fixture strategy

Real `.xcresult` bundles are **machine-local artifacts**: they are opaque
binary directories produced by `xcodebuild` on the machine that ran the
tests, and they embed absolute paths, host names, device identifiers, and
timestamps from that machine. They are therefore **never committed** to this
repository (see the promotion guide §6.3 denylist: raw device output and
machine-specific evidence must not be migrated).

## How xcresult data is represented in tests

Instead of binary bundles, the analyzer-xcresult tests consume **sanitized,
text-based fixtures** produced from real xcresultparser output with all
machine-specific content removed:

| Fixture | Purpose |
| --- | --- |
| `../xcresultparser-target-info.txt` | Sanitized `xcresultparser` target/summary output used to exercise parsing logic |
| `../junit-pass.xml` / `../junit-mixed.xml` | Sanitized JUnit-style result XML covering pass and mixed pass/fail outcomes |

This directory (`mock.xcresult/`) is a named placeholder documenting that
choice. It intentionally contains no `.xcresult` bytes.

## Rules for future fixtures

1. Never copy a real `.xcresult` bundle into the repository.
2. Derive new fixtures from tool output, then sanitize: replace absolute
   user paths (`/Users/<name>/...`, `/home/<name>/...`), device UDIDs,
   serial numbers, team IDs, host names, and exact timestamps with generic
   placeholders.
3. Keep fixtures deterministic: identical input must yield identical parsed
   output across machines and runs.
4. If a test needs richer structure than text fixtures can express, extend
   the parser contract with a new sanitized fixture file next to the
   existing ones — do not reintroduce binary artifacts.
